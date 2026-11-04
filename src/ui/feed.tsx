// The conversation, full width. Events are grouped into the stages the team went through, so the user sees
// agents framing, proposing ideas through other industries' lenses, debating each other, deciding, building
// and reviewing — not a wall of copy-pasted text.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { seatName } from "../core/brainstorm";
import type { Job, JobEvent, LiveTurn } from "../core/orchestrator";
import { shortName } from "../core/providers";
import { Dot } from "./kit";
import { Markdown, blockCount } from "./markdown";
import { F, T, vendorColor } from "./theme";

type Group = { key: string; title: string; note?: string; events: JobEvent[] };

function groupKey(e: JobEvent): { key: string; title: string } {
  if (e.role === "feedback")
    return { key: `fb-${e.at}`, title: e.source === "you" ? "You" : `${shortName(e.source || "")} reported a problem` };
  if (e.stage === "media") return { key: "media", title: "Looked at your files" };
  if (e.stage === "research") return { key: "research", title: "Live research" };
  if (e.stage === "frame") return { key: "frame", title: "Framing the question" };
  if (e.stage === "ideas") return { key: "ideas", title: "Ideas · each agent through a different industry" };
  if (e.stage === "debate") return { key: `debate-${e.round}`, title: `Debate · round ${e.round}` };
  if (e.stage === "decision") return { key: "decision", title: "Decision" };
  if (e.role === "planner") return { key: "plan", title: "Plan" };
  if (e.role === "handoff" || e.role === "published") return { key: `muse-${e.at}`, title: "Muse" };
  return { key: `build-${e.round}`, title: `Draft & review · round ${e.round}` };
}
export function groups(job: Job): Group[] {
  const out: Group[] = [];
  for (const e of job.events) {
    const g = groupKey(e);
    const last = out[out.length - 1];
    if (last && last.key === g.key) last.events.push(e);
    else out.push({ ...g, events: [e] });
  }
  return out;
}

function who(job: Job, e: JobEvent): string {
  if (e.role === "check") return "Passfair · automatic check";
  if (e.seat !== undefined && (e.role === "panelist" || e.role === "framer" || e.role === "decider"))
    return seatName(job, e.seat);
  const role: Record<string, string> = {
    worker: "Draft",
    polisher: "Polish",
    reviewer: "Review",
    verifier: "Cross-check",
    planner: "Plan",
    seer: "Read the files",
    researcher: "Research",
  };
  return `${shortName(e.provider)}${role[e.role] ? ` · ${role[e.role]}` : ""}`;
}

function Review({ e }: { e: JobEvent }) {
  const r = e.review!;
  const [open, setOpen] = useState(false);
  const pass = r.verdict === "pass";
  const met = r.criteria?.filter((c) => c.met).length ?? 0;
  return (
    <View style={[f.review, { backgroundColor: pass ? T.pass : T.revise }]}>
      <Text style={[F.head, { color: pass ? T.passInk : T.reviseInk }]}>
        {pass ? "Pass" : "Revise"}
        {r.score !== null ? ` · ${r.score}/10` : ""}
        {r.criteria?.length ? ` · ${met}/${r.criteria.length} requirements met` : ""}
      </Text>
      {!!r.summary && <Text style={F.body}>{r.summary}</Text>}
      {r.issues.length > 0 && (
        <Pressable onPress={() => setOpen(!open)} hitSlop={6}>
          <Text style={f.link}>
            {r.issues.length} issue{r.issues.length > 1 ? "s" : ""} {open ? "▴" : "▾"}
          </Text>
        </Pressable>
      )}
      {open &&
        r.issues.map((i, k) => (
          <Text key={k} style={F.small}>
            <Text style={{ fontWeight: "400", color: T.ink }}>{i.severity.toUpperCase()}</Text> · {i.where}: {i.problem}{" "}
            → {i.fix}
          </Text>
        ))}
    </View>
  );
}

