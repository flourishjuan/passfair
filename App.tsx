// Passfair — your AI agents, finally talking to each other. Chat-first, one screen.
import * as Clipboard from "expo-clipboard";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { lastDeliverable } from "./src/core/orchestrator";
import type { ProviderId } from "./src/core/providers";
import {
  Btn,
  Bubble,
  ConnectBar,
  ConnectPanel,
  LiveToggle,
  MusePanel,
  Pill,
  TeamSheet,
  Typing,
  s,
} from "./src/ui/components";
import { T } from "./src/ui/theme";
import { useStudio } from "./src/ui/useStudio";

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

export default function App() {
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 5000);
  }, []);
  const st = useStudio(toast);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [team, setTeam] = useState(false);
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const [history, setHistory] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const job = st.job;
  const running = !!st.runningId && st.runningId === job?.id;
  const finished =
    !!job && ["awaiting_review", "accepted", "delivered", "published", "stopped", "failed"].includes(job.status);
  const musePaired = st.settings.relay_paired === "1";
  const mode: "send" | "cutin" | "reply" = running ? "cutin" : job && finished ? "reply" : "send";

  useEffect(() => {
    if (st.connections.length) setLive(true);
  }, [st.connections.length]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [job?.events.length, running]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      if (mode === "cutin") await st.cutIn(t);
      else if (mode === "reply" && job) await st.feedback(job.id, t, "manual");
      else await st.start(t, { live });
    } catch (e: any) {
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
  const share = async () => {
    if (!job) return;
    const body = job.final || lastDeliverable(job);
    try {
      await Share.share({ message: body, title: job.goal.slice(0, 60) });
    } catch {}
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <StatusBar style="dark" />
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            RUNS ON YOUR PHONE · KEYS STAY IN YOUR KEYCHAIN · ONLY WHAT YOU HAND OFF TRAVELS
          </Text>
        </View>
        <View style={styles.header}>
          <Image source={require("./assets/splash-icon.png")} style={{ width: 34, height: 34 }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.brand} numberOfLines={1}>
              Passfair
            </Text>
            <Text style={styles.brandSub} numberOfLines={1}>
              BY AGENTS FAIR
            </Text>
          </View>
          <Btn label="History" small onPress={() => setHistory(!history)} />
          <Btn label="Team" small onPress={() => setTeam(true)} />
          <Pill
            text={
              running
                ? "RUNNING"
                : job
                  ? job.status === "awaiting_review"
                    ? "DONE"
                    : job.status.toUpperCase()
                  : st.connections.length
                    ? "READY"
                    : "DEMO"
            }
            tone={running ? "lime" : "lilac"}
          />
        </View>

        <ConnectBar
          connections={st.connections}
          open={openPanel}
          onToggle={(id) => setOpenPanel(openPanel === id ? null : id)}
          musePaired={musePaired}
          museConfigured={!!st.settings.relay_token}
        />
        {openPanel && openPanel !== "muse" && (
          <ConnectPanel
            provider={openPanel as ProviderId}
            connection={st.connections.find((c) => c.provider === openPanel)}
            onConnect={(m, k) =>
              st
                .connect(openPanel as ProviderId, m, k)
                .then(() =>
                  toast(
                    `${openPanel === "anthropic" ? "Claude" : openPanel === "openai" ? "GPT" : "Gemini"} connected.`,
                  ),
                )
            }
            onDisconnect={() => st.disconnect(openPanel as ProviderId)}
            onClose={() => setOpenPanel(null)}
          />
        )}
        {openPanel === "muse" && (
          <MusePanel
            settings={st.settings}
            onPair={() => st.relay.pair()}
            onCheck={async () => {
              const r = await st.relay.status();
              toast(r.paired ? "Muse is paired." : "Still waiting for Muse to enter the code.");
            }}
            onUnpair={() => st.relay.unpair()}
            onClose={() => setOpenPanel(null)}
          />
        )}

        {history && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.history}
          >
            <Pressable
              onPress={() => {
                st.setJobId(null);
                setHistory(false);
              }}
              style={[s.chip, !job && s.chipOn]}
            >
              <Text style={[s.chipText, !job && { color: T.white }]}>+ New</Text>
            </Pressable>
            {st.jobs.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => {
                  st.setJobId(j.id);
                  setHistory(false);
                }}
                style={[s.chip, job?.id === j.id && s.chipOn]}
              >
                <Text numberOfLines={1} style={[s.chipText, { maxWidth: 180 }, job?.id === j.id && { color: T.white }]}>
                  {j.origin?.source === "muse" ? "Muse · " : ""}
                  {j.goal.slice(0, 40)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView ref={scroll} style={styles.chat} contentContainerStyle={styles.chatInner}>
            {!job ? (
              <View style={styles.empty}>
                <Text style={styles.h1}>Tell the team what you need.</Text>
                <Text style={s.fine}>
                  Connect your agents above, then type a brief below. Claude plans and drafts, GPT polishes, Claude
                  reviews — they talk to each other here. Cut in whenever you like.
                </Text>
                <Btn
                  label="Watch a 20-second demo →"
                  kind="lime"
                  onPress={() =>
                    st.start(
                      "Write a short, friendly welcome message for new members of a community of AI builders. Include one practical tip for their first week.",
                      { live: false },
                    )
                  }
                />
              </View>
            ) : (
              <>
                <View style={[s.msg, s.msgMine]}>
                  <View style={[s.avatar, { backgroundColor: T.ink }]}>
                    <Text style={s.avatarText}>{job.origin?.source === "muse" ? "M" : "YOU"}</Text>
                  </View>
                  <View style={[s.bubble, s.bubbleMine]}>
                    <Text style={[s.who, { color: "#D9D4EF" }]}>
                      {job.origin?.source === "muse" ? "Muse (on your behalf)" : "You"} ·{" "}
                      {new Date(job.created).toLocaleString()}
                    </Text>
                    <Text style={[s.body, { color: T.white }]}>{job.goal}</Text>
                  </View>
                </View>
                {job.events.map((e, i) => (
                  <Bubble key={i} e={e} />
                ))}
                {running && <Typing job={job} />}
                {job.status === "failed" && <Text style={s.err}>{job.error}</Text>}
                {finished && (job.status as string) !== "failed" && (
                  <View style={styles.final}>
                    <Text style={s.who}>
                      {job.status === "published"
                        ? "Published by Muse"
                        : job.status === "delivered"
                          ? "Handed off to Muse — waiting for publish"
                          : job.outcome === "approved_by_reviewer"
                            ? "Final · reviewer approved"
                            : job.outcome === "round_limit_reached"
                              ? "Final · round limit reached, read critically"
                              : "Stopped"}{" "}
                      · v{job.version || 0}
                    </Text>
                    <View style={s.row}>
                      {job.status === "awaiting_review" && (
                        <Btn label="Accept" small kind="primary" onPress={() => st.accept(job.id)} />
                      )}
                      {(job.status === "stopped" || job.status === "failed") && (
                        <Btn label="Resume" small kind="primary" onPress={() => st.resume(job)} />
                      )}
                      <Btn label={musePaired ? "Hand off to Muse" : "Copy for Muse"} small onPress={copyForMuse} />
                      <Btn label="Share" small onPress={share} />
                      <Btn
                        label="Delete"
                        small
                        kind="danger"
                        onPress={() =>
                          confirm("Delete this conversation?", "Drafts and reviews are removed from this phone.", () =>
                            st.remove(job.id),
                          )
                        }
                      />
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.composer}>
            <Text style={s.fine}>
              {mode === "cutin"
                ? "Cut in: type a new instruction and press Cut in — the team stops and follows it. Or just Stop."
                : mode === "reply"
                  ? "Reply to revise this result (paste a Muse error here too), or start a new brief from History."
                  : job?.mode === "demo"
                    ? ""
                    : ""}
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder={
                mode === "send"
                  ? "Describe what the team should produce…"
                  : mode === "cutin"
                    ? "New instruction…"
                    : "What should change?"
              }
              style={[s.input, { minHeight: 64, maxHeight: 140 }]}
            />
            {mode === "send" && (
              <LiveToggle
                value={live && st.connections.length > 0}
                onChange={setLive}
                disabled={!st.connections.length}
              />
            )}
            <View style={[s.row, { justifyContent: "flex-end", alignItems: "center" }]}>
              {running && <Btn label="Stop" small kind="danger" onPress={st.stop} />}
              {mode === "reply" && <Btn label="New brief" small onPress={() => st.setJobId(null)} />}
              <Btn
                label={mode === "send" ? "Send →" : mode === "cutin" ? "Cut in →" : "Reply →"}
                kind="primary"
                onPress={submit}
                disabled={!text.trim()}
              />
            </View>
          </View>
        </KeyboardAvoidingView>

        <TeamSheet
          visible={team}
          settings={st.settings}
          onChange={(p) => st.saveSettings(p)}
          onClose={() => setTeam(false)}
        />
        {!!toastMsg && (
          <View style={styles.toast}>
            <Text style={{ color: T.white, fontWeight: "600" }}>{toastMsg}</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.white },
  notice: { backgroundColor: T.lime, paddingVertical: 6, paddingHorizontal: 12 },
  noticeText: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: T.ink, textAlign: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.line,
  },
  brand: { fontSize: 16, fontWeight: "800", color: T.ink, lineHeight: 18 },
  brandSub: { fontSize: 9, fontWeight: "700", letterSpacing: 2, color: T.purple },
  history: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  chat: { flex: 1, backgroundColor: "#FBFAFF" },
  chatInner: { padding: 12, gap: 12, paddingBottom: 24 },
  empty: { marginTop: 40, gap: 14, alignItems: "flex-start", paddingHorizontal: 8 },
  h1: { fontSize: 28, fontWeight: "800", color: T.ink, lineHeight: 32 },
  final: { borderWidth: 2, borderColor: T.ink, borderRadius: 14, padding: 12, gap: 10, backgroundColor: T.white },
  composer: { borderTopWidth: 1, borderTopColor: T.line, padding: 12, gap: 8, backgroundColor: T.white },
  toast: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    backgroundColor: T.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    maxWidth: "90%",
  },
});
