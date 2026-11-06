import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SAMPLE_QUESTION,
  constraintBlock,
  constraintProblems,
  wrongLanguage,
  numbered,
  readConstraints,
  runCollection,
  runDebate,
  runFollowUp,
} from "../src/core/collection";
import { newJob } from "../src/core/orchestrator";

const ACCEPT = "给我100个北美市场蓝海但高增长的项目，投资10万以下";

test("the acceptance brief: North America, US dollars, 100 items, under $100,000", () => {
  const c = readConstraints(ACCEPT);
  assert.match(c.market!, /North America/);
  assert.equal(c.currency, "USD ($)");
  assert.equal(c.count, 100);
  assert.equal(c.budget, "under $100,000 per item, in USD ($)");
  const block = constraintBlock(c);
  assert.match(block, /exactly 100 items/);
  assert.match(block, /Do not use Chinese platforms/);
});

test("other wordings", () => {
  assert.equal(readConstraints("Give me 25 startup ideas for Canada under $50k").count, 25);
  assert.equal(
    readConstraints("Give me 25 startup ideas for Canada under $50k").budget,
    "under $50,000 per item, in USD ($)",
  );
  assert.equal(readConstraints("列出二十个适合美国市场的小生意").count, 20);
  assert.match(readConstraints("面向中国市场的 5 个方案，预算 10 万元").currency!, /CNY/);
  assert.deepEqual(readConstraints("How do I price my coffee?"), {});
});

test("answers that break the constraints are caught: wrong market, yuan, missing items", () => {
  const c = readConstraints(ACCEPT);
  assert.ok(constraintProblems("1. **Shop** — sell on Taobao", c)[0].includes("Taobao"));
  assert.ok(constraintProblems("1. **Cart** — costs 50000元", c).some((p) => /yuan/.test(p)));
  const list = Array.from({ length: 10 }, (_, i) => `${i + 1}. **Idea ${i + 1}** — $5,000 (estimate)`).join("\n");
  assert.deepEqual(constraintProblems(list, c, { from: 1, to: 10 }), []);
  assert.match(constraintProblems(list.split("\n").slice(0, 3).join("\n"), c, { from: 1, to: 10 })[0], /3 of the 10/);
  assert.deepEqual(numbered("11. a\n12) b\n**13.** c"), [11, 12, 13]);
});

const deps = (save = () => {}) => ({
  save,
  isCancelled: () => false,
  credential: () => null,
  sleep: async () => {},
  demoDelay: 0,
});

test("sample: directions first, then every vendor's own items, one screen at a time", async () => {
  const j = newJob({
    goal: SAMPLE_QUESTION,
    mode: "demo",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic", "openai", "google"],
    assignments: {},
  });
  await runCollection(j, deps());
  assert.equal(j.status, "awaiting_choice");
  assert.ok(j.collection!.directions!.length >= 2);
  assert.equal(j.events.filter((e) => e.role === "answer").length, 0, "nothing written before the user picks");
  j.collection!.choice = "Local services";
  await runCollection(j, deps());
  const seg1 = j.events.filter((e) => e.role === "answer" && e.round === 1);
  assert.equal(seg1.length, 3, "one answer per vendor");
  for (const e of seg1) assert.deepEqual(numbered(e.text), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.notEqual(seg1[0].text, seg1[1].text, "vendors' work stays their own");
  assert.equal(j.status, "partial");
  await runCollection(j, deps());
  assert.equal(j.collection!.done, 2);
  assert.equal(j.status, "awaiting_review", "20 of 20 delivered");
  for (const p of ["anthropic", "openai", "google"])
    assert.equal(
      numbered(
        j.events
          .filter((e) => e.provider === p)
          .map((e) => e.text)
          .join("\n"),
      ).length,
      20,
    );
  assert.ok(!j.events.some((e) => e.role === "check" || e.role === "reviewer" || e.role === "worker"));
});

function fakeFetcher(replies: (body: any) => string) {
  const seen: any[] = [];
  const f = async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    seen.push(b);
    const text = replies(b);
    return new Response(
      JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }),
    );
  };
  return { f, seen };
}
const cred = (p: string) => ({ provider: "anthropic" as const, model: "claude-sonnet-4-5", key: `k-${p}` });

