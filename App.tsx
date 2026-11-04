import * as Clipboard from "expo-clipboard";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Attachment } from "./src/core/material";
import { type JobEvent, lastDeliverable } from "./src/core/orchestrator";
import { DEPTH, type Depth, LIMITS } from "./src/core/plan";
import { shortName } from "./src/core/providers";
import { settings as settingsStore } from "./src/store/storage";
import { fromClipboard, fromLink, pickFiles, pickMedia } from "./src/ui/attach";
import { type ExportChoice, exportJob, exportLabel, exportOrder } from "./src/ui/exportFile";
import { Feed, RunFacts, Working } from "./src/ui/feed";
import { Btn, Chip, Row } from "./src/ui/kit";
import { Logo } from "./src/ui/Logo";
import { Markdown } from "./src/ui/markdown";
import { usePro } from "./src/ui/purchases";
import {
  HistorySheet,
  InviteSheet,
  MenuSheet,
  Paywall,
  Reader,
  ReportSheet,
  TeamSheet,
  WorkSheet,
} from "./src/ui/sheets";
import { parseInvite } from "./src/core/referral";
import { F, T, vendorColor } from "./src/ui/theme";
import { useStudio } from "./src/ui/useStudio";

type ScrollViewInstance = React.ComponentRef<typeof ScrollView>;

const confirm = (title: string, message: string, ok: () => void) => {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (globalThis.confirm?.(`${title}\n${message}`)) ok();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "OK", style: "destructive", onPress: ok },
  ]);
};

const STARTERS = [
  "Find the one service my business should sell first — who buys, price, how to get the first customer with no ad budget.",
  "Pressure-test my pricing: here is what I charge and why. What would you change?",
  "Plan a product launch for next month with zero ad spend. Borrow ideas from other industries.",
];

// A last line of defence: an unexpected error shows on screen (so it can be screenshotted and fixed)
// instead of closing the app.
let fatal: Error | null = null;
const fatalListeners = new Set<() => void>();
const g = globalThis as any;
if (g.ErrorUtils?.setGlobalHandler) {
  const prev = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((e: Error, isFatal?: boolean) => {
    if (!isFatal) return prev?.(e, isFatal);
    fatal = e;
    fatalListeners.forEach((f) => f());
  });
}
class Guard extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidMount() {
    fatalListeners.add(this.onFatal);
  }
  componentWillUnmount() {
    fatalListeners.delete(this.onFatal);
  }
  onFatal = () => this.setState({ error: fatal });
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const report = `Passfair error\n${e.message}\n${(e.stack || "").split("\n").slice(0, 8).join("\n")}`;
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, { padding: 24, gap: 16 }]}>
          <Text style={F.title}>Something went wrong</Text>
          <Text style={F.body}>Your conversations and keys are safe. Copy this and send it to support:</Text>
          <ScrollView
            style={{ maxHeight: 320, backgroundColor: T.surface, borderRadius: 16 }}
            contentContainerStyle={{ padding: 14 }}
          >
            <Text
              selectable
              style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, color: T.ink }}
            >
              {report}
            </Text>
          </ScrollView>
          <Row>
            <Btn label="Copy error" kind="primary" onPress={() => Clipboard.setStringAsync(report)} />
            <Btn label="Try again" onPress={() => this.setState({ error: null })} />
          </Row>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
}

export default function App() {
  return (
    <Guard>
      <Root />
    </Guard>
  );
}

function Root() {
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 5000);
  }, []);
  const [proCached, setProCached] = useState<boolean | null>(null);
  useEffect(() => {
    settingsStore.load().then((s) => setProCached(!!s.pro?.active));
  }, []);
  if (proCached === null) return null;
  return <Main toast={toast} toastMsg={toastMsg} proCached={proCached} />;
}

