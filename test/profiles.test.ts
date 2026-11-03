import assert from "node:assert/strict";
import { test } from "node:test";
import { UNKNOWN, budgetFor, estimateTokens, fitPrompt, profileFor } from "../src/core/profiles";
import { newJob, runJob } from "../src/core/orchestrator";
import { complete, setCustomAgents } from "../src/core/providers";

const resp = (body: object, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("profiles: every built-in default model has a real profile, not the unknown fallback", async () => {
  const { allProviders } = await import("../src/core/providers");
  for (const p of allProviders())
    for (const m of p.models) assert.notEqual(profileFor(p.id, m), UNKNOWN, `${p.id}/${m}`);
  assert.equal(profileFor("custom:x", "my-model"), UNKNOWN);
});

test("budgets: role target, thinking headroom, model ceiling and memory are all respected", () => {
  assert.equal(budgetFor("worker", profileFor("openai", "gpt-4.1")), 8000);
  assert.equal(budgetFor("worker", profileFor("openai", "gpt-5-mini")), 16000); // thinks → double
  assert.equal(budgetFor("reviewer", profileFor("openai", "gpt-5-mini")), 6000); // thinks → at least 6000
  assert.equal(budgetFor("worker", profileFor("moonshot", "moonshot-v1-32k")), 4000); // model ceiling
  assert.equal(budgetFor("worker", profileFor("meta", "Llama-3.3-70B-Instruct")), 8000);
  // a prompt that nearly fills a 32k model leaves less room for the answer, never below 1000
  assert.equal(budgetFor("worker", profileFor("moonshot", "moonshot-v1-32k"), 29000), 1400);
});

test("long prompts are condensed only for models that cannot hold them, keeping the brief and the latest turn", () => {
  const prompt = "BRIEF: sell X\n" + "old discussion. ".repeat(20000) + "\nLATEST: debate round 3 — your turn.";
  const small = fitPrompt(prompt, profileFor("moonshot", "moonshot-v1-32k"), 4000);
  assert.equal(small.condensed, true);
  assert.ok(estimateTokens(small.text) < 32000 * 0.9);
  assert.match(small.text, /^BRIEF: sell X/);
  assert.match(small.text, /LATEST: debate round 3 — your turn\.$/);
  assert.match(small.text, /condensed to fit/);
  assert.equal(fitPrompt(prompt, profileFor("anthropic", "claude-sonnet-4-5"), 8000).condensed, false);
  assert.equal(estimateTokens("价格"), 2);
});

test("agents sharing one key take turns; agents on different keys run together", async () => {
  setCustomAgents([
    {
      id: "or:claude",
      name: "Claude",
      baseUrl: "https://openrouter.ai/api/v1",
      style: "openai-chat",
      model: "anthropic/claude-sonnet-4.5",
      keyRef: "openrouter",
      managed: true,
    },
    {
      id: "or:gpt",
      name: "GPT",
      baseUrl: "https://openrouter.ai/api/v1",
      style: "openai-chat",
      model: "openai/gpt-4.1",
      keyRef: "openrouter",
      managed: true,
    },
  ]);
  let live = 0;
  let peakShared = 0;
  const f = (async (url: string, init: any) => {
    const shared = url.includes("openrouter");
    if (shared) {
      live++;
      peakShared = Math.max(peakShared, live);
    }
    await new Promise((r) => setTimeout(r, 5));
    if (shared) live--;
    const sys = JSON.stringify(JSON.parse(init.body).messages?.[0] || JSON.parse(init.body).system || "");
    const text = /REVIEWER/.test(sys)
      ? `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"Buyer: export managers"}],"issues":[]}`
      : /FRAMER/.test(sys)
        ? "C1. names the buyer\nDOMAINS: Chess; Opera; Rally"
        : "Buyer: export managers. ".repeat(30);
    return url.includes("anthropic.com")
      ? resp({ content: [{ type: "text", text }], stop_reason: "end_turn" })
      : resp({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
  }) as any;
  const job = newJob({
    goal: "Pick one service. " + "x ".repeat(40),
    mode: "live",
    preset: "make_and_ship",
    flow: "brainstorm",
    panel: ["anthropic", "or:claude", "or:gpt"],
    debateRounds: 1,
    minRounds: 1,
    maxRounds: 1,
    assignments: { worker: "anthropic", reviewer: "anthropic", verifier: "or:gpt" },
  });
  const keys: Record<string, string> = { anthropic: "k-anthropic", "or:claude": "k-or", "or:gpt": "k-or" };
  await runJob(job, {
    save: () => {},
    isCancelled: () => false,
    sleep: async () => {},
    credential: (p) => ({
      provider: p,
      model:
        p === "anthropic" ? "claude-sonnet-4-5" : p === "or:gpt" ? "openai/gpt-4.1" : "anthropic/claude-sonnet-4.5",
      key: keys[p],
    }),
    fetcher: f,
  });
  assert.equal(peakShared, 1, "the two OpenRouter agents never ran at the same moment");
  assert.equal(job.events.filter((e) => e.stage === "ideas").length, 3);
  assert.equal(job.status, "awaiting_review");
});

test("rate limits: the vendor's Retry-After is respected", async () => {
  const waits: number[] = [];
  let n = 0;
  const r = await complete(
    { provider: "anthropic", model: "claude-sonnet-4-5", key: "k", system: "s", prompt: "p" },
    (async () =>
      ++n === 1
        ? resp({}, 429, { "retry-after": "7" })
        : resp({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })) as any,
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(r.text, "ok");
  assert.deepEqual(waits, [7000]);
});
