import assert from "node:assert/strict";
import { test } from "node:test";
import { autoAssign } from "../src/core/assign";
import { newJob, qualityGate, runJob, systemFor } from "../src/core/orchestrator";
import { DEPTH } from "../src/core/plan";

const PASS = JSON.stringify({ verdict: "pass", score: 9, summary: "ok", criteria: [], issues: [], assumptions: [] });
function timedFetcher(ms = 40) {
  const log: { kind: string; start: number; end: number }[] = [];
  const t0 = Date.now();
  const fetcher = async (_u: string, init: any) => {
    const b = String(init.body);
    const kind = b.includes("JSON only")
      ? "review"
      : b.includes("ROLE: RESEARCH") || b.includes("live web search")
        ? "research"
        : b.includes("FRAMER")
          ? "frame"
          : "other";
    const start = Date.now() - t0;
    await new Promise((r) => setTimeout(r, ms));
    log.push({ kind, start, end: Date.now() - t0 });
    const text =
      kind === "review"
        ? PASS
        : "## Answer\nGo with the cart (estimate: 40 cups/day — typical campus cart).\n\n## Why\n" +
          "Reason. ".repeat(60);
    return new Response(
      JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }),
    );
  };
  return { fetcher, log };
}
const cred = (p: string) => ({
  provider: p,
  model: p === "anthropic" ? "claude-sonnet-4-5" : "claude-sonnet-4-5",
  key: `k-${p}`,
});

test("both reviewers read the draft at the same time", async () => {
  const { fetcher, log } = timedFetcher();
  const job = newJob({
    goal: "Write a two-week launch plan for a campus coffee cart, with prices and risks.",
    mode: "live",
    preset: "make_and_ship",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "openai", verifier: "anthropic" },
    maxRounds: 1,
  });
  job.saver = DEPTH.standard.saver;
  // both on the Anthropic wire format so the fake reply parses; separate keys so they may run together
  await runJob(job, {
    save: () => {},
    isCancelled: () => false,
    credential: (p) => ({ ...cred(p), provider: "anthropic" }),
    fetcher: fetcher as any,
    sleep: async () => {},
  });
  const reviews = log.filter((l) => l.kind === "review");
  assert.equal(reviews.length, 2);
  assert.ok(reviews[1].start < reviews[0].end, "second review started before the first finished");
});

test("Standard: up to two drafts; Quick and Standard no longer wait for the first reviewer", () => {
  assert.equal(DEPTH.standard.maxRounds, 2);
  assert.ok(!DEPTH.standard.saver.crossOnPassOnly && !DEPTH.quick.saver.crossOnPassOnly);
});

test("the deliverable rules reach the writer; the reviewers check logic, ids and number sources", () => {
  const job = newJob({ goal: "x", mode: "live", preset: "make_and_ship", assignments: {} });
  const w = systemFor(job, "worker");
  assert.match(w, /never use internal ids/);
  assert.match(w, /\(1\) the answer in one to three sentences/);
  assert.match(w, /about 800 words/);
  for (const r of ["reviewer", "verifier"] as const) {
    const s = systemFor(job, r);
    assert.match(s, /check LOGIC as its own category/);
    assert.match(s, /numbers given without a source/);
  }
  assert.match(systemFor(job, "panelist", 0, 1), /carries its basis/);
});

test("the automatic check sends back a deliverable that leaks discussion ids", () => {
  const job = newJob({
    goal: "Rank three side projects for me with reasons.",
    mode: "live",
    preset: "make_and_ship",
    assignments: {},
  });
  job.events.push({
    role: "worker",
    round: 1,
    provider: "anthropic",
    model: "m",
    text: "## Ranking\n1. A-2: clinical trial recruiting\n2. B-H1: HR matching\n" + "word ".repeat(200),
    usage: { input: 0, output: 0 },
    at: "",
  });
  const g = qualityGate(job, 1);
  assert.equal(g.verdict, "revise");
  assert.ok(g.issues.some((i) => /Internal discussion ids/.test(i.problem)));
  // A brief that itself uses such codes (e.g. part numbers A-1, A-2) is left alone.
  const own = newJob({
    goal: "Compare parts A-1 and A-2 for the robot arm.",
    mode: "live",
    preset: "make_and_ship",
    assignments: {},
  });
  own.events.push({ ...job.events[0] });
  assert.ok(!qualityGate(own, 1).issues.some((i) => /Internal discussion ids/.test(i.problem)));
});

test("the writer is never its own main reviewer", () => {
  for (const team of [
    ["anthropic", "openai"],
    ["openai", "google", "anthropic"],
    ["xai", "deepseek"],
  ]) {
    const a = autoAssign("make_and_ship", team);
    assert.notEqual(a.reviewer, a.worker, team.join(","));
  }
});
