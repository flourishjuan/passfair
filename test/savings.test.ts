// Token savers: shared cacheable opening, section-only revisions, reviewer gate, Quick (no debate).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_MARK, headFor, mergeSections, newJob, runJob, sectionsOf, type Job } from "../src/core/orchestrator";

const resp = (body: object) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const PASS = `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"Buyer: export managers"}],"issues":[]}`;
const REVISE = `{"verdict":"revise","score":5,"summary":"no","criteria":[{"id":"C1","met":false,"evidence":""}],"issues":[{"severity":"high","where":"Price","problem":"no basis","fix":"give the basis"}]}`;
const DOC = `# Plan\n\n## Buyer\nBuyer: export managers at 20–200 person firms.\n\n## Price\n$490 trial.\n\n## First customer\nDM 20 founders.\n\n## Stop rule\nStop after 30 offers with no sale.`;

function vendor(opts: { reviews: string[]; revision?: string }) {
  const calls: { url: string; body: any; role: string }[] = [];
  let worker = 0;
  const f = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    const role = (JSON.stringify(body).match(/Your role: ([A-Z-]+)/) || [])[1] || "?";
    calls.push({ url, body, role });
    let text = "ok";
    if (role === "PLANNER") text = "C1. names the buyer";
    else if (role === "FRAMER") text = "C1. names the buyer\nDOMAINS: Chess; Opera";
    else if (role === "PANELIST") text = "TL;DR: A-1\nA-1 idea $49";
    else if (role === "DECIDER") text = "TL;DR: sell A-1\n## Decision\nSell A-1.";
    else if (role === "WORKER") text = ++worker === 1 ? DOC : opts.revision || DOC;
    else if (role === "REVIEWER") text = opts.reviews.shift() || PASS;
    return url.includes("anthropic.com")
      ? resp({
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 },
        })
      : resp({
          output_text: text,
          usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 50 },
        });
  }) as any;
  return { f, calls };
}
const cred = (p: string) => ({
  provider: p,
  model: p === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1",
  key: "k-" + p,
});
const deps = (f: any) => ({
  save: () => {},
  isCancelled: () => false,
  sleep: async () => {},
  credential: cred,
  fetcher: f,
});
const MATERIAL = "Company facts. ".repeat(400); // long shared material → worth caching

test("every call of a job opens with the same system text and the same brief + material; Claude marks it cacheable", async () => {
  const v = vendor({ reviews: [] });
  const job = newJob({
    goal: "Pick one service to sell first.",
    context: MATERIAL,
    mode: "live",
    preset: "make_and_ship",
    flow: "brainstorm",
    panel: ["anthropic", "openai"],
    debateRounds: 1,
    minRounds: 1,
    maxRounds: 1,
    assignments: { worker: "anthropic", reviewer: "anthropic", verifier: "openai" },
  });
  await runJob(job, deps(v.f));
  const head = headFor(job);
  const claude = v.calls.filter((c) => c.url.includes("anthropic.com"));
  const gpt = v.calls.filter((c) => c.url.includes("openai.com"));
  assert.equal(new Set(claude.map((c) => c.body.system)).size, 1, "one system text for every Claude call");
  assert.equal(new Set(gpt.map((c) => c.body.instructions)).size, 1, "one instruction text for every GPT call");
  for (const c of claude) {
    const blocks = c.body.messages[0].content;
    assert.equal(blocks[0].text, head);
    assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
    assert.match(blocks[1].text, new RegExp(ROLE_MARK));
  }
  for (const c of gpt) assert.ok(c.body.input.startsWith(head), "GPT input starts with the shared head");
  assert.ok(job.usage.cached! > 0, "cached tokens are counted");
  assert.ok(job.usage.input >= job.usage.cached!);
});

