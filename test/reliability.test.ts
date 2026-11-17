// Upgrade regression tests: collaboration blockers and recovery after review failure.
// 1. Missing structured revision notes must not block a round the reviewers approved.
// 2. Any reviewer API failure (main or cross-checker) pauses the run resumably - it never kills the
//    run and never approves a round with fewer reviews than the job was set up with.
// 3. A run stopped mid-round resumes at the review of the saved draft - never re-drafts blindly,
//    and never approves a round nobody reviewed.
// 4. Automatic review retries are bounded (attempt cap + cooldown), so reopening the app cannot
//    fire unlimited paid reviewer calls; after the cap, carrying on is an explicit tap on Resume.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approvalOf, newJob, runJob, type Job } from "../src/core/orchestrator";
import { AUTO_RESUME_MAX_ATTEMPTS, shouldAutoResume } from "../src/core/resume";

const PASS = `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"quoted line"}],"issues":[]}`;
const REVISE = `{"verdict":"revise","score":6,"summary":"fix it","criteria":[{"id":"C1","met":false,"evidence":""}],"issues":[{"severity":"high","where":"end","problem":"no stop rule","fix":"add one"}]}`;

const D1 = "First draft: sell the match report at $490 (estimate: 6 h at $80/h). Stop after 30 unsold offers.";
const D2 = "Revised draft: sell the partner match report at $490 (estimate: 6 h at $80/h). Stop rule: 30 offers, 3 weeks.";

type Opts = {
  reviews?: string[]; // queued answers for REVIEWER and CROSS-CHECKER, in call order
  failRoles?: Set<string>; // roles whose calls return HTTP 500 every time
  drafts?: string[]; // queued worker drafts
};
function rig(opts: Opts) {
  const calls: { role: string }[] = [];
  const fetcher = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const sys = JSON.stringify(body);
    const role = /You are the CROSS-CHECKER/.test(sys)
      ? "CROSS-CHECKER"
      : (sys.match(/Your role: ([A-Z-]+)/) || [])[1] || "?";
    calls.push({ role });
    if (opts.failRoles?.has(role))
      return new Response("upstream error", { status: 500, headers: { "content-type": "text/plain" } });
    const text =
      role === "PLANNER"
        ? "C1. names the buyer"
        : role === "WORKER"
          ? (opts.drafts?.shift() ?? D2)
          : role === "REVIEWER" || role === "CROSS-CHECKER"
            ? (opts.reviews?.shift() ?? PASS)
            : "ok";
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as any;
  return { fetcher, calls };
}
const deps = (fetcher: any) => ({
  save: () => {},
  isCancelled: () => false,
  credential: () => ({ provider: "anthropic" as const, model: "claude-test", key: "k" }),
  fetcher,
  sleep: async () => {},
});
const liveJob = (extra: object = {}): Job =>
  newJob({
    goal: "Pick one service to sell first and price it.",
    mode: "live",
    preset: "balanced",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "anthropic", verifier: "anthropic" },
    ...extra,
  });