test("live: an answer that slips into Chinese platforms is redone once, told exactly why", async () => {
  let tries = 0;
  const { f, seen } = fakeFetcher((b) => {
    const prompt = b.messages[0].content.map
      ? b.messages[0].content.map((c: any) => c.text).join("")
      : String(b.messages[0].content);
    if (/prepare a question/.test(JSON.stringify(b.system))) return '{"broad":false,"directions":[],"constraints":{}}';
    tries++;
    const items = Array.from(
      { length: 10 },
      (_, i) => `${i + 1}. **Idea ${i + 1}** — ${tries === 1 ? "sell on Taobao" : "sell on Amazon"}, $8,000 (estimate)`,
    );
    assert.match(prompt, /HARD CONSTRAINTS/);
    return items.join("\n");
  });
  const j = newJob({
    goal: ACCEPT,
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  await runCollection(j, { ...deps(), credential: cred as any, fetcher: f as any });
  const ans = j.events.filter((e) => e.role === "answer");
  assert.equal(ans.length, 1);
  assert.match(ans[0].text, /Amazon/);
  assert.ok(!/Taobao/.test(ans[0].text));
  assert.ok(JSON.stringify(seen[seen.length - 1]).includes("BROKE THE USER'S REQUIREMENTS"));
  assert.equal(j.collection!.total, 10, "100 items = 10 screens");
});

test("a follow-up is answered together: each vendor reads the ones before it", async () => {
  const { f, seen } = fakeFetcher((b) => `Reply from ${b.messages ? seen.length : 0}`);
  const j = newJob({
    goal: "Pick a market",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic", "openai"],
    assignments: {},
  });
  j.collection!.scoped = true;
  j.events.push({
    role: "answer",
    round: 1,
    provider: "anthropic",
    model: "m",
    text: "Claude says US",
    usage: { input: 0, output: 0 },
    at: "",
  });
  j.events.push({
    role: "answer",
    round: 1,
    provider: "openai",
    model: "m",
    text: "GPT says Canada",
    usage: { input: 0, output: 0 },
    at: "",
  });
  await runFollowUp(j, "Which is cheaper to start?", {
    ...deps(),
    credential: ((p: string) => ({ provider: "anthropic", model: "m", key: `k-${p}` })) as any,
    fetcher: f as any,
  });
  const fu = j.events.filter((e) => e.role === "followup");
  assert.equal(fu.length, 2);
  const second = JSON.stringify(seen[1]);
  assert.match(second, /YOUR COLLEAGUES ALREADY REPLIED/);
  assert.match(second, /Claude:/);
  assert.match(JSON.stringify(seen[0]), /You reply first/);
});

test("debate: two rounds from every vendor, then it stops", async () => {
  const j = newJob({
    goal: SAMPLE_QUESTION,
    mode: "demo",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic", "openai"],
    assignments: {},
  });
  j.collection!.scoped = true;
  await runCollection(j, deps());
  await runDebate(j, deps());
  const d = j.events.filter((e) => e.role === "debater");
  assert.equal(d.length, 4);
  assert.deepEqual([...new Set(d.map((e) => e.round))], [1, 2]);
  assert.equal(j.status, "partial");
});

test("an answer in the wrong language is caught (Chinese question, English answer) — names may stay", () => {
  const zh = "Simplified Chinese (简体中文)";
  assert.match(
    wrongLanguage("1. **Mobile EV charging** — demand is growing fast in the US.", zh)!,
    /not written in Simplified Chinese/,
  );
  assert.equal(
    wrongLanguage("1. **Mobile EV charging** — 美国需求增长很快，启动成本约 $21k（估算：设备＋三个月广告）。", zh),
    null,
  );
  assert.equal(wrongLanguage("Demand is growing in the US.", "English"), null);
  assert.ok(wrongLanguage("美国需求增长很快，启动成本约两万一千美元，适合一个人起步，回本周期大约一年。", "English"));
  assert.ok(
    constraintProblems("1. **A** — growing demand in the US market today.", {}, undefined, zh)[0].includes("Rewrite"),
  );
});

test("Japanese and French questions get Japanese and French answers; English slips are caught", async () => {
  const ja = newJob({
    goal: "北米市場で10万ドル以下で始められる成長分野のビジネスを100個ください",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  assert.equal(ja.lang, "Japanese");
  assert.equal(ja.collection!.constraints.count, 100);
  assert.match(ja.collection!.constraints.market!, /North America/);
  const fr = newJob({
    goal: "Donne-moi 100 projets à forte croissance pour le marché nord-américain, avec un investissement de moins de 100 000 $",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  assert.equal(fr.lang, "French");
  assert.match(fr.collection!.constraints.market!, /North America/);
  assert.ok(
    wrongLanguage("1. **EV charging** — Demand is growing fast and the startup cost is low. ".repeat(6), "Japanese"),
  );
  assert.equal(
    wrongLanguage("1. **EV charging** — 米国で需要が急増しており、初期費用は約2万ドル（推定）です。", "Japanese"),
    null,
  );
  const en =
    "1. **EV charging** — Demand is growing fast in the United States and the startup cost is low for a small team. ".repeat(
      4,
    );
  assert.match(wrongLanguage(en, "French")!, /written in English, not French/);
  const frText =
    "1. **Recharge VE** — La demande augmente très vite aux États-Unis et le coût de départ est faible pour une petite équipe. ".repeat(
      4,
    );
  assert.equal(wrongLanguage(frText, "French"), null);
});
