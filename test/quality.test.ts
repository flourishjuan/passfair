// Regression tests for the "approved placeholder" problem: a run must not approve an empty or template answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEMO_BRIEF,
  newJob,
  packageFor,
  parseReview,
  promptFor,
  qualityGate,
  runJob,
  sameness,
  splitNotes,
  systemFor,
  type Job,
} from "../src/core/orchestrator";

const GLOBLEMATCH =
  "为 GlobleMatch 选出唯一一个最值得先卖的服务。必须写清：谁买、交付什么、为什么付费、试卖价格及依据、零广告预算如何找到第一位客户、每单人工耗时、失败后何时停止。没有证据的地方标为假设。评审必须指出具体缺陷，修订稿必须逐条回应。禁止占位文字。";

const PLACEHOLDER_DRAFT = `# GlobleMatch

## Summary
A first attempt that answers the brief in general terms.

## Key points
- Point A (supported by the brief)
- Point B (assumption)

## Next steps
1. Confirm the audience and deadline with the owner.
2. TBD`;

const PASS_NO_CRITERIA = `{"verdict":"pass","score":9,"summary":"Looks good.","issues":[]}`;
const PASS = `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"Buyer: cross-border SaaS founders"}],"issues":[]}`;

function scripted(worker: (n: number, prompt: string) => string, reviews: string[]) {
  let n = 0;
  const seen: string[] = [];
  const fetcher = async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const sys = JSON.stringify(body);
    const prompt = JSON.stringify(body.messages || "");
    seen.push(prompt);
    const text = /Your role: REVIEWER/.test(sys)
      ? reviews.shift() || PASS
      : /Your role: PLANNER/.test(sys)
        ? "C1. names the buyer"
        : worker(++n, prompt);
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetcher: fetcher as any, seen };
}
const deps = (f: any) => ({
  save: () => {},
  isCancelled: () => false,
  credential: () => ({ provider: "anthropic" as const, model: "claude-test", key: "k" }),
  fetcher: f,
  sleep: async () => {},
});
const liveJob = (goal: string, extra: object = {}): Job =>
  newJob({
    goal,
    mode: "live",
    preset: "balanced",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "anthropic", verifier: "anthropic" },
    ...extra,
  });

test("the reported case: a placeholder answer is never approved, even if both reviewers say pass", async () => {
  const job = liveJob(GLOBLEMATCH, { minRounds: 1, maxRounds: 2 });
  const { fetcher } = scripted(() => PLACEHOLDER_DRAFT, []); // reviewers always PASS
  await runJob(job, deps(fetcher));
  assert.equal(job.outcome, "round_limit_reached");
  const checks = job.events.filter((e) => e.role === "check");
  assert.equal(checks.length, 2);
  const problems = checks[0].review!.issues.map((i) => i.problem).join(" | ");
  assert.match(problems, /Point A\/B/);
  assert.match(problems, /TBD/);
  assert.match(problems, /too thin/);
  // round 2 repeated the rejected draft word for word
  assert.match(checks[1].review!.issues.map((i) => i.problem).join(" "), /unchanged since round 1/);
  assert.match(packageFor(job), /read critically/);
});

test("a reviewer 'pass' without checking each requirement is not a pass; met without evidence is unmet", () => {
  assert.equal(parseReview(PASS_NO_CRITERIA, true).verdict, "revise");
  assert.equal(parseReview(PASS_NO_CRITERIA, false).verdict, "pass"); // demo/legacy path unchanged
  assert.equal(parseReview(PASS, true).verdict, "pass");
  const r = parseReview(
    `{"verdict":"pass","score":9,"summary":"","criteria":[{"id":"C1","met":true,"evidence":""}],"issues":[]}`,
    true,
  );
  assert.equal(r.verdict, "revise");
  assert.equal(r.criteria![0].met, false);
});

