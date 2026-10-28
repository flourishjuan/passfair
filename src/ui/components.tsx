import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Job, JobEvent, PresetId } from "../core/orchestrator";
import { presets } from "../core/orchestrator";
import { type ProviderId, providerIds, providers } from "../core/providers";
import { secureAvailable, type Connection, type Settings } from "../store/storage";
import { T, vendorColor } from "./theme";

/* ---------- small primitives ---------- */
export function Pill({ text, tone = "lilac" }: { text: string; tone?: "lilac" | "lime" | "ink" | "red" }) {
  const bg = { lilac: T.lilac, lime: T.lime, ink: T.ink, red: "#FFE3E3" }[tone];
  const fg = tone === "ink" ? T.white : T.ink;
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}
export function Btn({
  label,
  onPress,
  kind = "outline",
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: "outline" | "primary" | "lime" | "danger";
  disabled?: boolean;
  small?: boolean;
}) {
  const bg = { outline: T.white, primary: T.purple, lime: T.lime, danger: "#FFE3E3" }[kind];
  const fg = kind === "primary" ? T.white : kind === "danger" ? T.danger : T.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}
export function Choice<Tv extends string>({
  value,
  options,
  onChange,
}: {
  value: Tv;
  options: { value: Tv; label: string }[];
  onChange: (v: Tv) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, value === o.value && s.chipOn]}>
          <Text style={[s.chipText, value === o.value && { color: T.white }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- connect bar ---------- */
export function ConnectBar({
  connections,
  open,
  onToggle,
  musePaired,
  museConfigured,
}: {
  connections: Connection[];
  open: string | null;
  onToggle: (id: string) => void;
  musePaired: boolean;
  museConfigured: boolean;
}) {
  const saved = Object.fromEntries(connections.map((c) => [c.provider, c]));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={s.connectRow}
    >
      <Text style={s.connectLabel}>CONNECT</Text>
      {providerIds.map((p) => (
        <Pressable key={p} onPress={() => onToggle(p)} style={[s.agentBtn, open === p && s.agentBtnOpen]}>
          <View style={[s.dot, { backgroundColor: saved[p] ? vendorColor[p] : T.line }]} />
          <Text style={s.agentName}>{providers[p].short}</Text>
          <Text style={s.agentSub}>{saved[p] ? saved[p].model : "connect"}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => onToggle("muse")} style={[s.agentBtn, open === "muse" && s.agentBtnOpen]}>
        <View style={[s.dot, { backgroundColor: musePaired ? T.muse : museConfigured ? T.lime : T.line }]} />
        <Text style={s.agentName}>Muse</Text>
        <Text style={s.agentSub}>
          {musePaired ? "paired · publishes" : museConfigured ? "enter code in Muse" : "connect"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export function ConnectPanel({
  provider,
  connection,
  onConnect,
  onDisconnect,
  onClose,
}: {
  provider: ProviderId;
  connection?: Connection;
  onConnect: (model: string, key: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}) {
  const v = providers[provider];
  const [model, setModel] = useState(connection?.model || v.defaultModel);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>{v.label}</Text>
      <Text style={s.fine}>
        {connection
          ? `Connected as ${connection.model}. Paste a new key to replace it.`
          : `Paste your ${v.short} API key. Passfair makes one tiny test call, then keeps the key in this phone's ${secureAvailable ? "keychain" : "browser storage (demo page)"}. It is sent only to ${v.short}.`}
      </Text>
      <Pressable onPress={() => Linking.openURL(v.docs)}>
        <Text style={s.link}>Where do I get a key? ↗</Text>
      </Pressable>
      <Field label="API key">
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={v.keyHint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
        />
      </Field>
      <Field label="Model">
        <TextInput value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} style={s.input} />
      </Field>
      {!!err && <Text style={s.err}>{err}</Text>}
      <View style={s.row}>
        <Btn
          label={busy ? "Checking…" : "Connect"}
          kind="primary"
          disabled={busy || !key.trim()}
          onPress={async () => {
            setBusy(true);
            setErr("");
            try {
              await onConnect(model.trim(), key.trim());
              setKey("");
              onClose();
            } catch (e: any) {
              setErr(e?.message || "Could not connect.");
            } finally {
              setBusy(false);
            }
          }}
        />
        {connection && <Btn label="Disconnect" kind="danger" onPress={() => onDisconnect().then(onClose)} />}
        <Btn label="Close" onPress={onClose} />
      </View>
    </View>
  );
}

export function MusePanel({
  settings,
  onPair,
  onCheck,
  onUnpair,
  onClose,
}: {
  settings: Settings;
  onPair: () => Promise<{ code: string; expires: string }>;
  onCheck: () => Promise<void>;
  onUnpair: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const paired = settings.relay_paired === "1";
  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Muse · your distributor</Text>
      <Text style={s.fine}>
        Muse places briefs, collects finished work and publishes it. If publishing fails, the problem comes back here
        and the team fixes it. Only your own Muse account can pair; nothing is sent until you hand a job off.
      </Text>
      {paired ? (
        <Text style={s.ok}>
          Muse is paired. Reviewer-approved work is handed to Muse according to your Team setting.
        </Text>
      ) : settings.relay_code ? (
        <View style={{ gap: 6 }}>
          <Text style={s.fine}>In Muse, connect “Passfair” and enter this code (one-time, 24 h):</Text>
          <Text selectable style={s.code}>
            {settings.relay_code}
          </Text>
          <Text style={s.fine}>
            Until Meta approves the Muse connector, use “Copy for Muse” on a finished job instead. Pairing is ready for
            when it is.
          </Text>
        </View>
      ) : (
        <Text style={s.fine}>Generate a one-time pairing code, then type it into your Muse app.</Text>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
      <View style={s.row}>
        {!paired && (
          <Btn
            label={busy ? "…" : settings.relay_code ? "New pairing code" : "Pair with Muse"}
            kind="primary"
            disabled={busy}
            onPress={wrap(onPair)}
          />
        )}
        {!!settings.relay_token && <Btn label="Check status" disabled={busy} onPress={wrap(onCheck)} />}
        {!!settings.relay_token && <Btn label="Unpair" kind="danger" disabled={busy} onPress={wrap(onUnpair)} />}
        <Btn label="Close" onPress={onClose} />
      </View>
    </View>
  );
}

/* ---------- chat ---------- */
const roleLabel: Record<string, string> = {
  planner: "Planner",
  worker: "Worker",
  polisher: "Polisher",
  reviewer: "Reviewer",
  feedback: "Feedback",
  handoff: "→ Muse",
  published: "Muse · published",
};
function who(e: JobEvent) {
  const vendor =
    e.provider === "demo"
      ? "Demo"
      : e.provider === "anthropic"
        ? "Claude"
        : e.provider === "openai"
          ? "GPT"
          : e.provider === "google"
            ? "Gemini"
            : e.provider === "relay" || e.provider === "muse"
              ? "Muse"
              : e.source === "you"
                ? "You"
                : e.provider;
  if (e.role === "feedback") return e.source === "you" ? "You (cut in)" : `${vendor} · reported a problem`;
  if (e.role === "handoff" || e.role === "published") return roleLabel[e.role];
  return `${vendor} · ${roleLabel[e.role] || e.role}`;
}
export function Bubble({ e }: { e: JobEvent }) {
  const mine = e.role === "feedback" && e.source === "you";
  const color = vendorColor[e.provider] || T.purple;
  const review = e.review;
  const [openIssues, setOpenIssues] = useState(false);
  return (
    <View style={[s.msg, mine && s.msgMine]}>
      {!mine && (
        <View style={[s.avatar, { backgroundColor: color }]}>
          <Text style={s.avatarText}>{who(e).slice(0, 1)}</Text>
        </View>
      )}
      <View
        style={[
          s.bubble,
          mine && s.bubbleMine,
          e.role === "reviewer" && review && (review.verdict === "pass" ? s.bubblePass : s.bubbleRevise),
          e.role === "published" && s.bubblePublished,
        ]}
      >
        <Text style={[s.who, mine && { color: "#D9D4EF" }]}>
          {who(e)}
          {e.round ? ` · round ${e.round}` : ""}
        </Text>
        {e.role === "reviewer" && review ? (
          <View style={{ gap: 4 }}>
            <Text style={s.verdict}>
              {review.verdict === "pass" ? "PASS" : "REVISE"}
              {review.score !== null ? ` · ${review.score}/10` : ""}
            </Text>
            <Text style={s.body}>{review.summary}</Text>
            {review.issues.length > 0 && (
              <Pressable onPress={() => setOpenIssues(!openIssues)}>
                <Text style={s.link}>
                  {review.issues.length} issue{review.issues.length > 1 ? "s" : ""} {openIssues ? "▴" : "▾"}
                </Text>
              </Pressable>
            )}
            {openIssues &&
              review.issues.map((i, k) => (
                <Text key={k} style={s.issue}>
                  <Text style={{ fontWeight: "700" }}>{i.severity.toUpperCase()}</Text> · {i.where}: {i.problem} →{" "}
                  {i.fix}
                </Text>
              ))}
          </View>
        ) : (
          <Text style={[s.body, mine && { color: T.white }]} selectable>
            {e.text}
          </Text>
        )}
      </View>
    </View>
  );
}
export function Typing({ job }: { job: Job }) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 400);
    return () => clearInterval(t);
  }, []);
  const role = job.current?.role || "planner";
  const vendor = job.assignments[role] || "demo";
  return (
    <View style={s.msg}>
      <View style={[s.avatar, { backgroundColor: vendorColor[vendor] || T.purple }]}>
        <ActivityIndicator color={T.white} size="small" />
      </View>
      <View style={s.bubble}>
        <Text style={s.who}>
          {(vendor === "anthropic" ? "Claude" : vendor === "openai" ? "GPT" : vendor === "google" ? "Gemini" : "Demo") +
            " · " +
            roleLabel[role]}
        </Text>
        <Text style={s.body}>
          {role === "reviewer"
            ? "reviewing"
            : role === "planner"
              ? "planning"
              : role === "polisher"
                ? "polishing"
                : "drafting"}
          {dots}
        </Text>
      </View>
    </View>
  );
}

/* ---------- team sheet ---------- */
export function TeamSheet({
  visible,
  settings,
  onChange,
  onClose,
}: {
  visible: boolean;
  settings: Settings;
  onChange: (p: Settings) => void;
  onClose: () => void;
}) {
  const preset = (settings.preset as PresetId) || "make_and_ship";
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={s.sheet}>
        <Text style={s.h2}>Who does what</Text>
        <Text style={s.fine}>
          Presets assign roles automatically from the agents you connected: Claude takes logic and review, GPT takes
          polish. Change only if you want to.
        </Text>
        <Field label="Team preset">
          <Choice
            value={preset}
            options={(Object.keys(presets) as PresetId[]).map((k) => ({ value: k, label: presets[k].label }))}
            onChange={(v) => onChange({ preset: v })}
          />
          <Text style={s.fine}>{presets[preset].description}</Text>
        </Field>
        <Field label="Max rounds">
          <Choice
            value={String(settings.maxRounds || 3)}
            options={["1", "2", "3", "4", "5", "6"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => onChange({ maxRounds: Number(v) })}
          />
        </Field>
        <Field label="Hand off to Muse">
          <Choice
            value={settings.autoHandoff || "off"}
            options={[
              { value: "off", label: "Only when I say so" },
              { value: "approved", label: "When the Reviewer approves" },
              { value: "always", label: "Always" },
            ]}
            onChange={(v) => onChange({ autoHandoff: v })}
          />
        </Field>
        <Btn label="Done" kind="primary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

export function LiveToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <View style={[s.row, { alignItems: "center", gap: 8 }]}>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: T.purple }} />
      <Text style={[s.fine, { flex: 1 }]}>
        {disabled
          ? "Connect an agent to run live. Without one, Send runs the free demo."
          : "Live: send to my connected providers (their charges apply)"}
      </Text>
    </View>
  );
}

export const s = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: T.ink },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 7 },
  btnText: { fontWeight: "700", fontSize: 14 },
  label: { fontSize: 12, fontWeight: "700", color: T.muted, letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    backgroundColor: T.white,
    color: T.ink,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: T.lilac,
    borderWidth: 1,
    borderColor: T.line,
  },
  chipOn: { backgroundColor: T.ink, borderColor: T.ink },
  chipText: { fontSize: 13, fontWeight: "700", color: T.ink },
  connectRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  connectLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.6, color: T.purple, marginRight: 4 },
  agentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 2,
    borderColor: T.ink,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: T.white,
  },
  agentBtnOpen: { backgroundColor: T.lilac },
  dot: { width: 8, height: 8, borderRadius: 4 },
  agentName: { fontWeight: "800", fontSize: 14, color: T.ink },
  agentSub: { fontSize: 11, color: T.muted },
  panel: {
    margin: 12,
    marginTop: 0,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.white,
    gap: 10,
  },
  panelTitle: { fontSize: 16, fontWeight: "800", color: T.ink },
  fine: { fontSize: 13, color: T.muted, lineHeight: 18 },
  ok: { fontSize: 13, color: "#2E7D32", fontWeight: "700" },
  err: { fontSize: 13, color: T.danger, fontWeight: "700" },
  link: { fontSize: 13, color: T.purple, fontWeight: "700" },
  code: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
    color: T.ink,
    backgroundColor: T.lilac,
    padding: 12,
    borderRadius: 12,
    textAlign: "center",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  msg: { flexDirection: "row", gap: 8, maxWidth: "94%", alignSelf: "flex-start" },
  msgMine: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { color: T.white, fontWeight: "800", fontSize: 12 },
  bubble: {
    backgroundColor: T.lilac,
    borderRadius: 14,
    padding: 12,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: "transparent",
    gap: 4,
  },
  bubbleMine: { backgroundColor: T.ink },
  bubblePass: { backgroundColor: "#F3FBD6", borderColor: T.lime },
  bubbleRevise: { backgroundColor: "#FFF6E0", borderColor: "#FFE3A3" },
  bubblePublished: { backgroundColor: "#E8F1FF", borderColor: "#BFD8FF" },
  who: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: T.muted },
  verdict: { fontSize: 15, fontWeight: "800", color: T.ink },
  body: { fontSize: 15, lineHeight: 21, color: T.ink },
  issue: { fontSize: 13, lineHeight: 18, color: T.muted },
  sheet: { padding: 20, gap: 16, paddingBottom: 48 },
  h2: { fontSize: 24, fontWeight: "800", color: T.ink },
});
