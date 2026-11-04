import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_BRIEF, type LiveTurn, newJob, runJob } from "../src/core/orchestrator";
import { complete, getProvider, sseAccumulator, utf8Decoder } from "../src/core/providers";

const enc = new TextEncoder();
const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
// A response whose body arrives in small pieces, cut in awkward places (even inside a Chinese character).
function streamingResponse(body: string, piece = 7, status = 200) {
  const bytes = enc.encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += piece) c.enqueue(bytes.slice(i, i + piece));
        c.close();
      },
    }),
    { status },
  );
}

test("UTF-8 split across chunks still decodes (中文 survives)", () => {
  const d = utf8Decoder();
  const b = enc.encode("结论：先卖咖啡 ☕ ok");
  let out = "";
  for (let i = 0; i < b.length; i += 2) out += d(b.slice(i, i + 2));
  assert.equal(out, "结论：先卖咖啡 ☕ ok");
});

const cases: [string, string, object[]][] = [
  [
    "anthropic",
    "claude-sonnet-4-5",
    [
      { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 20 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "结论：" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "先做 A。" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
    ],
  ],
  [
    "openai",
    "gpt-4.1",
    [
      { type: "response.output_text.delta", delta: "结论：" },
      { type: "response.output_text.delta", delta: "先做 A。" },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output_text: "结论：先做 A。",
          usage: { input_tokens: 120, output_tokens: 9 },
        },
      },
    ],
  ],
  [
    "google",
    "gemini-2.5-flash",
    [
      { candidates: [{ content: { parts: [{ text: "结论：" }] } }] },
      {
        candidates: [{ content: { parts: [{ text: "先做 A。" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9 },
      },
    ],
  ],
  [
    "xai",
    "grok-4",
    [
      { choices: [{ delta: { content: "结论：" } }] },
      { choices: [{ delta: { content: "先做 A。" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9 } },
    ],
  ],
];

for (const [provider, model, events] of cases)
  test(`${provider}: words arrive while the agent writes, and the final answer and usage match`, async () => {
    const seen: string[] = [];
    let url = "";
    let body: any;
    const out = await complete(
      { provider, model, key: "k", system: "s", prompt: "p", maxTokens: 500, onDelta: (t) => seen.push(t) },
      (async (u: string, init: RequestInit) => {
        url = u;
        body = JSON.parse(String(init.body));
        return streamingResponse(sse(events));
      }) as any,
      async () => {},
    );
    assert.equal(out.text, "结论：先做 A。");
    assert.ok(seen.length >= 2 && seen[0] === "结论：", `partial text shown first: ${seen.join(" | ")}`);
    assert.ok(out.usage.input >= 100 && out.usage.output === 9);
    if (provider === "google") assert.match(url, /:streamGenerateContent\?alt=sse$/);
    else assert.equal(body.stream, true);
  });

test("an endpoint that refuses streaming is asked again the ordinary way", async () => {
  let calls = 0;
  const out = await complete(
    { provider: "mistral", model: "mistral-large-latest", key: "k", system: "s", prompt: "p", onDelta: () => {} },
    (async (_u: string, init: RequestInit) => {
      calls++;
      const b = JSON.parse(String(init.body));
      if (b.stream) return new Response("{}", { status: 422 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
      );
    }) as any,
    async () => {},
  );
  assert.equal(out.text, "ok");
  assert.equal(calls, 2);
});

test("web-search answers are not streamed, so their source links stay complete", async () => {
  let body: any;
  await complete(
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      key: "k",
      system: "s",
      prompt: "p",
      search: true,
      onDelta: () => {},
    },
    (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "x" }], usage: {} }));
    }) as any,
    async () => {},
  );
  assert.equal(body.stream, undefined);
});

test("an error event in the stream fails the call instead of returning half an answer", async () => {
  await assert.rejects(
    complete(
      { provider: "anthropic", model: "claude-sonnet-4-5", key: "k", system: "s", prompt: "p", onDelta: () => {} },
      (async () => streamingResponse(sse([{ type: "error", error: { type: "overloaded_error" } }]))) as any,
      async () => {},
    ),
    /reported an error/,
  );
});

test("the accumulator handles CRLF line endings and multi-line data", () => {
  const acc = sseAccumulator(getProvider("xai")!);
  acc.push(
    'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\n',
  );
  assert.equal(acc.done().text, "ab");
});

test("the run reports each agent's text live (reviews only when complete) and clears it after", async () => {
  const job = newJob({
    goal: DEMO_BRIEF,
    mode: "demo",
    preset: "make_and_ship",
    assignments: { planner: "demo", worker: "demo", reviewer: "demo", verifier: "demo" },
    maxRounds: 2,
  });
  const live = new Map<string, LiveTurn>();
  const roles = new Set<string>();
  let maxOpen = 0;
  await runJob(job, {
    save: () => {},
    isCancelled: () => false,
    credential: () => null,
    sleep: async () => {},
    demoDelay: 8,
    onLive: (k, t) => {
      if (t) (live.set(k, t), roles.add(t.role));
      else live.delete(k);
      maxOpen = Math.max(maxOpen, live.size);
    },
  });
  assert.ok(roles.has("worker") && roles.has("planner"));
  assert.ok(!roles.has("reviewer"), "reviews are not typed out");
  assert.equal(live.size, 0, "nothing left showing once the run is done");
  assert.ok(maxOpen >= 1);
});
