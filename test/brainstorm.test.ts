import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_BRAINSTORM_BRIEF, parseLenses, seatName } from "../src/core/brainstorm";
import { LIMITS, clamp } from "../src/core/plan";
import { htmlToText, kindOf, materialFrom, mimeFor, officeToText } from "../src/core/material";
import { toDocx, toPptx } from "../src/core/export";
import { base64url, codeFrom, detectKey, exchangeCode, pkce, sha256 } from "../src/core/oauth";
import { complete, customUrl, extract, getProvider, setCustomAgents, validateCustom } from "../src/core/providers";
import { newJob, promptFor, runJob, type Job } from "../src/core/orchestrator";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const resp = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const quiet = { save: () => {}, isCancelled: () => false, sleep: async () => {} };

test("brainstorm demo: frame → ideas (2 lenses) → 2 debate rounds → decision → build with cross-check", async () => {
  const job = newJob({
    goal: DEMO_BRAINSTORM_BRIEF,
    mode: "demo",
    preset: "make_and_ship",
    flow: "brainstorm",
    panel: ["demo", "demo"],
    debateRounds: 2,
    minRounds: 2,
    assignments: { worker: "demo", polisher: "demo", reviewer: "demo", verifier: "demo" },
  });
  await runJob(job, { ...quiet, credential: () => null, demoDelay: 0 });
  const stages = job.events.map((e) => e.stage || e.role);
  assert.deepEqual(stages.slice(0, 8), ["frame", "ideas", "ideas", "debate", "debate", "debate", "debate", "decision"]);
  assert.deepEqual(job.lenses, ["Video games & live-ops", "Airline revenue management"]);
  assert.ok(!job.events.some((e) => e.role === "planner"), "brainstorm replaces the planner");
  assert.equal(job.outcome, "demo");
  assert.equal(job.finalRound, 2);
  assert.match(job.final, /108 repeat customers/);
  assert.match(promptFor(job, "worker", 2), /DECISION FROM THE TEAM BRAINSTORM/);
});

test("lenses: framer's DOMAINS line first, pool fills the rest, no duplicates", () => {
  assert.deepEqual(parseLenses("…\nDOMAINS: Formula 1 pit crews; Wine auctions", 2, "x"), [
    "Formula 1 pit crews",
    "Wine auctions",
  ]);
  const l = parseLenses("**DOMAINS:** Chess", 4, "seed");
  assert.equal(l[0], "Chess");
  assert.equal(new Set(l).size, 4);
  assert.equal(parseLenses("", 3, "a").length, 3);
});

