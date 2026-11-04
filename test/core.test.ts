import assert from "node:assert/strict";
import { test } from "node:test";
import {
  numberedIssues,
  roundReviews,
  bestRound,
  feedbackEvent,
  newJob,
  parseReview,
  promptFor,
  reopenWithFeedback,
  runJob,
  type Job,
} from "../src/core/orchestrator";
import { complete, verify } from "../src/core/providers";
import { autoAssign } from "../src/core/assign";

const deps = (job: Job, extra: Partial<Parameters<typeof runJob>[1]> = {}) => ({
  save: () => {},
  isCancelled: () => false,
  credential: () => null,
  demoDelay: 0,
  sleep: async () => {},
  ...extra,
});

test("demo loop: plan → draft → revise → pass, final deliverable set", async () => {
  const job = newJob({
    goal: "Write a welcome note",
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", polisher: "demo", reviewer: "demo" },
  });
  await runJob(job, deps(job));
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.outcome, "demo"); // a demo is never "approved"
  const roles = job.events.map((e) => e.role);
  assert.deepEqual(roles, ["planner", "worker", "polisher", "reviewer", "worker", "polisher", "reviewer"]);
  assert.match(job.final, /post one thing you built/);
  assert.doesNotMatch(job.final, /Point [AB]|TBD|REVISION NOTES/);
  assert.ok(job.events.find((e) => e.role === "worker" && e.round === 2)?.notes);
  assert.equal(job.version, 1);
});

test("cut in: user feedback re-enters the loop with top priority", async () => {
  const job = newJob({
    goal: "Draft a post",
    mode: "demo",
    preset: "balanced",
    assignments: { planner: "demo", worker: "demo", reviewer: "demo" },
  });
  await runJob(job, deps(job));
  reopenWithFeedback(job, "you", "Make it in French.");
  assert.equal(job.status, "queued");
  const p = promptFor(job, "worker", 3);
  assert.match(p, /NEW INSTRUCTION FROM THE USER/);
  await runJob(job, deps(job));
  assert.equal(job.version, 2);
  assert.ok(job.events.some((e) => e.role === "feedback" && e.source === "you"));
  assert.match(job.final, /redirected by you/);
});

test("muse problem re-opens a finished job and reviewer passes after fix", async () => {
  const job = newJob({
    goal: "Landing copy",
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", polisher: "demo", reviewer: "demo" },
  });
  await runJob(job, deps(job));
  reopenWithFeedback(job, "muse", "Title exceeds 60 characters.");
  assert.match(promptFor(job, "reviewer", 3), /FEEDBACK THAT HAD TO BE ADDRESSED/);
  assert.match(promptFor(job, "worker", 3), /FEEDBACK REPORTED FROM MUSE/);
  await runJob(job, deps(job));
  assert.equal(job.outcome, "demo"); // a demo is never "approved"
  assert.match(job.final, /muse/);
});

test("stop: cancelled run leaves no half events after the abort", async () => {
  const job = newJob({
    goal: "x",
    mode: "demo",
    preset: "balanced",
    assignments: { planner: "demo", worker: "demo", reviewer: "demo" },
  });
  let n = 0;
  await runJob(job, deps(job, { isCancelled: () => ++n > 2 }));
  assert.equal(job.status, "running"); // caller marks stopped
  assert.ok(job.events.length <= 2);
});

test("parseReview is tolerant and strict about 'pass'", () => {
  assert.equal(parseReview('Sure! {"verdict":"pass","score":9,"issues":[]}').verdict, "pass");
  assert.equal(
    parseReview('{"verdict":"pass","score":9,"issues":[{"severity":"high","problem":"x"}]}').verdict,
    "revise",
  );
  const r = parseReview("not json at all");
  assert.equal(r.verdict, "revise");
  assert.ok(r.unparsed);
  assert.equal(parseReview('{"verdict":"pass","score":42}').score, 10);
});

test("parseReview never passes a low score", () => {
  assert.equal(parseReview('{"verdict":"pass","score":7,"issues":[]}').verdict, "revise");
  assert.equal(parseReview('{"verdict":"pass","score":8,"issues":[]}').verdict, "pass");
});

test("feedbackEvent shapes", () => {
  assert.equal(feedbackEvent("you", "p", 1).review?.issues[0].fix, "Follow the user's new instruction.");
  assert.match(feedbackEvent("muse", "p", 1).review?.summary || "", /muse/);
});

test("providers: wire formats and secret-safe errors", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake =
    (out: unknown, status = 200) =>
    async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof out === "string" ? out : JSON.stringify(out), { status });
    };
  const base = { model: "m", key: "SECRET", system: "s", prompt: "hi", maxTokens: 50 } as const;
  let r = await complete(
    { ...base, provider: "anthropic" },
    fake({
      content: [{ type: "text", text: "claude" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    }),
  );
  assert.equal(r.text, "claude");
  const h = calls.at(-1)!.init.headers as Record<string, string>;
  assert.equal(h["x-api-key"], "SECRET");
  assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  r = await complete(
    { ...base, provider: "openai" },
    fake({ output_text: "gpt", usage: { input_tokens: 1, output_tokens: 2 }, status: "completed" }),
  );
  assert.equal(r.text, "gpt");
  assert.equal((calls.at(-1)!.init.headers as any).Authorization, "Bearer SECRET");
  r = await complete(
    { ...base, provider: "google" },
    fake({ candidates: [{ content: { parts: [{ text: "gem" }] }, finishReason: "STOP" }] }),
  );
  assert.equal(r.text, "gem");
  assert.match(calls.at(-1)!.url, /models\/m:generateContent$/);
  await assert.rejects(
    () => complete({ ...base, provider: "openai" }, fake("the prompt was: hi SECRET", 401)),
    (e: any) => /401/.test(e.message) && !/SECRET/.test(e.message),
  );
  await assert.rejects(
    () => complete({ ...base, provider: "openai" }, fake({ error: { message: "SECRET leak" } })),
    (e: any) => !/SECRET/.test(e.message),
  );
  const v = await verify(
    { provider: "anthropic", model: "m", key: "k" },
    fake({ content: [{ type: "text", text: "OK" }] }),
  );
  assert.equal(v.ok, true);
});

