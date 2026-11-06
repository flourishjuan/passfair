// The conversation for a "collection" job: the question, then every AI's own answer under its own name.
// White page, no coloured cards, no internal steps — only what the agents wrote.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { vendorName } from "../core/collection";
import type { Job, JobEvent, LiveTurn } from "../core/orchestrator";
import { Markdown } from "./markdown";
import { F, T } from "./theme";

// Answers can't be selected or copied from the page (the input field still accepts paste).

function Piece({ name, text, failed, live }: { name: string; text: string; failed?: boolean; live?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={F.head}>{name}</Text>
      {failed ? (
        <Text style={[F.small, { color: T.faint }]}>{text}</Text>
      ) : text ? (
        <Markdown text={live ? `${text} ▍` : text} />
      ) : (
        <Text style={[F.small, { color: T.faint }]}>writing…</Text>
      )}
    </View>
  );
}

function Question({ text }: { text: string }) {
  return (
    <View style={c.question}>
      <Text style={F.body} selectable>
        {text}
      </Text>
    </View>
  );
}

// Blocks in reading order: answers by screen, then each follow-up with its replies, then the debate.
function blocks(job: Job, live: LiveTurn[]) {
  const out: { key: string; q?: string; label?: string; items: JobEvent[] }[] = [];
  const answers = job.events.filter((e) => e.role === "answer");
  const screens = [
    ...new Set([...answers.map((e) => e.round), ...live.filter((t) => t.role === "answer").map((t) => t.round)]),
  ].sort((a, b) => a - b);
  for (const s of screens) out.push({ key: `a${s}`, items: answers.filter((e) => e.round === s) });
  const followUps = job.events.filter((e) => e.role === "feedback" && e.source === "you");
  for (const f of followUps)
    out.push({
      key: `f${f.round}`,
      q: f.text,
      items: job.events.filter((e) => e.role === "followup" && e.round === f.round),
    });
  const debate = job.events.filter((e) => e.role === "debater");
  if (debate.length) out.push({ key: "debate", label: "Debate", items: debate });
  return out;
}

export function CollectionView({
  job,
  live,
  running,
  onChoose,
}: {
  job: Job;
  live: LiveTurn[];
  running: boolean;
  onChoose: (title: string | null) => void;
}) {
  const st = job.collection!;
  const liveFor = (role: string, round: number) => live.filter((t) => t.role === role && t.round === round);
  return (
    <View style={{ gap: 26 }}>
      <Question text={job.goal} />
      {job.status === "awaiting_choice" && st.directions?.length ? (
        <View style={{ gap: 4 }}>
          {st.directions.map((d) => (
            <Pressable key={d.title} onPress={() => onChoose(d.title)} style={c.option} accessibilityRole="button">
              <Text style={F.head}>{d.title}</Text>
              {!!d.line && <Text style={F.small}>{d.line}</Text>}
            </Pressable>
          ))}
          <Pressable onPress={() => onChoose(null)} style={c.option} accessibilityRole="button">
            <Text style={[F.small, { color: T.ink }]}>No preference — cover everything</Text>
          </Pressable>
        </View>
      ) : null}
      {blocks(job, running ? live : []).map((b) => {
        const role = b.key.startsWith("a") ? "answer" : b.key.startsWith("f") ? "followup" : "debater";
        const round = role === "debater" ? 0 : Number(b.key.slice(1));
        const typing = running
          ? role === "debater"
            ? live.filter((t) => t.role === "debater")
            : liveFor(role, round)
          : [];
        const done = new Set(b.items.map((e) => `${e.provider}|${e.round}`));
        return (
          <View key={b.key} style={{ gap: 22 }}>
            {!!b.q && <Question text={b.q} />}
            {!!b.label && <Text style={F.label}>{b.label.toUpperCase()}</Text>}
            {b.items.map((e, i) => (
              <Piece
                key={`${e.provider}${e.round}${i}`}
                name={vendorName(e.provider)}
                text={e.text}
                failed={e.failed}
              />
            ))}
            {typing
              .filter((t) => !done.has(`${t.provider}|${t.round}`))
              .map((t) => (
                <Piece key={`${t.provider}${t.round}live`} name={vendorName(t.provider)} text={t.text} live />
              ))}
          </View>
        );
      })}
      {running && live.some((t) => t.role === "debater") && !job.events.some((e) => e.role === "debater") && (
        <View style={{ gap: 22 }}>
          <Text style={F.label}>DEBATE</Text>
          {live
            .filter((t) => t.role === "debater")
            .map((t) => (
              <Piece key={`${t.provider}${t.round}dl`} name={vendorName(t.provider)} text={t.text} live />
            ))}
        </View>
      )}
      {running && job.status === "running" && !live.length && (
        <Text style={[F.small, { color: T.faint }]}>Reading your question…</Text>
      )}
    </View>
  );
}

/** "Continue" label: the next items of a list, or simply more of an open answer. */
export function continueLabel(job: Job): string | null {
  const st = job.collection;
  if (!st || job.status !== "partial") return null;
  if (st.constraints.count) {
    if (st.done >= st.total) return null;
    const from = st.done * st.segSize + 1;
    const to = Math.min((st.done + 1) * st.segSize, st.constraints.count);
    return `Continue · ${from}–${to} of ${st.constraints.count}`;
  }
  return "Continue";
}

const c = StyleSheet.create({
  question: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line },
  option: { paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line },
});