function EventView({
  job,
  e,
  isFinalDraft,
  onReport,
}: {
  job: Job;
  e: JobEvent;
  isFinalDraft: boolean;
  onReport?: (e: JobEvent) => void;
}) {
  // Agents start ideas and debate turns with a one-line TL;DR; show just that until the user opens it.
  const tldr =
    (e.stage === "ideas" || e.stage === "debate") && /^TL;DR[:：]/i.test(e.text.trim())
      ? e.text
          .trim()
          .split("\n")[0]
          .replace(/^TL;DR[:：]\s*/i, "")
      : "";
  const long = !!tldr || blockCount(e.text) > 8;
  const startOpen = e.stage === "decision" || e.stage === "frame" || e.role === "feedback";
  const [open, setOpen] = useState(startOpen || !long);
  if (e.role === "feedback")
    return (
      <View style={f.mine}>
        <Text style={[F.body, { color: T.white }]}>{e.text}</Text>
      </View>
    );
  if (e.role === "handoff" || e.role === "published") return <Text style={F.small}>{e.text}</Text>;
  return (
    <View style={{ gap: 8, opacity: e.failed ? 0.55 : 1 }}>
      <View style={f.who}>
        <Dot color={vendorColor(e.provider)} />
        <Text style={F.head}>{who(job, e)}</Text>
        {!!onReport && e.role !== "check" && !e.failed && (
          <Pressable onPress={() => onReport(e)} hitSlop={8} accessibilityLabel="Report this content">
            <Text style={[F.small, { color: T.faint }]}>Report</Text>
          </Pressable>
        )}
        {!!e.model && e.provider !== "demo" && e.role !== "check" && (
          <Text style={[F.small, { color: T.faint }]}>{e.model}</Text>
        )}
      </View>
      {!!e.lens && (
        <View style={f.lens}>
          <Text style={[F.small, { color: T.ink, fontWeight: "400" }]}>↗ Borrowing from {e.lens}</Text>
        </View>
      )}
      {e.review ? (
        <Review e={e} />
      ) : isFinalDraft ? (
        <Text style={F.small}>This draft is the final version below.</Text>
      ) : (
        <>
          {tldr && !open ? <Text style={F.body}>{tldr}</Text> : <Markdown text={e.text} limit={open ? undefined : 6} />}
          {long && (
            <Pressable onPress={() => setOpen(!open)} hitSlop={6}>
              <Text style={f.link}>{open ? "Show less" : "Show all"}</Text>
            </Pressable>
          )}
        </>
      )}
      {!!e.notes && (
        <View style={f.notes}>
          <Text style={F.label}>WHAT CHANGED IN THIS DRAFT</Text>
          <Markdown text={e.notes} />
        </View>
      )}
      {!!e.condensed && (
        <Text style={[F.small, { color: T.faint }]}>Earlier discussion was condensed to fit {e.model}'s memory.</Text>
      )}
      {!!e.continued && (
        <Text style={[F.small, { color: T.faint }]}>Continued {e.continued}× so the answer arrived whole.</Text>
      )}
    </View>
  );
}

// An agent's turn while it is still writing: its words appear as they arrive.
function LiveView({ job, t }: { job: Job; t: LiveTurn }) {
  const e = { ...t, at: "", usage: { input: 0, output: 0 } } as unknown as JobEvent;
  return (
    <View style={{ gap: 8 }}>
      <View style={f.who}>
        <Dot color={vendorColor(t.provider)} />
        <Text style={F.head}>{who(job, e)}</Text>
        {!!t.model && t.provider !== "demo" && <Text style={[F.small, { color: T.faint }]}>{t.model}</Text>}
      </View>
      {t.text ? (
        <Markdown text={`${t.text} ▍`} />
      ) : (
        <Text style={[F.small, { color: T.faint }]}>{ACTIVITY[t.role] || "working"}…</Text>
      )}
    </View>
  );
}