function Main({ toast, toastMsg, proCached }: { toast: (m: string) => void; toastMsg: string; proCached: boolean }) {
  const saveProRef = useRef<(a: boolean) => void>(() => {});
  const pro = usePro(
    proCached,
    useCallback((a: boolean) => saveProRef.current(a), []),
  );
  const st = useStudio(toast, pro.tier);
  saveProRef.current = (active) => st.saveSettings({ pro: { active, checked: new Date().toISOString() } });

  const [sheet, setSheet] = useState<
    null | "menu" | "team" | "pro" | "history" | "work" | "reader" | "report" | "invite"
  >(null);
  const [invitePrefill, setInvitePrefill] = useState<string | null>(null);
  // Opening an invite link (passfair://invite?code=… or the invite web page) shows the code ready to use.
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      const c = parseInvite(url);
      if (c) {
        setInvitePrefill(c);
        setSheet("invite");
      }
    };
    Linking.getInitialURL()
      .then(open)
      .catch(() => {});
    const sub = Linking.addEventListener("url", (e) => open(e.url));
    return () => sub.remove();
  }, []);
  const [reportOf, setReportOf] = useState<JobEvent | null>(null);
  const report = (e: JobEvent | null) => {
    setReportOf(e);
    setSheet("report");
  };
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const job = st.job;
  const running = !!st.runningId && st.runningId === job?.id;
  const finished =
    !!job && ["awaiting_review", "accepted", "delivered", "published", "stopped", "failed"].includes(job.status);
  const mode: "send" | "cutin" | "reply" = running ? "cutin" : job && finished ? "reply" : "send";
  const L = LIMITS[pro.tier];
  const flow = st.settings.flow || "brainstorm";
  const noAgents = !st.connections.length;

  useEffect(() => {
    if (running) scroll.current?.scrollToEnd({ animated: true });
  }, [job?.events.length, running]);

  const add = async (fn: () => Promise<Attachment[] | Attachment | null>) => {
    setAttachOpen(false);
    try {
      const got = await fn();
      const list = (Array.isArray(got) ? got : got ? [got] : []).filter((a) => {
        if (a.kind === "unsupported") {
          toast(`${a.name}: this file type can't be read yet. Use text, Office, PDF, images or video.`);
          return false;
        }
        return true;
      });
      setFiles((f) => [...f, ...list]);
    } catch (e: any) {
      toast(e?.message || "Could not add that.");
    }
  };
  const proLock = (a: Attachment) =>
    (a.kind === "pdf" && !L.pdf) ||
    ((a.kind === "video" || a.kind === "audio") && !L.video) ||
    (a.kind === "office" && !L.office);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    if (mode === "send" && files.some(proLock)) {
      setSheet("pro");
      return;
    }
    setText("");
    const sending = files;
    if (mode === "send") setFiles([]);
    try {
      if (mode === "cutin") await st.cutIn(t);
      else if (mode === "reply" && job) await st.feedback(job.id, t, "manual");
      else await st.start(t, { files: sending });
    } catch (e: any) {
      if (mode === "send") setFiles(sending);
      toast(e?.message || "Failed.");
    }
  };
  const copyForMuse = async () => {
    if (!job) return;
    const r = await st.handoff(job.id).catch((e) => ({ delivered: false, package: undefined, error: e?.message }));
    if (r.delivered) return toast("Handed off to Muse.");
    const pkg = (r as any).package as string | undefined;
    if (pkg) {
      await Clipboard.setStringAsync(pkg);
      toast("Copied. Paste into Muse; if publishing fails, paste the error back here as a reply.");
    } else toast((r as any).error || "Nothing to hand off yet.");
  };
  const exportAs = async (c: ExportChoice) => {
    if (!job) return;
    if (!L.exports.includes(c)) return setSheet("pro");
    setExportOpen(false);
    try {
      await exportJob(job, c);
    } catch (e: any) {
      toast(e?.message || "Export failed.");
    }
  };

  const panelLabel = st.panel.length ? st.panel.map(shortName).join(" · ") : "No agents";

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.root}
        edges={Platform.OS === "android" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}
      >
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Pressable
            onPress={() => setSheet("menu")}
            hitSlop={12}
            style={styles.headBtn}
            accessibilityLabel="Agents and settings"
          >
            <Text style={styles.dots}>•••</Text>
          </Pressable>
          <Logo busy={running} onPress={() => setSheet("work")} />
          <Pressable
            onPress={() => setSheet("invite")}
            hitSlop={12}
            style={[styles.headBtn, { alignItems: "flex-end" }]}
            accessibilityLabel="Invite friends — earn a free month"
          >
            <GiftIcon />
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            contentContainerStyle={styles.feed}
            keyboardShouldPersistTaps="handled"
          >
            {!job ? (
              <View style={{ gap: 22, paddingTop: 24 }}>
                <Text style={F.display}>What should your agents figure out together?</Text>
                <Text style={[F.body, { color: T.sub }]}>
                  Each agent attacks the problem through a different industry, they debate each other, then decide,
                  build and cross-check the result. You watch it all happen.
                </Text>
                {noAgents && (
                  <Pressable onPress={() => setSheet("menu")} style={styles.card}>
                    <Text style={F.head}>Connect your agents</Text>
                    <Text style={F.small}>
                      Sign in once with OpenRouter for Claude, GPT, Grok, Gemini and more — or add each vendor's key.
                      Tap here or ••• at the top left.
                    </Text>
                  </Pressable>
                )}
                <View style={{ gap: 10 }}>
                  {STARTERS.map((t) => (
                    <Pressable key={t} onPress={() => setText(t)} style={styles.card}>
                      <Text style={F.body}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <View style={{ gap: 26 }}>
                <View style={styles.brief}>
                  <Text style={[F.body, { color: T.white }]}>{job.goal}</Text>
                  {!!job.attachments?.length && (
                    <Text style={[F.small, { color: "#C9C6D6" }]}>
                      📎 {job.attachments.map((a) => a.name).join(", ")}
                    </Text>
                  )}
                </View>
                <Feed job={job} onReport={job.mode === "live" ? report : undefined} />
                {running && <Working job={job} />}
                {job.status === "failed" && (
                  <View style={{ gap: 10 }}>
                    <Text style={[F.body, { color: T.danger }]}>{job.error}</Text>
                    <Row>
                      <Btn label="Try again" kind="primary" small onPress={() => st.resume(job)} />
                      <Btn label="Agents" small onPress={() => setSheet("menu")} />
                    </Row>
                  </View>
                )}
                {finished && job.status !== "failed" && (
                  <View style={styles.final}>
                    <Text style={F.label}>
                      {(job.mode === "demo"
                        ? "Sample — no AI was called, nothing was really reviewed"
                        : job.status === "published"
                          ? "Published by Muse"
                          : job.status === "delivered"
                            ? "Handed off to Muse — waiting for publish"
                            : job.outcome === "approved_by_reviewer"
                              ? `Final · approved by ${job.assignments.verifier ? "both reviewers" : "the reviewer"}${job.finalRound ? ` (round ${job.finalRound})` : ""}`
                              : job.outcome === "round_limit_reached"
                                ? `Final · not approved by both — best round ${job.finalRound ?? "?"}, read critically`
                                : "Stopped"
                      ).toUpperCase()}
                    </Text>
                    {(job.final || lastDeliverable(job)) && <Markdown text={job.final || lastDeliverable(job)} />}
                    {job.mode === "live" && <RunFacts job={job} />}
                    {job.status === "stopped" && (
                      <Text style={[F.small, { color: T.ink }]}>
                        {job.error === "interrupted"
                          ? "The run was interrupted — the app was closed or the phone locked. "
                          : "You stopped the run. "}
                        {job.events.some((e) => e.role === "worker")
                          ? "Tap Resume to carry on from the last finished step; nothing is lost."
                          : job.events.some((e) => e.role === "decider")
                            ? "The brainstorm and decision are done; tap Resume and the team writes and reviews the deliverable."
                            : "Tap Resume to carry on from the last finished step; nothing is lost."}
                      </Text>
                    )}
                    {job.mode === "demo" ? (
                      <Text style={F.small}>
                        Connect your agents (••• top left) and send your own brief to run this for real.
                      </Text>
                    ) : (
                      <>
                        <Row>
                          {job.status === "awaiting_review" && (
                            <Btn label="Accept" kind="primary" small onPress={() => st.accept(job.id)} />
                          )}
                          {job.status === "stopped" && (
                            <Btn label="Resume" kind="primary" small onPress={() => st.resume(job)} />
                          )}
                          <Btn label="Read full screen" small onPress={() => setSheet("reader")} />
                          <Btn
                            label={`${job.final || lastDeliverable(job) ? "Download" : "Download decision"} ${exportOpen ? "▴" : "▾"}`}
                            small
                            onPress={() => setExportOpen(!exportOpen)}
                          />
                          <Btn
                            label={st.settings.relay_paired === "1" ? "Hand to Muse" : "Copy for Muse"}
                            small
                            onPress={copyForMuse}
                          />
                          <Btn
                            label="Share"
                            small
                            onPress={() =>
                              Share.share({
                                message: job.final || lastDeliverable(job),
                                title: job.goal.slice(0, 60),
                              }).catch(() => {})
                            }
                          />
                          <Btn label="Report" small kind="plain" onPress={() => report(null)} />
                          <Btn
                            label="Delete"
                            small
                            kind="plain"
                            onPress={() =>
                              confirm(
                                "Delete this conversation?",
                                "Drafts and reviews are removed from this phone.",
                                () => st.remove(job.id),
                              )
                            }
                          />
                        </Row>
                        {exportOpen && (
                          <Row>
                            {exportOrder.map((c) => (
                              <Chip
                                key={c}
                                label={exportLabel[c]}
                                locked={!L.exports.includes(c)}
                                onPress={() => exportAs(c)}
                              />
                            ))}
                          </Row>
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {!!toastMsg && <Text style={styles.toast}>{toastMsg}</Text>}

          <View style={styles.composer}>
            {files.length > 0 && mode === "send" && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {files.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => setFiles((f) => f.filter((x) => x.id !== a.id))}
                    style={styles.file}
                  >
                    <Text style={[F.small, { color: T.ink }]} numberOfLines={1}>
                      {proLock(a) ? "🔒 " : ""}
                      {
                        {
                          image: "🖼",
                          video: "🎬",
                          audio: "🎙",
                          pdf: "📄",
                          office: "📊",
                          link: "🔗",
                          text: "📝",
                          unsupported: "?",
                        }[a.kind]
                      }{" "}
                      {a.name}
                    </Text>
                    <Text style={[F.small, { color: T.faint }]}> ✕</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {attachOpen && (
              <Row>
                <Chip label="🖼 Photos & videos" onPress={() => add(() => pickMedia(false))} />
                <Chip label="📷 Camera" onPress={() => add(() => pickMedia(true))} />
                <Chip label="📁 Files" onPress={() => add(pickFiles)} />
                <Chip
                  label="🔗 Link"
                  onPress={() => {
                    setAttachOpen(false);
                    setLinkMode(true);
                  }}
                />
                <Chip label="📋 Paste" onPress={() => add(fromClipboard)} />
              </Row>
            )}
            {linkMode && (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput
                  value={link}
                  onChangeText={setLink}
                  placeholder="https://…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={T.faint}
                  style={[styles.input, { flex: 1, minHeight: 0 }]}
                />
                <Btn
                  label="Add"
                  small
                  kind="primary"
                  onPress={() => {
                    const u = link;
                    setLink("");
                    setLinkMode(false);
                    add(() => fromLink(u));
                  }}
                />
                <Btn label="✕" small kind="plain" onPress={() => setLinkMode(false)} />
              </View>
            )}
            {mode === "send" && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <Chip label="＋" on={attachOpen} onPress={() => setAttachOpen(!attachOpen)} />
                <Chip
                  label={flow === "brainstorm" ? "✦ Brainstorm" : "Build"}
                  onPress={() => st.saveSettings({ flow: flow === "brainstorm" ? "build" : "brainstorm" })}
                />
                <Chip
                  label={DEPTH[st.settings.depth || "standard"].label}
                  onPress={() => {
                    const order: Depth[] = ["quick", "standard", "deep"];
                    const cur = order.indexOf(st.settings.depth || "standard");
                    st.saveSettings({ depth: order[(cur + 1) % 3] });
                  }}
                />
                <Chip
                  label={noAgents ? "Connect agents" : panelLabel}
                  color={noAgents ? undefined : vendorColor(st.panel[0] || "demo")}
                  onPress={() => setSheet(noAgents ? "menu" : "team")}
                />
                {pro.tier === "free" && <Chip label="Pro" onPress={() => setSheet("pro")} />}
              </ScrollView>
            )}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
              <Pressable
                onPress={() => {
                  st.setJobId(null);
                  setText("");
                  setFiles([]);
                  setExportOpen(false);
                }}
                style={({ pressed }) => [styles.send, { backgroundColor: T.surface, opacity: pressed ? 0.6 : 1 }]}
                accessibilityLabel="New brief"
              >
                <Text style={{ color: T.ink, fontSize: 20, fontWeight: "400" }}>{"\u270E\uFE0E"}</Text>
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                placeholderTextColor={T.faint}
                placeholder={
                  mode === "send"
                    ? noAgents
                      ? "Connect an agent first (••• top left)"
                      : "Ask your agents…"
                    : mode === "cutin"
                      ? "Cut in — the team stops and follows you"
                      : job?.mode === "demo"
                        ? "Sample finished — tap ✎ for your own brief"
                        : "Reply to revise (paste a Muse error too)"
                }
                style={[styles.input, { flex: 1 }]}
              />
              {running && (
                <Pressable
                  onPress={st.stop}
                  style={[styles.send, { backgroundColor: T.dangerSoft }]}
                  accessibilityLabel="Stop"
                >
                  <Text style={{ color: T.danger, fontSize: 16, fontWeight: "400" }}>■</Text>
                </Pressable>
              )}
              <Pressable
                onPress={submit}
                disabled={!text.trim() || (mode === "send" && noAgents) || (mode === "reply" && job?.mode === "demo")}
                style={({ pressed }) => [
                  styles.send,
                  { opacity: !text.trim() || (mode === "send" && noAgents) ? 0.3 : pressed ? 0.7 : 1 },
                ]}
                accessibilityLabel={mode === "send" ? "Send" : mode === "cutin" ? "Cut in" : "Reply"}
              >
                <Text style={{ color: T.white, fontSize: 20, fontWeight: "400" }}>↑</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        <MenuSheet
          visible={sheet === "menu"}
          onClose={() => setSheet(null)}
          tier={pro.tier}
          connections={st.connections}
          settings={st.settings}
          onConnect={st.connect}
          onDisconnect={st.disconnect}
          onModel={st.setModel}
          onAddCustom={st.addCustom}
          onRemoveCustom={st.removeCustom}
          onSignIn={st.signInOpenRouter}
          onPro={() => setSheet("pro")}
          onRestore={pro.restore}
          onManage={pro.manage}
          onInvite={() => setSheet("invite")}
          jobs={st.jobs}
          runningId={st.runningId}
          onOpenJob={(id) => {
            st.setJobId(id);
            setSheet(null);
          }}
          onAllHistory={() => setSheet("history")}
          onSample={() => {
            setSheet(null);
            st.start("", { demo: true }).catch((e: any) => toast(e?.message || "Failed."));
          }}
          muse={{
            pair: () => st.relay.pair(),
            check: async () => {
              const r = await st.relay.status();
              toast(r.paired ? "Muse is paired." : "Not paired yet — enter the code in Muse.");
            },
            unpair: () => st.relay.unpair(),
          }}
        />
        <TeamSheet
          visible={sheet === "team"}
          onClose={() => setSheet(null)}
          tier={pro.tier}
          connections={st.connections}
          panel={st.panel}
          settings={st.settings}
          onChange={(p) => st.saveSettings(p)}
          onPro={() => setSheet("pro")}
        />
        <Paywall
          visible={sheet === "pro"}
          onClose={() => setSheet(null)}
          products={pro.products}
          busy={pro.busy}
          note={pro.note}
          onBuy={pro.buy}
          onRestore={pro.restore}
        />
        <HistorySheet
          visible={sheet === "history"}
          onClose={() => setSheet(null)}
          jobs={st.jobs}
          onOpen={(id) => {
            st.setJobId(id);
            setSheet(null);
          }}
        />
        <WorkSheet visible={sheet === "work"} onClose={() => setSheet(null)} job={job} running={running} />
        <InviteSheet
          visible={sheet === "invite"}
          onClose={() => setSheet(null)}
          status={st.invites}
          error={st.inviteError}
          prefill={invitePrefill}
          onRefresh={st.refreshInvites}
          onClaim={st.claimInvite}
        />
        <ReportSheet
          visible={sheet === "report"}
          onClose={() => setSheet(null)}
          job={job}
          event={reportOf}
          onSent={() => toast("Thanks — choose how to send the report.")}
        />
        <Reader
          visible={sheet === "reader"}
          onClose={() => setSheet(null)}
          title={job?.goal.slice(0, 80) || ""}
          text={job ? job.final || lastDeliverable(job) : ""}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Line-drawn gift (lid, box, ribbon, bow) so it matches the ••• and logo instead of a colour emoji.
function GiftIcon() {
  const line = { borderColor: T.ink, borderWidth: 1.6 } as const;
  return (
    <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={{ position: "absolute", top: 1, flexDirection: "row", gap: 2 }}>
        <View style={[line, { width: 7, height: 6, borderRadius: 4, transform: [{ rotate: "-25deg" }] }]} />
        <View style={[line, { width: 7, height: 6, borderRadius: 4, transform: [{ rotate: "25deg" }] }]} />
      </View>
      <View style={[line, { width: 22, height: 6, borderRadius: 2, marginBottom: 1 }]} />
      <View style={[line, { width: 18, height: 11, borderRadius: 2, borderTopWidth: 0 }]} />
      <View style={{ position: "absolute", bottom: 0, top: 7, width: 1.6, backgroundColor: T.ink }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  headBtn: { width: 76, height: 44, justifyContent: "center" },
  dots: { fontSize: 18, letterSpacing: 1, color: T.ink },
  feed: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, padding: 16, gap: 4 },
  brief: {
    alignSelf: "flex-end",
    maxWidth: "92%",
    backgroundColor: T.ink,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  final: { gap: 14, paddingTop: 4 },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 26 : 12,
    gap: 8,
    backgroundColor: T.bg,
  },
  input: {
    backgroundColor: T.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: T.ink,
    minHeight: 46,
    maxHeight: 130,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 46,
    backgroundColor: T.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 240,
  },
  toast: {
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: T.ink,
    color: T.white,
    borderRadius: 16,
    padding: 12,
    fontSize: 14,
    overflow: "hidden",
  },
});