test("section edits: only changed sections come back and are merged into the draft", () => {
  assert.deepEqual(
    sectionsOf(DOC).map((x) => x.heading),
    ["## Buyer", "## Price", "## First customer", "## Stop rule"],
  );
  const m = mergeSections(DOC, "## Price\n$490 trial, based on 6 h at $80/h.\n\n## Risks\nOne-client dependency.");
  assert.equal(m.full, false);
  assert.deepEqual(m.changed, ["Price", "Risks"]);
  assert.match(m.text, /^# Plan\n\n## Buyer\nBuyer: export managers/);
  assert.match(m.text, /## Price\n\$490 trial, based on 6 h at \$80\/h\./);
  assert.match(m.text, /## Stop rule\nStop after 30 offers/);
  assert.match(m.text, /## Risks\nOne-client dependency\.$/);
  assert.doesNotMatch(mergeSections(DOC, "## First customer\nDELETE").text, /First customer/);
  // an edit that repeats (almost) every heading is treated as a full rewrite
  assert.equal(mergeSections(DOC, DOC.replace("$490", "$390")).full, true);
});

test("saver run: revision sends only the changed section; cross-checker skips a round the reviewer rejected", async () => {
  const v = vendor({
    reviews: [REVISE, PASS, PASS],
    revision: "## Price\n$490 trial, based on 6 h at $80/h.\n=== REVISION NOTES ===\nI1: added the basis.",
  });
  const job = newJob({
    goal: "Pick one service to sell first.",
    mode: "live",
    preset: "balanced",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "anthropic", verifier: "openai" },
    minRounds: 1,
    maxRounds: 3,
  });
  job.saver = { crossOnPassOnly: true, sectionEdits: true };
  await runJob(job, deps(v.f));
  const r1 = job.events.filter((e) => e.round === 1).map((e) => e.role);
  assert.ok(!r1.includes("verifier"), "no cross-check for a draft the reviewer already rejected");
  const w2 = job.events.find((e) => e.role === "worker" && e.round === 2)!;
  assert.deepEqual(w2.patched, ["Price"]);
  assert.match(w2.text, /## Buyer[\s\S]*based on 6 h at \$80\/h[\s\S]*## Stop rule/);
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.ok(
    job.events.some((e) => e.role === "verifier" && e.round === 2),
    "the passing round is still cross-checked",
  );
  const revisionCall = v.calls.filter((c) => c.role === "WORKER")[1];
  assert.match(JSON.stringify(revisionCall.body), /Output ONLY the sections you change/);
});

test("Quick: zero debate rounds goes straight from ideas to the decision", async () => {
  const v = vendor({ reviews: [] });
  const job = newJob({
    goal: "Pick one.",
    mode: "live",
    preset: "make_and_ship",
    flow: "brainstorm",
    panel: ["anthropic", "openai"],
    debateRounds: 0,
    minRounds: 1,
    maxRounds: 1,
    assignments: { worker: "anthropic", reviewer: "anthropic" },
  });
  await runJob(job, deps(v.f));
  assert.equal(job.events.filter((e) => e.stage === "debate").length, 0);
  assert.ok(job.events.some((e) => e.role === "decider"));
  assert.equal(job.status, "awaiting_review");
});

test("a targeted fix to one section of a long draft is not mistaken for 'unchanged'", async () => {
  const { qualityGate } = await import("../src/core/orchestrator");
  const job = newJob({
    goal: "Plan",
    mode: "live",
    preset: "balanced",
    assignments: { worker: "anthropic", reviewer: "anthropic" },
  });
  const fixed = DOC.replace("$490 trial.", "$490 trial, based on 6 h at $80/h.");
  job.events.push(
    { role: "worker", round: 1, provider: "a", model: "m", text: DOC, usage: { input: 1, output: 1 }, at: "" },
    {
      role: "worker",
      round: 2,
      provider: "a",
      model: "m",
      text: fixed,
      usage: { input: 1, output: 1 },
      at: "",
      notes: "I1: basis added",
    },
  );
  job.rounds = [{ round: 1, passed: false, minScore: 5, verdicts: [] }];
  assert.doesNotMatch(
    qualityGate(job, 2)
      .issues.map((i) => i.problem)
      .join(" "),
    /unchanged/,
  );
  job.events[1].text = DOC; // truly untouched
  assert.match(
    qualityGate(job, 2)
      .issues.map((i) => i.problem)
      .join(" "),
    /unchanged since round 1/,
  );
});
