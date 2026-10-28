import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
  assert.equal(job.outcome, "approved_by_reviewer");
  const roles = job.events.map((e) => e.role);
  assert.deepEqual(roles, ["planner", "worker", "polisher", "reviewer", "worker", "polisher", "reviewer"]);
  assert.ok(job.final.includes("revised"));
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
  assert.equal(job.outcome, "approved_by_reviewer");
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
  assert.deepEqual(a, { planner: "anthropic", worker: "anthropic", polisher: "openai", reviewer: "anthropic" });
  const b = autoAssign("balanced", ["google"]);
  assert.deepEqual(b, { planner: "google", worker: "google", reviewer: "google" });
  assert.equal(autoAssign("balanced", []).planner, "demo");
});