test("missing revision notes do not block a round both reviewers approved", async () => {
  // Round 1 rejected; round 2's draft fixes the content but the worker forgets the notes block.
  const { fetcher } = rig({ reviews: [REVISE, PASS, PASS, PASS], drafts: [D1, D2] }); // drafts have no NOTES_MARK
  const job = liveJob({ minRounds: 1, maxRounds: 3 });
  await runJob(job, deps(fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(job.finalRound, 2);
  assert.equal(job.rounds![1].passed, true);
  // The missing notes are still surfaced - as an advisory, not a verdict.
  const note = job.events.find((e) => e.role === "check" && e.round === 2);
  assert.ok(note, "an automatic-check note explains what was missing");
  assert.match(note!.text, /revision notes/i);
  assert.equal(note!.review?.verdict, "pass");
  assert.ok(note!.review?.issues.some((i) => /point-by-point/.test(i.problem) && i.severity === "low"));
});

test("real content problems still block, even when both reviewers say pass", async () => {
  const placeholder = "## Plan\nPoint A\nPoint B\nTBD";
  const { fetcher } = rig({ reviews: [PASS, PASS, PASS, PASS], drafts: [placeholder, placeholder] });
  const job = liveJob({ minRounds: 1, maxRounds: 2 });
  await runJob(job, deps(fetcher));
  assert.equal(job.outcome, "round_limit_reached");
  const check = job.events.find((e) => e.role === "check" && e.round === 1);
  assert.equal(check?.review?.verdict, "revise");
  assert.match(check!.review!.issues.map((i) => i.problem).join(" "), /Point A\/B/);
});

test("main reviewer unavailable: resumable pause, never a quieter one-reviewer pass", async () => {
  const failing = rig({ failRoles: new Set(["REVIEWER"]) });
  const job = liveJob({ minRounds: 1, maxRounds: 2 });
  await assert.rejects(
    runJob(job, deps(failing.fetcher)),
    (e: any) => e?.resumable === true && /reviewer is unreachable/i.test(e.message),
  );
  assert.equal(job.rounds!.length, 0, "no verdict was recorded without the main reviewer");
  // The reviewer recovers: the same draft is reviewed by BOTH, not rewritten.
  const back = rig({});
  await runJob(job, deps(back.fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(approvalOf(job), "both");
  assert.equal(back.calls.filter((c) => c.role === "WORKER").length, 0);
});

test("cross-checker unavailable: the same resumable pause, not a silent downgrade", async () => {
  const failing = rig({ failRoles: new Set(["CROSS-CHECKER"]) });
  const job = liveJob({ minRounds: 1, maxRounds: 2 });
  await assert.rejects(
    runJob(job, deps(failing.fetcher)),
    (e: any) => e?.resumable === true && /cross-checker is unreachable/i.test(e.message),
  );
  const back = rig({});
  await runJob(job, deps(back.fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(approvalOf(job), "both");
});

test("a repeated failure adds nothing: no paid re-draft, no extra events, no extended resume window", async () => {
  const failing = rig({ failRoles: new Set(["REVIEWER"]) });
  const job = liveJob({ minRounds: 1, maxRounds: 3 });
  await assert.rejects(runJob(job, deps(failing.fetcher)), (e: any) => e?.resumable === true);
  const eventsAfterFirst = job.events.length;
  const lastAt = job.events.at(-1)!.at;
  const second = rig({ failRoles: new Set(["REVIEWER"]) });
  await assert.rejects(runJob(job, deps(second.fetcher)), (e: any) => e?.resumable === true);
  assert.equal(job.events.length, eventsAfterFirst, "no new events on a repeated pause");
  assert.equal(job.events.at(-1)!.at, lastAt, "the auto-resume window stays anchored at the original pause");
  assert.equal(second.calls.filter((c) => c.role === "WORKER").length, 0, "no paid re-draft on resume");
  assert.ok(second.calls.some((c) => c.role === "REVIEWER"), "only the review step is retried");
});

test("both reviewers unavailable: resumable pause, draft kept, resume reviews it without re-drafting", async () => {
  const failing = rig({ failRoles: new Set(["REVIEWER", "CROSS-CHECKER"]) });
  const job = liveJob({ minRounds: 1, maxRounds: 3 });
  await assert.rejects(
    runJob(job, deps(failing.fetcher)),
    (e: any) => e?.resumable === true && /review/i.test(e.message),
  );
  assert.equal(failing.calls.filter((c) => c.role === "WORKER").length, 1);
  assert.equal(job.rounds!.length, 0, "no round verdict was recorded");
  // The provider comes back; the same job resumes at the review step of the same round.
  const back = rig({});
  await runJob(job, deps(back.fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(job.finalRound, 1);
  assert.equal(back.calls.filter((c) => c.role === "WORKER").length, 0, "the saved draft is reviewed, not rewritten");
  assert.equal(job.final, D2);
  assert.equal(approvalOf(job), "both");
});

test("a reviewer-outage pause resumes by itself, like a system pause; other failures do not", () => {
  const at = new Date(Date.now() - 5 * 60000).toISOString();
  const base = { status: "stopped", mode: "live", created: at, events: [{ at }] };
  assert.equal(shouldAutoResume({ ...base, error: "review_paused" }), true);
  assert.equal(shouldAutoResume({ ...base, error: "interrupted" }), true);
  assert.equal(shouldAutoResume({ ...base, error: "Claude returned HTTP 401. Check the API key." }), false);
});

test("automatic review retries are bounded: an attempt cap and a cooldown, then a manual Resume", () => {
  const hour = 60 * 60000;
  const at = new Date(Date.now() - 5 * 60000).toISOString();
  const base = { status: "stopped", mode: "live", error: "review_paused", created: at, events: [{ at }] };
  // No attempts yet: resumes by itself.
  assert.equal(shouldAutoResume({ ...base }), true);
  // An attempt just happened: inside the cooldown, reopening fires no further paid retry.
  const justTried = { ...base, autoResumeAttempts: 1, lastAutoResumeAt: new Date(Date.now() - 5 * 60000).toISOString() };
  assert.equal(shouldAutoResume(justTried), false);
  // After the cooldown, the next automatic attempt is allowed.
  const cooledDown = { ...base, autoResumeAttempts: 1, lastAutoResumeAt: new Date(Date.now() - 45 * 60000).toISOString() };
  assert.equal(shouldAutoResume(cooledDown), true);
  // The cap is reached: no more automatic retries, however long ago the last one was.
  const usedUp = { ...base, autoResumeAttempts: AUTO_RESUME_MAX_ATTEMPTS, lastAutoResumeAt: new Date(Date.now() - 2 * hour).toISOString() };
  assert.equal(shouldAutoResume(usedUp), false);
  // A system pause (app went to the background) is not capped: no API failure, no surprise retry cost.
  assert.equal(
    shouldAutoResume({ ...base, error: "interrupted", autoResumeAttempts: 99, lastAutoResumeAt: new Date().toISOString() }),
    true,
  );
});

test("the paused state tells the user when automatic retries are used up", () => {
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /automatic retries are used up/);
});

test("the app shell marks a resumable pause as stopped + review_paused, never as a failure", () => {
  const s = readFileSync("src/ui/useStudio.ts", "utf8");
  assert.match(s, /e\?\.resumable/);
  assert.match(s, /j\.error = "review_paused"/);
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /review_paused/);
});

test("an approval by one reviewer says no second agent cross-checked it", () => {
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /no second agent cross-checked it/);
});

test("a run stopped mid-round resumes by reviewing the saved draft", async () => {
  const job = liveJob({ minRounds: 1, maxRounds: 3 });
  // What a crash leaves behind: plan and draft saved, no review of the draft.
  job.events.push(
    { role: "planner", round: 0, provider: "a", model: "m", text: "C1. names the buyer", usage: { input: 1, output: 1 }, at: new Date().toISOString() },
    { role: "worker", round: 1, provider: "a", model: "m", text: D2, usage: { input: 1, output: 1 }, at: new Date().toISOString() },
  );
  const { fetcher, calls } = rig({});
  await runJob(job, deps(fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(job.finalRound, 1);
  assert.equal(calls.filter((c) => c.role === "WORKER").length, 0);
  assert.ok(calls.some((c) => c.role === "REVIEWER"));
  assert.equal(job.final, D2);
});