test("autoAssign puts Claude on logic/review and GPT on polish when both are connected", () => {
  const a = autoAssign("make_and_ship", ["openai", "anthropic"]);
  assert.deepEqual(a, {
    planner: "anthropic",
    worker: "anthropic",
    polisher: "openai",
    reviewer: "anthropic",
    verifier: "openai",
  });
  const b = autoAssign("balanced", ["google"]);
  assert.deepEqual(b, { planner: "google", worker: "google", reviewer: "google" });
  assert.equal(autoAssign("balanced", []).planner, "demo");
});

test("cross-check: two vendors review every round; pass needs both", async () => {
  const job = newJob({
    goal: "Launch post",
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", polisher: "demo", reviewer: "demo", verifier: "demo" },
    minRounds: 2,
    maxRounds: 4,
  });
  await runJob(job, deps(job));
  const roles = job.events.map((e) => e.role);
  assert.deepEqual(roles, [
    "planner",
    "worker",
    "polisher",
    "reviewer",
    "verifier",
    "worker",
    "polisher",
    "reviewer",
    "verifier",
  ]);
  assert.equal(job.outcome, "demo"); // a demo is never "approved"
  assert.equal(job.finalRound, 2);
  assert.equal(job.rounds!.length, 2);
  assert.equal(job.rounds![0].passed, false);
  // The worker in round 2 saw issues from both seats.
  const p = promptFor(job, "worker", 2);
  assert.match(p, /ISSUES FROM BOTH REVIEWERS/);
  const r1 = numberedIssues(roundReviews(job, 1));
  assert.match(r1, /^I1 \[high\] reviewer:/m);
  assert.match(r1, /cross-checker:/);
});

test("autoAssign: second reviewer is always a different vendor; none with one vendor", () => {
  for (const preset of ["balanced", "code_first", "copy_first", "make_and_ship"] as const) {
    const a = autoAssign(preset, ["anthropic", "openai"]);
    assert.ok(a.verifier && a.verifier !== a.reviewer, preset);
  }
  assert.equal(autoAssign("make_and_ship", ["anthropic"]).verifier, undefined);
});

// A scripted fetcher: reviewers answer from a queue, drafts are numbered.
function scripted(verdicts: string[]) {
  let n = 0;
  return async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const sys = JSON.stringify(body);
    const isReview = /Your role: REVIEWER/.test(sys);
    const prompt = JSON.stringify(body.messages || "");
    const text = isReview
      ? verdicts.shift()!
      : /Your role: PLANNER/.test(sys)
        ? "plan\nC1. covers the spec"
        : /ISSUES FROM|FEEDBACK REPORTED|NEW INSTRUCTION/.test(prompt)
          ? `draft ${++n}\n=== REVISION NOTES ===\nI1: fixed`
          : `draft ${++n}`;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
const PASS = (score: number) =>
  `{"verdict":"pass","score":${score},"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"draft text"}],"issues":[]}`;
const REVISE = `{"verdict":"revise","score":5,"summary":"no","issues":[{"severity":"high","where":"x","problem":"p","fix":"f"}]}`;
const live = (extra: object) =>
  newJob({
    goal: "Spec",
    mode: "live",
    preset: "balanced",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "anthropic", verifier: "anthropic" },
    ...extra,
  });
const cred = () => ({ provider: "anthropic" as const, model: "m", key: "k" });

test("minimum rounds: a first-round pass still gets a second cross-check round", async () => {
  const job = live({ minRounds: 2, maxRounds: 4 });
  await runJob(job, deps(job, { credential: cred, fetcher: scripted([PASS(8), PASS(8), PASS(9), PASS(9)]) as any }));
  assert.equal(job.events.filter((e) => e.role === "worker").length, 2);
  assert.equal(job.finalRound, 2);
  assert.equal(job.outcome, "approved_by_reviewer");
});

test("best round wins: a later regression does not replace an approved draft", async () => {
  const job = live({ minRounds: 3, maxRounds: 3 });
  await runJob(
    job,
    deps(job, { credential: cred, fetcher: scripted([REVISE, PASS(8), PASS(9), PASS(9), REVISE, PASS(8)]) as any }),
  );
  assert.equal(job.finalRound, 2);
  assert.equal(job.final, "draft 2");
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(bestRound(job)!.round, 2);
});

test("no round passes both: outcome is not approved, so auto hand-off on approval stays off", async () => {
  const job = live({ minRounds: 1, maxRounds: 2 });
  await runJob(job, deps(job, { credential: cred, fetcher: scripted([PASS(9), REVISE, REVISE, PASS(9)]) as any }));
  assert.equal(job.outcome, "round_limit_reached");
});

test("muse problem with cross-check: final comes from a round after the feedback", async () => {
  const job = newJob({
    goal: "Store listing",
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", polisher: "demo", reviewer: "demo", verifier: "demo" },
    minRounds: 2,
    maxRounds: 4,
  });
  await runJob(job, deps(job));
  reopenWithFeedback(job, "muse", "Title over 30 characters, rejected by the store.");
  await runJob(job, deps(job));
  assert.equal(job.outcome, "demo"); // a demo is never "approved"
  assert.ok(job.finalRound! > 2);
  assert.match(job.final, /muse/);
});