// Scripted vendors: answers depend on the system prompt; records every call.
function vendors(opts: { failSeat?: string; truncateWorkerOnce?: boolean } = {}) {
  const calls: { url: string; body: any }[] = [];
  let cut = !!opts.truncateWorkerOnce;
  const f = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const sys = JSON.stringify(body);
    let text = "ok";
    let truncated = false;
    if (/Your role: EYES/.test(sys)) text = "Image shows a price list: Croissant $4.";
    else if (/Your role: RESEARCHER/.test(sys)) text = "Competitor X charges $30/month (source).";
    else if (/Your role: FRAMER/.test(sys))
      text = "## Decision criteria\nC1. names the buyer\nDOMAINS: Chess clubs; Air traffic control; Perfume launches";
    else if (/Your role: PANELIST/.test(sys) && /debate round/.test(sys))
      text = `debate from ${url.includes("x.ai") ? "Grok" : "other"}`;
    else if (/Your role: PANELIST/.test(sys)) {
      if (opts.failSeat && url.includes(opts.failSeat)) return resp({}, 500);
      text = "A-1 idea with a number $49";
    } else if (/Your role: DECIDER/.test(sys))
      text = "## Decision\nSell X to Y.\n## Acceptance criteria for the final deliverable\nC1. names the buyer";
    else if (/Your role: WORKER/.test(sys)) {
      text = "Buyer: export managers. ".repeat(30);
      if (cut) {
        cut = false;
        truncated = true;
      }
    } else if (/Your role: REVIEWER/.test(sys))
      text = `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"Buyer: export managers"}],"issues":[]}`;
    if (url.includes("anthropic"))
      return resp({
        content: [{ type: "text", text }],
        usage: { input_tokens: 5, output_tokens: 5 },
        stop_reason: truncated ? "max_tokens" : "end_turn",
      });
    if (url.includes("openai.com"))
      return resp({
        output_text: text,
        usage: { input_tokens: 5, output_tokens: 5 },
        status: truncated ? "incomplete" : "completed",
      });
    return resp({
      choices: [{ message: { content: text }, finish_reason: truncated ? "length" : "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });
  };
  return { f: f as any, calls };
}
const cred = (p: string) => ({ provider: p, model: `${p}-model`, key: "k" });
const liveBs = (extra: Partial<Parameters<typeof newJob>[0]> = {}): Job =>
  newJob({
    goal: "Pick one service to sell first. " + "Detail. ".repeat(10),
    mode: "live",
    preset: "make_and_ship",
    flow: "brainstorm",
    panel: ["anthropic", "openai", "xai"],
    debateRounds: 2,
    minRounds: 1,
    maxRounds: 2,
    assignments: { worker: "anthropic", polisher: "openai", reviewer: "anthropic", verifier: "openai" },
    ...extra,
  });

test("live brainstorm with 3 vendors: every seat speaks each stage; lenses from the framer; decision drives the build", async () => {
  const v = vendors();
  const job = liveBs();
  await runJob(job, { ...quiet, credential: cred, fetcher: v.f });
  const ideas = job.events.filter((e) => e.stage === "ideas");
  assert.deepEqual(
    ideas.map((e) => e.provider),
    ["anthropic", "openai", "xai"],
  );
  assert.deepEqual(job.lenses, ["Chess clubs", "Air traffic control", "Perfume launches"]);
  assert.equal(job.events.filter((e) => e.stage === "debate").length, 6);
  // debate prompts carry every idea; round 2 carries round 1
  const debate2 = v.calls.find((c) => /debate round 2/.test(JSON.stringify(c.body)) && c.url.includes("x.ai"))!;
  assert.match(JSON.stringify(debate2.body), /IDEAS FROM ALL PANELISTS/);
  assert.match(JSON.stringify(debate2.body), /DEBATE SO FAR/);
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(seatName(job, 2), "Grok");
});

test("one agent failing does not stop the brainstorm", async () => {
  const v = vendors({ failSeat: "x.ai" });
  const job = liveBs({ debateRounds: 1 });
  await runJob(job, { ...quiet, credential: cred, fetcher: v.f });
  const grok = job.events.find((e) => e.stage === "ideas" && e.seat === 2)!;
  assert.equal(grok.failed, true);
  assert.match(grok.text, /Could not answer/);
  assert.ok(job.events.some((e) => e.role === "decider"));
});

test("cut-off answers are continued automatically and stitched together", async () => {
  const v = vendors({ truncateWorkerOnce: true });
  const job = liveBs({ debateRounds: 1 });
  await runJob(job, { ...quiet, credential: cred, fetcher: v.f });
  const w = job.events.find((e) => e.role === "worker")!;
  assert.equal(w.continued, 1);
  assert.equal(w.truncated, false);
  assert.ok(v.calls.some((c) => /Continue exactly where it stops/.test(JSON.stringify(c.body))));
});

test("files: the seer gets the image, research uses web search, everyone gets their notes", async () => {
  const v = vendors();
  const job = liveBs({ debateRounds: 1, seer: "anthropic", researcher: "openai" });
  await runJob(job, {
    ...quiet,
    credential: cred,
    fetcher: v.f,
    media: [{ name: "menu.png", mime: "image/png", base64: "iVBORw0K" }],
  });
  assert.deepEqual(
    job.events.slice(0, 2).map((e) => e.role),
    ["seer", "researcher"],
  );
  const seerCall = v.calls[0];
  assert.equal(seerCall.body.messages[0].content[0].type, "image");
  const research = v.calls[1];
  assert.deepEqual(research.body.tools, [{ type: "web_search" }]);
  const ideaCall = v.calls.find((c) => c.url.includes("x.ai"))!;
  assert.match(JSON.stringify(ideaCall.body), /NOTES ON THE ATTACHED FILES[\s\S]*Croissant \$4/);
  assert.match(JSON.stringify(ideaCall.body), /RESEARCH NOTES/);
  // the image itself only went to the agent that can see it
  assert.equal(v.calls.filter((c) => /iVBORw0K/.test(JSON.stringify(c.body))).length, 1);
});

test("providers: OpenAI-compatible agents, Perplexity sources, Gemini video, custom endpoints, search fallback", async () => {
  const pplx = extract(getProvider("perplexity")!, {
    choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
    citations: ["https://a.example/1"],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  });
  assert.deepEqual(pplx.sources, ["https://a.example/1"]);
  let sent: any;
  await complete(
    {
      provider: "google",
      model: "gemini-2.5-pro",
      key: "k",
      system: "s",
      prompt: "p",
      media: [{ name: "v.mp4", mime: "video/mp4", base64: "AAA" }],
    },
    (async (_u: string, i: any) => {
      sent = JSON.parse(i.body);
      return resp({ candidates: [{ content: { parts: [{ text: "seen" }] }, finishReason: "STOP" }] });
    }) as any,
  );
  assert.deepEqual(sent.contents[0].parts[0], { inline_data: { mime_type: "video/mp4", data: "AAA" } });
  // Claude cannot take video: it is not sent
  await complete(
    {
      provider: "anthropic",
      model: "m",
      key: "k",
      system: "s",
      prompt: "p",
      media: [{ name: "v.mp4", mime: "video/mp4", base64: "AAA" }],
    },
    (async (_u: string, i: any) => {
      sent = JSON.parse(i.body);
      return resp({ content: [{ type: "text", text: "x" }], stop_reason: "end_turn" });
    }) as any,
  );
  assert.equal(sent.messages[0].content, "p");
  // custom agent
  assert.equal(
    customUrl({ baseUrl: "https://api.example.com/v1/", style: "openai-chat" }),
    "https://api.example.com/v1/chat/completions",
  );
  assert.match(
    validateCustom({ id: "custom:x", name: "X", baseUrl: "http://insecure", style: "openai-chat", model: "m" })!,
    /https/,
  );
  setCustomAgents([
    { id: "custom:acme", name: "Acme", baseUrl: "https://llm.acme.ai/v1", style: "openai-chat", model: "acme-1" },
  ]);
  let url = "";
  const r = await complete({ provider: "custom:acme", model: "acme-1", key: "k", system: "s", prompt: "p" }, (async (
    u: string,
  ) => {
    url = u;
    return resp({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] });
  }) as any);
  assert.equal(url, "https://llm.acme.ai/v1/chat/completions");
  assert.equal(r.text, "hi");
  // web search rejected by the account → answer without it
  let n = 0;
  const r2 = await complete(
    { provider: "openai", model: "m", key: "k", system: "s", prompt: "p", search: true },
    (async (_u: string, i: any) => {
      n++;
      return JSON.parse(i.body).tools ? resp({}, 400) : resp({ output_text: "plain" });
    }) as any,
  );
  assert.equal(n, 2);
  assert.equal(r2.searched, false);
});

test("uploads: Word, PowerPoint, web pages and text become material; types are recognised", () => {
  const docx = toDocx("# Price list\n\nCroissant **$4** & coffee", {});
  assert.match(officeToText(docx, "menu.docx"), /Price list\nCroissant \$4 & coffee/);
  const pptx = toPptx("## Slide one\n- point A\n## Slide two\n- point B", {});
  assert.match(officeToText(pptx, "deck.pptx"), /## Slide 1[\s\S]*point A[\s\S]*## Slide 2[\s\S]*point B/);
  const h = htmlToText(
    "<html><title>Shop &amp; Co</title><script>x()</script><body><h1>Hi</h1><p>Price: 5&nbsp;USD</p></body></html>",
  );
  assert.equal(h.title, "Shop & Co");
  assert.match(h.text, /Hi\nPrice: 5 USD/);
  assert.doesNotMatch(h.text, /x\(\)/);
  assert.equal(kindOf("a.pdf", mimeFor("a.pdf")), "pdf");
  assert.equal(kindOf("clip.mov", mimeFor("clip.mov")), "video");
  assert.equal(kindOf("data.csv", mimeFor("data.csv", "application/octet-stream")), "text");
  assert.equal(kindOf("x.zip", "application/zip"), "unsupported");
  const m = materialFrom(
    [{ id: "1", name: "a.txt", mime: "text/plain", kind: "text", size: 3, text: "x".repeat(50) }],
    20,
  );
  assert.match(m, /=== FILE: a.txt ===\nx{20}\n\[… cut at 20/);
});

test("sign-in: SHA-256, PKCE, code exchange; a copied key is recognised", async () => {
  assert.equal(hex(sha256(enc.encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hex(sha256(new Uint8Array(0))), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(base64url(new Uint8Array([251, 255])), "-_8");
  const { verifier, challenge } = pkce((n) => new Uint8Array(n).fill(7));
  assert.equal(challenge, base64url(sha256(enc.encode(verifier))));
  assert.equal(codeFrom("passfair://auth?code=abc%20d&x=1"), "abc d");
  let body: any;
  const key = await exchangeCode("c", "v", (async (_u: string, i: any) => {
    body = JSON.parse(i.body);
    return resp({ key: "sk-or-v1-xyz" });
  }) as any);
  assert.equal(key, "sk-or-v1-xyz");
  assert.deepEqual(body, { code: "c", code_verifier: "v", code_challenge_method: "S256" });
  assert.deepEqual(detectKey(" sk-ant-api03-abcdefghijklmnopqrstuvwxyz "), {
    provider: "anthropic",
    key: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
  });
  assert.equal(detectKey("hello world"), null);
});

test("plan: free keeps every feature visible but limited; pro lifts the limits", () => {
  assert.equal(clamp("free", "agents", 5), 2);
  assert.equal(clamp("pro", "agents", 5), 5);
  assert.equal(LIMITS.free.video, false);
  assert.equal(LIMITS.pro.video, true);
  assert.ok(LIMITS.pro.exports.includes("pptx") && !LIMITS.free.exports.includes("pptx"));
});

test("keychain names: agent ids with ':' are made safe", async () => {
  const { safeName } = await import("../src/core/providers");
  assert.equal(safeName("custom:acme co"), "custom_acme_co");
  assert.equal(safeName("or:claude"), "or_claude");
  assert.equal(safeName("anthropic"), "anthropic");
});

test("utf8 fallback decodes ASCII, Chinese and emoji like TextDecoder", async () => {
  const { utf8 } = await import("../src/core/material");
  const sample = "Price ¥49 价格 ✓ 🚀";
  const bytes = new TextEncoder().encode(sample);
  const saved = (globalThis as any).TextDecoder;
  (globalThis as any).TextDecoder = undefined;
  try {
    assert.equal(utf8(bytes), sample);
  } finally {
    (globalThis as any).TextDecoder = saved;
  }
});

test("reasoning models (gpt-5-mini, o4-mini, Gemini 2.5, Grok 4) get room to think; an empty think-only answer is retried", async () => {
  const { complete, verify, isReasoningModel } = await import("../src/core/providers");
  for (const m of ["gpt-5-mini", "gpt-5", "o4-mini", "gemini-2.5-pro", "grok-4", "deepseek-reasoner", "openai/gpt-5"])
    assert.ok(isReasoningModel(m), m);
  for (const m of ["gpt-4.1", "claude-sonnet-4-5", "deepseek-chat", "grok-3"]) assert.ok(!isReasoningModel(m), m);
  // verify a gpt-5-mini key: first reply is all reasoning (incomplete, no text), the retry answers.
  const bodies: any[] = [];
  const f = (async (_u: string, i: any) => {
    const b = JSON.parse(i.body);
    bodies.push(b);
    return bodies.length === 1
      ? resp({ status: "incomplete", output: [{ type: "reasoning" }], usage: { input_tokens: 5, output_tokens: 4000 } })
      : resp({ status: "completed", output_text: "OK", usage: { input_tokens: 5, output_tokens: 900 } });
  }) as any;
  const r = await verify({ provider: "openai", model: "gpt-5-mini", key: "k" }, f);
  assert.equal(r.ok, true);
  assert.deepEqual(bodies[0].reasoning, { effort: "low" });
  assert.equal(bodies[0].max_output_tokens, 4000);
  assert.equal(bodies[1].max_output_tokens, 12000);
  // non-reasoning model keeps its small budget and no reasoning field
  let b2: any;
  await complete({ provider: "openai", model: "gpt-4.1", key: "k", system: "s", prompt: "p", maxTokens: 64 }, (async (
    _u: string,
    i: any,
  ) => {
    b2 = JSON.parse(i.body);
    return resp({ output_text: "OK" });
  }) as any);
  assert.equal(b2.max_output_tokens, 64);
  assert.equal(b2.reasoning, undefined);
  // still empty after the retry: a clear message, not a mystery
  await assert.rejects(
    complete({ provider: "openai", model: "gpt-5-mini", key: "k", system: "s", prompt: "p" }, (async () =>
      resp({ status: "incomplete", output: [] })) as any),
    /spent its whole output budget thinking/,
  );
});

test("a failing cross-checker does not stop the job: it continues with one reviewer and says so", async () => {
  const job = newJob({
    goal: "Spec",
    mode: "live",
    preset: "balanced",
    assignments: { planner: "anthropic", worker: "anthropic", reviewer: "anthropic", verifier: "openai" },
    minRounds: 1,
    maxRounds: 2,
  });
  const f = (async (url: string, init: any) => {
    if (url.includes("openai.com")) return resp({ status: "incomplete", output: [] });
    const sys = JSON.stringify(JSON.parse(init.body));
    const text = /Your role: REVIEWER/.test(sys)
      ? `{"verdict":"pass","score":9,"summary":"ok","criteria":[{"id":"C1","met":true,"evidence":"Buyer: export managers"}],"issues":[]}`
      : /Your role: PLANNER/.test(sys)
        ? "C1. names the buyer"
        : "Buyer: export managers. ".repeat(20);
    return resp({ content: [{ type: "text", text }], stop_reason: "end_turn" });
  }) as any;
  await runJob(job, { ...quiet, credential: cred, fetcher: f });
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.outcome, "approved_by_reviewer");
  assert.equal(job.assignments.verifier, undefined);
  assert.ok(job.events.some((e) => e.role === "check" && /Cross-checker unavailable/.test(e.text)));
});
