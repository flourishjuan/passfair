import assert from "node:assert/strict";
import { test } from "node:test";
import { BS_SYSTEM } from "../src/core/brainstorm";
import { DEMO_BRIEF, headFor, newJob, parseReview, qualityOf, runJob, systemFor } from "../src/core/orchestrator";

const crit = '"criteria":[{"id":"C1","met":true,"evidence":"quoted line"}]';

test("a pass needs accuracy, clarity and completeness all at 7 or more", () => {
  const ok = parseReview(
    `{"verdict":"pass","score":9,"axes":{"accuracy":8,"clarity":9,"completeness":7},${crit},"issues":[]}`,
    true,
  );
  assert.equal(ok.verdict, "pass");
  assert.deepEqual(ok.axes, { accuracy: 8, clarity: 9, completeness: 7 });
  const low = parseReview(
    `{"verdict":"pass","score":9,"axes":{"accuracy":6,"clarity":9,"completeness":9},${crit},"issues":[]}`,
    true,
  );
  assert.equal(low.verdict, "revise", "accuracy 6 is not a pass even if the reviewer says pass");
  const none = parseReview(`{"verdict":"pass","score":9,${crit},"issues":[]}`, true);
  assert.equal(none.verdict, "pass", "a reviewer that gives no grades is judged as before");
  assert.equal(none.axes, undefined);
});

test("reviewers are told to grade the three axes", () => {
  const job = newJob({ goal: "x", mode: "live", preset: "make_and_ship", assignments: {} });
  for (const r of ["reviewer", "verifier"] as const) {
    const s = systemFor(job, r);
    assert.match(s, /"axes":\{"accuracy":0-10,"clarity":0-10,"completeness":0-10\}/);
    assert.match(s, /Any axis below 7 means "revise"/);
  }
});

test("the result header shows the final round's lowest grades and the number of revisions", async () => {
  const job = newJob({
    goal: DEMO_BRIEF,
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", reviewer: "demo", verifier: "demo" },
    maxRounds: 3,
  });
  await runJob(job, {
    save: () => {},
    isCancelled: () => false,
    credential: () => null,
    sleep: async () => {},
    demoDelay: 0,
  });
  const q = qualityOf(job)!;
  assert.ok(q, "grades present");
  assert.ok(q.accuracy >= 7 && q.clarity >= 7 && q.completeness >= 7);
  assert.equal(q.revisions, (job.finalRound || 1) - 1);
});

test("research lists where sources disagree, and every agent is told those points are uncertain", () => {
  assert.match(BS_SYSTEM.researcher, /WHERE SOURCES DISAGREE/);
  const job = newJob({ goal: "x", mode: "live", preset: "make_and_ship", assignments: {} });
  job.events.push({
    role: "researcher",
    round: 0,
    stage: "research",
    provider: "openai",
    model: "m",
    text: "facts",
    usage: { input: 0, output: 0 },
    at: "",
  });
  assert.match(headFor(job), /must not be stated as fact/);
});
