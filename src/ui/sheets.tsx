import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { seatName } from "../core/brainstorm";
import { detectKey } from "../core/oauth";
import { profileFor } from "../core/profiles";
import type { Job } from "../core/orchestrator";
import { DEPTH, type Depth, LIMITS, PRO_PITCH, type Tier } from "../core/plan";
import {
  type CustomAgent,
  type ProviderId,
  type ProviderSpec,
  allProviders,
  getProvider,
  notConnectable,
  shortName,
} from "../core/providers";
import { secureAvailable, type Connection, type Settings } from "../store/storage";
import { Btn, Chip, Dot, Input, Row, Section, Sheet, ToggleRow } from "./kit";
import { Markdown } from "./markdown";
import type { ProProduct } from "./purchases";
import { F, T, vendorColor } from "./theme";

const PRIVACY = "https://challenge.agentsfair.ai/passfair/privacy";
const TERMS = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/* ---------- one agent: connect / change model / disconnect ---------- */
function AgentForm({
  spec,
  connection,
  onConnect,
  onDisconnect,
  onModel,
  onRemove,
  shared,
}: {
  spec: ProviderSpec;
  connection?: Connection;
  onConnect: (model: string, key: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onModel: (m: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  shared?: boolean;
}) {
  const [model, setModel] = useState(connection?.model || spec.defaultModel);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const go = async (k: string) => {
    setBusy(true);
    setErr("");
    try {
      if (shared) await onModel(model.trim());
      else await onConnect(model.trim(), k.trim());
      setKey("");
      setCopied(null);
    } catch (e: any) {
      setErr(e?.message || "Could not connect.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.form}>
      {!!spec.note && <Text style={F.small}>{spec.note}</Text>}
      {!shared && (
        <>
          <Text style={F.small}>
            {connection
              ? `Connected (${connection.model}). Paste a new key to replace it.`
              : `Paste your ${spec.short} API key.`}{" "}
            It stays in this phone's {secureAvailable ? "keychain" : "browser storage"} and goes only to {spec.short}.
          </Text>
          {copied ? (
            <Btn
              label={`Use the ${spec.short} key you copied`}
              kind="lime"
              disabled={busy}
              onPress={() => go(copied)}
            />
          ) : (
            <Btn
              label="Paste copied key"
              kind="lime"
              small
              disabled={busy}
              onPress={async () => {
                // Read the clipboard only when the user taps (no surprise paste prompts).
                setErr("");
                const d = detectKey(await Clipboard.getStringAsync().catch(() => ""));
                if (d && d.provider === spec.id) setCopied(d.key);
                else if (d) setErr(`That looks like a ${shortName(d.provider)} key, not a ${spec.short} key.`);
                else
                  setErr("No API key found on the clipboard. Copy it on the vendor's page first, or paste it below.");
              }}
            />
          )}
          <Text style={F.label}>API KEY</Text>
          <Input
            value={key}
            onChangeText={setKey}
            placeholder={`Paste your key (${spec.keyHint})`}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}
      {shared && (
        <Text style={F.small}>Signed in through OpenRouter — no key needed. Pick the model this agent uses.</Text>
      )}
      <Text style={F.label}>MODEL</Text>
      <Input value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder="Model" />
      <Row>
        {spec.models.map((m) => (
          <Chip key={m} label={m} on={m === model} onPress={() => setModel(m)} />
        ))}
      </Row>
      {(() => {
        const pr = profileFor(spec.id, model.trim());
        return (
          <Text style={F.small}>
            Can read about {Math.round(pr.context / 1000)}k tokens and write up to{" "}
            {Math.round(Math.min(pr.maxOut, spec.maxOut) / 1000)}k per answer — Passfair sizes every step to fit.
            {pr.note ? ` ${pr.note}` : ""}
          </Text>
        );
      })()}
      {!!err && <Text style={[F.small, { color: T.danger }]}>{err}</Text>}
      <Row>
        <Btn
          label={busy ? "Checking…" : shared ? "Save model" : "Connect"}
          kind="primary"
          small
          disabled={busy || (!shared && !key.trim())}
          onPress={() => go(key)}
        />
        {!!spec.docs && <Btn label="Get a key ↗" small onPress={() => Linking.openURL(spec.docs)} />}
        {connection && !shared && <Btn label="Disconnect" small kind="danger" onPress={() => onDisconnect()} />}
        {onRemove && <Btn label="Remove agent" small kind="danger" onPress={() => onRemove()} />}
      </Row>
    </View>
  );
}

function CustomForm({
  locked,
  onAdd,
  onPro,
}: {
  locked: boolean;
  onAdd: (a: CustomAgent, key: string) => Promise<void>;
  onPro: () => void;
}) {
  const [a, setA] = useState({
    name: "",
    brand: "",
    baseUrl: "https://",
    model: "",
    style: "openai-chat" as CustomAgent["style"],
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (locked)
    return (
      <Pressable onPress={onPro} style={[s.form, { opacity: 0.6 }]}>
        <Text style={F.head}>🔒 Add your own agent</Text>
        <Text style={F.small}>
          Any OpenAI- or Anthropic-compatible API: your company's model, a local server, any brand. Pro.
        </Text>
      </Pressable>
    );
  return (
    <View style={s.form}>
      <Text style={F.head}>Add your own agent</Text>
      <Text style={F.small}>Any OpenAI-compatible (chat/completions) or Anthropic-compatible (messages) API.</Text>
      <Input
        placeholder="Name shown in chats (e.g. Atlas)"
        value={a.name}
        onChangeText={(v) => setA({ ...a, name: v })}
      />
      <Input placeholder="Brand / company (optional)" value={a.brand} onChangeText={(v) => setA({ ...a, brand: v })} />
      <Input
        placeholder="https://api.example.com/v1"
        autoCapitalize="none"
        autoCorrect={false}
        value={a.baseUrl}
        onChangeText={(v) => setA({ ...a, baseUrl: v })}
      />
      <Row>
        <Chip
          label="OpenAI-compatible"
          on={a.style === "openai-chat"}
          onPress={() => setA({ ...a, style: "openai-chat" })}
        />
        <Chip
          label="Anthropic-compatible"
          on={a.style === "anthropic"}
          onPress={() => setA({ ...a, style: "anthropic" })}
        />
      </Row>
      <Input
        placeholder="Model name"
        autoCapitalize="none"
        value={a.model}
        onChangeText={(v) => setA({ ...a, model: v })}
      />
      <Input placeholder="API key" secureTextEntry autoCapitalize="none" value={key} onChangeText={setKey} />
      {!!err && <Text style={[F.small, { color: T.danger }]}>{err}</Text>}
      <Btn
        label={busy ? "Checking…" : "Add agent"}
        kind="primary"
        small
        disabled={busy || !key.trim()}
        onPress={async () => {
          setBusy(true);
          setErr("");
          try {
            const slug =
              a.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "agent";
            await onAdd({ id: `custom:${slug}`, ...a, brand: a.brand || undefined }, key.trim());
            setA({ name: "", brand: "", baseUrl: "https://", model: "", style: "openai-chat" });
            setKey("");
          } catch (e: any) {
            setErr(e?.message || "Could not add the agent.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

/* ---------- the ••• menu ---------- */
export function MenuSheet(p: {
  visible: boolean;
  onClose: () => void;
  tier: Tier;
  connections: Connection[];
  settings: Settings;
  onConnect: (id: ProviderId, model: string, key: string) => Promise<void>;
  onDisconnect: (id: ProviderId) => Promise<void>;
  onModel: (id: ProviderId, m: string) => Promise<void>;
  onAddCustom: (a: CustomAgent, key: string) => Promise<void>;
  onRemoveCustom: (id: string) => Promise<void>;
  onSignIn: () => Promise<boolean>;
  onPro: () => void;
  onRestore: () => void;
  onManage: () => void;
  muse: { pair: () => Promise<unknown>; check: () => Promise<unknown>; unpair: () => Promise<unknown> };
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const conn = Object.fromEntries(p.connections.map((c) => [c.provider, c]));
  const customs = p.settings.customAgents || [];
  const orSigned = customs.some((a) => a.keyRef === "openrouter");
  const paired = p.settings.relay_paired === "1";
  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e: any) {
      setMsg(e?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  };
  const row = (spec: ProviderSpec) => {
    const c = conn[spec.id];
    const custom = customs.find((a) => a.id === spec.id);
    return (
      <View key={spec.id} style={{ gap: 8 }}>
        <Pressable onPress={() => setOpen(open === spec.id ? null : spec.id)} style={s.agentRow}>
          <Dot color={c ? spec.color : T.surface2} size={10} />
          <Text style={[F.head, { flex: 1 }]}>{spec.label}</Text>
          <Text style={[F.small, c && { color: T.passInk }]}>{c ? c.model : "Connect"}</Text>
        </Pressable>
        {open === spec.id && (
          <AgentForm
            spec={spec}
            connection={c}
            shared={!!custom?.keyRef}
            onConnect={(m, k) => p.onConnect(spec.id, m, k)}
            onDisconnect={() => p.onDisconnect(spec.id)}
            onModel={(m) => p.onModel(spec.id, m)}
            onRemove={custom && !custom.managed ? () => p.onRemoveCustom(spec.id) : undefined}
          />
        )}
      </View>
    );
  };
  const builtin = allProviders().filter((x) => !getProvider(x.id)?.custom && !customs.some((a) => a.id === x.id));
  const viaOr = allProviders().filter((x) => customs.find((a) => a.id === x.id)?.keyRef === "openrouter");
  const mine = allProviders().filter((x) => x.custom);
  return (
    <Sheet visible={p.visible} title="Agents & settings" onClose={p.onClose}>
      <Section title="Fastest way in">
        <Btn
          label={orSigned ? "Signed in with OpenRouter ✓ — sign in again" : "Sign in with OpenRouter"}
          kind={orSigned ? "soft" : "primary"}
          disabled={busy}
          onPress={wrap(async () => {
            const ok = await p.onSignIn();
            if (ok) setMsg("Done — Claude, GPT, Grok, Gemini, DeepSeek and Llama are ready.");
          })}
        />
        <Text style={F.small}>
          One login in the browser, no key to copy. Adds Claude, GPT, Grok, Gemini, DeepSeek and Llama, billed by
          OpenRouter. Passfair can't use the logins of other apps on this phone — iOS keeps every app's sign-in private.
        </Text>
        {!!msg && <Text style={[F.small, { color: T.ink }]}>{msg}</Text>}
      </Section>
      {viaOr.length > 0 && <Section title="Via OpenRouter">{viaOr.map(row)}</Section>}
      <Section
        title="Direct to each vendor"
        note="Tip: copy a key on the vendor's page, come back, and tap “Paste copied key”."
      >
        {builtin.map(row)}
        {notConnectable.map((n) => (
          <View key={n.name} style={[s.agentRow, { opacity: 0.6 }]}>
            <Dot color={T.surface2} size={10} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={F.head}>{n.name}</Text>
              <Text style={F.small}>{n.note}</Text>
            </View>
          </View>
        ))}
      </Section>
      <Section title="Your own agents">
        {mine.map(row)}
        <CustomForm locked={!LIMITS[p.tier].customAgents} onAdd={p.onAddCustom} onPro={p.onPro} />
      </Section>
      <Section title="Muse · publishes for you">
        <Text style={F.small}>
          {paired
            ? "Muse is paired. Approved work is handed to Muse according to your Team setting."
            : p.settings.relay_code
              ? `In Muse, connect “Passfair” and enter this one-time code (24 h): ${p.settings.relay_code}`
              : "Pair your own Muse so finished work goes there to publish, and publishing problems come back here."}
        </Text>
        <Row>
          {!paired && (
            <Btn
              label={p.settings.relay_code ? "New code" : "Pair with Muse"}
              small
              disabled={busy}
              onPress={wrap(p.muse.pair)}
            />
          )}
          {!!p.settings.relay_token && <Btn label="Check" small disabled={busy} onPress={wrap(p.muse.check)} />}
          {!!p.settings.relay_token && (
            <Btn label="Unpair" small kind="danger" disabled={busy} onPress={wrap(p.muse.unpair)} />
          )}
        </Row>
      </Section>
      <Section title="Plan">
        <Text style={F.body}>
          {p.tier === "pro" ? "Passfair Pro is active." : "Free plan. Pro features are shown with 🔒."}
        </Text>
        <Row>
          {p.tier !== "pro" && <Btn label="See Pro" kind="primary" small onPress={p.onPro} />}
          <Btn label="Restore purchases" small onPress={p.onRestore} />
          {p.tier === "pro" && <Btn label="Manage subscription" small onPress={p.onManage} />}
        </Row>
      </Section>
      <Section title="About">
        <Btn label="Privacy policy ↗" kind="plain" small onPress={() => Linking.openURL(PRIVACY)} />
        <Text style={F.small}>
          Keys stay in this phone's keychain and go only to the agent's own vendor. No analytics.
        </Text>
      </Section>
    </Sheet>
  );
}

/* ---------- Team ---------- */
export function TeamSheet(p: {
  visible: boolean;
  onClose: () => void;
  tier: Tier;
  connections: Connection[];
  panel: ProviderId[];
  settings: Settings;
  onChange: (patch: Settings) => void;
  onPro: () => void;
}) {
  const L = LIMITS[p.tier];
  const flow = p.settings.flow || "brainstorm";
  const chosen = p.settings.panel?.length ? p.settings.panel : p.panel;
  const canSearch = p.connections.some(
    (c) => c.provider === "perplexity" || getProvider(c.provider)?.search === "tool",
  );
  const toggle = (id: ProviderId) => {
    const on = chosen.includes(id);
    if (!on && chosen.length >= L.agents) return p.onPro();
    p.onChange({ panel: on ? chosen.filter((x) => x !== id) : [...chosen, id] });
  };
  const depth: Depth = p.settings.depth || "standard";
  return (
    <Sheet visible={p.visible} title="Team" onClose={p.onClose}>
      <Section title="How the team works">
        <Row>
          <Chip label="✦ Brainstorm" on={flow === "brainstorm"} onPress={() => p.onChange({ flow: "brainstorm" })} />
          <Chip label="Build directly" on={flow === "build"} onPress={() => p.onChange({ flow: "build" })} />
        </Row>
        <Text style={F.small}>
          {flow === "brainstorm"
            ? "Each agent proposes ideas through a different industry's lens, then they debate each other, a decision matrix picks the winner, and only then the team writes and cross-checks the deliverable."
            : "Plan → draft → polish → two reviewers. Faster; use it when you already know what you want."}
        </Text>
      </Section>
      <Section
        title={`Brainstorm panel · ${chosen.length}/${L.agents}`}
        note={p.tier === "free" ? "Pro: up to 6 agents at once." : undefined}
      >
        {p.connections.length ? (
          <Row>
            {p.connections.map((c) => {
              const on = chosen.includes(c.provider);
              return (
                <Chip
                  key={c.provider}
                  label={`${on ? chosen.indexOf(c.provider) + 1 + " · " : ""}${shortName(c.provider)}`}
                  on={on}
                  color={vendorColor(c.provider)}
                  locked={!on && chosen.length >= L.agents}
                  onPress={() => toggle(c.provider)}
                />
              );
            })}
          </Row>
        ) : (
          <Text style={F.small}>Connect agents first (••• at the top left).</Text>
        )}
        <Text style={F.small}>Seat 1 frames the question and makes the final decision.</Text>
      </Section>
      <Section title="Depth" note={DEPTH[depth].note}>
        <Row>
          {(Object.keys(DEPTH) as Depth[]).map((d) => (
            <Chip key={d} label={DEPTH[d].label} on={depth === d} onPress={() => p.onChange({ depth: d })} />
          ))}
        </Row>
        <Text style={F.small}>
          {DEPTH[depth].debateRounds} debate round{DEPTH[depth].debateRounds === 1 ? "" : "s"} · up to{" "}
          {DEPTH[depth].maxRounds} draft & review rounds{DEPTH[depth].polish ? " · polish pass" : ""}. Every step reuses
          the shared brief from the vendor's cache where the vendor supports it.
        </Text>
      </Section>
      <Section title="Data">
        <ToggleRow
          label="Live web research first"
          note={
            canSearch
              ? "Perplexity (or Claude / GPT / Gemini web search) collects facts with sources before the team starts."
              : "Connect Perplexity, Claude, GPT or Gemini to enable."
          }
          value={!!p.settings.research && L.research}
          locked={!L.research}
          disabled={!canSearch}
          onChange={(v) => (L.research ? p.onChange({ research: v }) : p.onPro())}
        />
      </Section>
      <Section title="Hand off to Muse">
        <Row>
          {(
            [
              ["off", "Only when I say so"],
              ["approved", "When both reviewers approve"],
              ["always", "Always"],
            ] as const
          ).map(([v, l]) => (
            <Chip
              key={v}
              label={l}
              on={(p.settings.autoHandoff || "off") === v}
              onPress={() => p.onChange({ autoHandoff: v })}
            />
          ))}
        </Row>
      </Section>
    </Sheet>
  );
}

/* ---------- Pro ---------- */
export function Paywall(p: {
  visible: boolean;
  onClose: () => void;
  products: ProProduct[];
  busy: boolean;
  note: string;
  onBuy: (id: string) => void;
  onRestore: () => void;
}) {
  return (
    <Sheet visible={p.visible} title="Passfair Pro" onClose={p.onClose}>
      <View style={{ gap: 10 }}>
        <Text style={F.display}>Bigger team. Deeper debate. Your files.</Text>
        {PRO_PITCH.map((x) => (
          <Text key={x} style={F.body}>
            ✓ {x}
          </Text>
        ))}
        <Text style={F.small}>
          You still use your own agent keys — Pro unlocks the app's features, not model credit.
        </Text>
      </View>
      <View style={{ gap: 10 }}>
        {p.products.map((x) => (
          <Btn
            key={x.id}
            label={`${x.period === "yearly" ? "Yearly" : "Monthly"} · ${x.price}`}
            kind={x.period === "yearly" ? "primary" : "soft"}
            disabled={p.busy}
            onPress={() => p.onBuy(x.id)}
          />
        ))}
        {!!p.note && <Text style={F.small}>{p.note}</Text>}
        <Btn label="Restore purchases" kind="plain" disabled={p.busy} onPress={p.onRestore} />
        <Text style={F.small}>
          Payment is charged to your Apple ID. The subscription renews automatically unless cancelled at least 24 hours
          before the end of the period; manage or cancel it in your App Store account settings.
        </Text>
        <Row>
          <Btn label="Terms of Use ↗" kind="plain" small onPress={() => Linking.openURL(TERMS)} />
          <Btn label="Privacy ↗" kind="plain" small onPress={() => Linking.openURL(PRIVACY)} />
        </Row>
      </View>
    </Sheet>
  );
}

/* ---------- History ---------- */
export function HistorySheet(p: { visible: boolean; onClose: () => void; jobs: Job[]; onOpen: (id: string) => void }) {
  return (
    <Sheet visible={p.visible} title="History" onClose={p.onClose}>
      {!p.jobs.length && <Text style={F.small}>Nothing yet.</Text>}
      <View style={{ gap: 4 }}>
        {p.jobs.map((j) => (
          <Pressable key={j.id} onPress={() => p.onOpen(j.id)} style={s.histRow}>
            <Text style={F.head} numberOfLines={2}>
              {j.mode === "demo" ? "Sample · " : ""}
              {j.goal}
            </Text>
            <Text style={F.small}>
              {new Date(j.created).toLocaleString()} · {j.flow === "brainstorm" ? "Brainstorm" : "Build"} ·{" "}
              {j.status.replace("_", " ")}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/* ---------- Who is doing what (tap the logo) ---------- */
export function WorkSheet(p: { visible: boolean; onClose: () => void; job: Job | null; running: boolean }) {
  const j = p.job;
  const seats = j?.panel || [];
  return (
    <Sheet visible={p.visible} title={p.running ? "Agents at work" : "Team"} onClose={p.onClose}>
      {!j ? (
        <Text style={F.small}>Start a brief to see the team here.</Text>
      ) : (
        <>
          <Section title="Now">
            <Text style={F.body}>
              {p.running
                ? `Working: ${j.current?.role || "starting"}${j.current?.round ? ` · round ${j.current.round}` : ""}`
                : `Status: ${j.status.replace("_", " ")}`}
            </Text>
            <Text style={F.small}>
              {j.usage.calls} AI calls · {(j.usage.input + j.usage.output).toLocaleString()} tokens
            </Text>
          </Section>
          {seats.length > 0 && (
            <Section title="Brainstorm panel">
              {seats.map((id, i) => {
                const mine = j.events.filter((e) => e.seat === i && (e.stage === "ideas" || e.stage === "debate"));
                return (
                  <View key={i} style={s.agentRow}>
                    <Dot color={vendorColor(id)} size={10} />
                    <View style={{ flex: 1 }}>
                      <Text style={F.head}>{seatName(j, i)}</Text>
                      <Text style={F.small}>
                        {j.lenses?.[i] ? `Lens: ${j.lenses[i]} · ` : ""}
                        {mine.length} contribution{mine.length === 1 ? "" : "s"}
                        {mine.some((e) => e.failed) ? " · one failed" : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Section>
          )}
          <Section title="Build seats">
            {Object.entries(j.assignments)
              .filter(([, v]) => v)
              .map(([role, v]) => (
                <Text key={role} style={F.body}>
                  {role}: {shortName(v as string)}
                </Text>
              ))}
          </Section>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Full-screen reader ---------- */
export function Reader(p: { visible: boolean; onClose: () => void; title: string; text: string }) {
  return (
    <Sheet visible={p.visible} title="Final" onClose={p.onClose}>
      <Text style={F.display}>{p.title}</Text>
      <Markdown text={p.text} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  form: { backgroundColor: T.surface, borderRadius: 20, padding: 14, gap: 10 },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  histRow: { paddingVertical: 12, gap: 4 },
});