export function Feed({ job, onReport, live = [] }: { job: Job; onReport?: (e: JobEvent) => void; live?: LiveTurn[] }) {
  const finalDraftAt = (() => {
    if (!job.final) return -1;
    for (let i = job.events.length - 1; i >= 0; i--) {
      const e = job.events[i];
      if ((e.role === "worker" || e.role === "polisher") && e.text === job.final) return i;
    }
    return -1;
  })();
  return (
    <View style={{ gap: 26 }}>
      {groups(job).map((g) => (
        <View key={g.key} style={{ gap: 14 }}>
          {!g.key.startsWith("fb-") && <Text style={F.label}>{g.title.toUpperCase()}</Text>}
          {g.events.map((e) => (
            <EventView
              key={e.at + e.role + (e.seat ?? "")}
              job={job}
              e={e}
              isFinalDraft={job.events.indexOf(e) === finalDraftAt}
              onReport={onReport}
            />
          ))}
        </View>
      ))}
      {live.length > 0 && (
        <View style={{ gap: 14 }}>
          {(() => {
            const g = groupKey({ ...live[0], at: "" } as unknown as JobEvent);
            const last = groups(job).slice(-1)[0];
            return last?.key === g.key ? null : <Text style={F.label}>{g.title.toUpperCase()}</Text>;
          })()}
          {live.map((t) => (
            <LiveView key={`${t.role}|${t.round}|${t.stage || ""}|${t.seat ?? ""}`} job={job} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

const ACTIVITY: Record<string, string> = {
  seer: "reading your files",
  researcher: "searching the web",
  framer: "framing the question",
  panelist: "thinking",
  decider: "weighing the options",
  planner: "planning",
  worker: "drafting",
  polisher: "polishing",
  reviewer: "reviewing",
  verifier: "cross-checking",
};
export function Working({ job }: { job: Job }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(t);
  }, []);
  const role = job.current?.role || "planner";
  const many = role === "panelist";
  const name = many
    ? (job.panel || []).map((_, i) => seatName(job, i)).join(", ")
    : shortName((role === "framer" || role === "decider" ? job.panel?.[0] : job.assignments[role]) || "demo");
  return (
    <View style={f.who}>
      <ActivityIndicator color={T.purple} />
      <Text style={F.small}>
        {name} {many ? "are" : "is"} {ACTIVITY[role] || "working"}
        {many && job.current?.round ? ` (debate round ${job.current.round})` : ""}
        {dots}
        {"\n"}You can switch apps — Passfair carries on, or picks up where it left off when you come back.
      </Text>
    </View>
  );
}

// Plain facts under the final result: what actually ran and what is still unverified.
export function RunFacts({ job }: { job: Job }) {
  const fr = job.finalRound;
  const finalReviews = job.events.filter(
    (e) => e.round === fr && e.review && (e.role === "reviewer" || e.role === "verifier"),
  );
  const assumptions = Array.from(new Set(finalReviews.flatMap((e) => e.review?.assumptions || []))).slice(0, 6);
  const crit = finalReviews.flatMap((e) => e.review?.criteria || []);
  const models = Array.from(new Set(job.events.filter((e) => e.usage.input || e.usage.output).map((e) => e.model)));
  const ideas = job.events.filter((e) => e.stage === "ideas" && !e.failed).length;
  const debates = new Set(job.events.filter((e) => e.stage === "debate").map((e) => e.round)).size;
  return (
    <View style={{ gap: 4 }}>
      <Text style={F.small}>
        {job.flow === "brainstorm" ? `${ideas} agents · ${debates} debate round${debates === 1 ? "" : "s"} · ` : ""}
        {job.usage.calls} AI calls · {(job.usage.input + job.usage.output).toLocaleString()} tokens
        {models.length ? ` · ${models.join(", ")}` : ""}
        {crit.length ? ` · requirements met: ${crit.filter((c) => c.met).length}/${crit.length}` : ""}
        {job.usage.cached && job.usage.input
          ? ` · ${Math.round((100 * job.usage.cached) / job.usage.input)}% of input from cache`
          : ""}
      </Text>
      {assumptions.length > 0 && <Text style={F.small}>Still unverified: {assumptions.join(" · ")}</Text>}
    </View>
  );
}

const f = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  lens: {
    alignSelf: "flex-start",
    backgroundColor: T.limeSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  review: { borderRadius: 18, padding: 14, gap: 6 },
  notes: { backgroundColor: T.purpleSoft, borderRadius: 16, padding: 12, gap: 6 },
  mine: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    backgroundColor: T.ink,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  link: { color: T.purple, fontWeight: "400", fontSize: 14 },
});