test("revision must answer issues point by point; notes are kept out of the deliverable and shown to reviewers", async () => {
  const good = (n: number) =>
    `## Service: market-entry match report\nBuyer: cross-border SaaS founders entering the US (assumption: 3 warm intros available).\nDeliverable: 10 vetted partner matches in 5 days. Price: $490 trial, based on 6 hours of work at ~$80/h.\nFirst customer: post the offer in two founder communities and DM 20 founders already listed in the directory.\nStop rule: no paid order after 30 direct offers in 3 weeks.${n > 1 ? "\nRevised: added the stop rule with numbers." : ""}`;
  const { fetcher, seen } = scripted(
    (n, prompt) =>
      n === 1
        ? good(1)
        : `${good(n)}\n=== REVISION NOTES ===\nI1: added stop rule "no paid order after 30 direct offers in 3 weeks".`,
    [
      `{"verdict":"revise","score":6,"summary":"No stop rule.","criteria":[{"id":"C1","met":false,"evidence":""}],"issues":[{"severity":"high","where":"end","problem":"no stop rule","fix":"add one"}]}`,
      PASS,
      PASS,
      PASS,
    ],
  );
  const job = liveJob("Pick one service to sell first and price it.", { minRounds: 1, maxRounds: 3 });
  await runJob(job, deps(fetcher));
  assert.equal(job.outcome, "approved_by_reviewer");
  const w2 = job.events.find((e) => e.role === "worker" && e.round === 2)!;
  assert.match(w2.notes!, /^I1: added stop rule/);
  assert.doesNotMatch(job.final, /REVISION NOTES/);
  assert.ok(seen.some((p) => /WORKER'S REVISION NOTES/.test(p) && /I1: added stop rule/.test(p)));
  // the worker saw numbered issues to answer
  assert.ok(seen.some((p) => /I1 \[high\]/.test(p)));
});

test("missing revision notes after a rejected round is flagged", () => {
  const job = liveJob("Short brief");
  job.events.push(
    {
      role: "worker",
      round: 1,
      provider: "a",
      model: "m",
      text: "alpha line one\nbeta line two",
      usage: { input: 1, output: 1 },
      at: "",
    },
    {
      role: "worker",
      round: 2,
      provider: "a",
      model: "m",
      text: "a completely new gamma line\nand a delta line",
      usage: { input: 1, output: 1 },
      at: "",
    },
  );
  job.rounds = [{ round: 1, passed: false, minScore: 4, verdicts: [] }];
  const g = qualityGate(job, 2);
  assert.equal(g.verdict, "revise");
  assert.match(g.issues.map((i) => i.problem).join(" "), /point-by-point/);
});

test("helpers: notes split, sameness, prompts forbid placeholders and demand numbered criteria", () => {
  assert.deepEqual(splitNotes("Body\n=== REVISION NOTES ===\nI1: x"), { deliverable: "Body", notes: "I1: x" });
  assert.deepEqual(splitNotes("Body only"), { deliverable: "Body only", notes: "" });
  assert.equal(sameness("a line\nb line", "a line\nb line"), 1);
  assert.ok(sameness("a line\nb line", "c line\nd line") < 0.1);
  const job = liveJob(GLOBLEMATCH);
  assert.match(systemFor(job, "planner"), /C1, C2, C3/);
  assert.match(systemFor(job, "worker"), /Never use placeholder text/);
  assert.match(systemFor(job, "reviewer"), /generic content that would fit any company/);
  assert.match(systemFor(job, "verifier"), /CROSS-CHECKER/);
  assert.match(promptFor(job, "planner", 0), /GlobleMatch/);
});

test("demo is honest: fixed sample brief, never approved, cannot be packaged for Muse", async () => {
  const job = newJob({
    goal: DEMO_BRIEF,
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", polisher: "demo", reviewer: "demo", verifier: "demo" },
    minRounds: 2,
  });
  await runJob(job, {
    save: () => {},
    isCancelled: () => false,
    credential: () => null,
    demoDelay: 0,
    sleep: async () => {},
  });
  assert.equal(job.outcome, "demo");
  assert.ok(!job.events.some((e) => e.role === "check"));
  assert.doesNotMatch(job.events.map((e) => e.text).join("\n"), /Point [A-E]\b|\bTBD\b|To be defined/);
  assert.throws(() => packageFor(job), /scripted demo/);
});
