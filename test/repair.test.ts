import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
import {
  answerPrompt,
  capabilityRefusal,
  initCollection,
  mediaNotes,
  runCollection,
  wantsBuild,
} from "../src/core/collection";
import { extractCodeFiles, fencedBlocks, makeZip, sanitizePath, ZIP_MAX_FILES } from "../src/core/codepack";
import { kindOf, officeToText, zipToText } from "../src/core/material";
import { newJob } from "../src/core/orchestrator";
import { LIMITS } from "../src/core/plan";

/* ---------- wantsBuild / capabilityRefusal ---------- */

test("a build brief is recognised in Chinese and English; ordinary questions are not", () => {
  assert.ok(wantsBuild("帮我做一个塔防小游戏的demo"));
  assert.ok(wantsBuild("Build me a prototype app for shift planning"));
  assert.ok(!wantsBuild("北美市场有哪些低成本生意？"));
  assert.ok(!wantsBuild(""));
});

// The wording Juan screenshotted on 2026-11-18: Claude declines to code and redirects to outsourcing.
const SCREENSHOT_STYLE =
  "作为AI助手，我无法实际编写代码、构建项目或生成可执行文件。但我可以为你提供三种可行方案：方案二：外包开发团队，推荐平台：猪八戒网、程序员客栈，成本预估：8000-15000元。";

test("a refusal that redirects to outsourcing is flagged on a build brief", () => {
  const p = capabilityRefusal(SCREENSHOT_STYLE, "帮我做一个塔防游戏的demo");
  assert.ok(p, "flagged");
  assert.match(p!, /cannot|hands the work/);
});

test("clean answers and non-build briefs are not flagged", () => {
  const withCode = "这是完整代码：\n```index.html\n<html><body>hi</body></html>\n```\n运行：浏览器打开即可。";
  assert.equal(capabilityRefusal(withCode, "帮我做一个塔防游戏的demo"), null, "code delivered");
  assert.equal(capabilityRefusal(SCREENSHOT_STYLE, "北美有哪些生意？"), null, "not a build brief");
  assert.equal(
    capabilityRefusal("攻城界面用 3×4 格子布局，基地每回合产出 50 金币（estimate: 同类H5游戏均值）。", "帮我做一个游戏demo"),
    null,
    "no refusal wording",
  );
  assert.equal(capabilityRefusal("I cannot attend the meeting.", "帮我做一个游戏demo"), null, "unrelated cannot");
});

/* ---------- prompts ---------- */

test("build briefs get a completeness rule, other briefs keep the one-screen limit", () => {
  const job = newJob({
    goal: "帮我做一个塔防小游戏的demo",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  const build = answerPrompt(job, job.collection!, 1, []);
  assert.match(build.prompt, /deliver it COMPLETE/);
  assert.match(build.prompt, /file name on the fence line/);
  assert.ok(!/one phone screen/.test(build.prompt));

  const chat = newJob({
    goal: "北美市场有哪些低成本生意？",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  const plain = answerPrompt(chat, chat.collection!, 1, []);
  assert.match(plain.prompt, /one phone screen/);
  assert.ok(!/deliver it COMPLETE/.test(plain.prompt));
});

test("the seeing agent's notes reach the answering agents' prompts", () => {
  const job = newJob({
    goal: "这张图里的菜单值多少钱？",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  job.events.push({
    role: "seer",
    round: 0,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    text: "图中是一张手写菜单：咖啡 30 元，三明治 45 元。",
    usage: { input: 0, output: 0 },
    at: new Date().toISOString(),
  });
  assert.match(mediaNotes(job), /手写菜单/);
  const p = answerPrompt(job, job.collection!, 1, []);
  assert.match(p.prompt, /NOTES ON THE ATTACHED FILES/);
  assert.match(p.prompt, /咖啡 30 元/);
});

/* ---------- live run: seer pass + refusal retry (fake vendor) ---------- */

const anthropicReply = (text: string) =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

test("collection run reads attached files once and, with the opt-in on, retries a refusal until code is delivered", async () => {
  const bodies: string[] = [];
  const replies = [
    JSON.stringify({ broad: false, constraints: {} }), // 1: scope
    "图中是一张游戏草图：3×4 格子，右下角一个基地。", // 2: seer
    SCREENSHOT_STYLE, // 3: first answer — the refusal
    "```index.html\n<!doctype html><html><body><canvas id='game'></canvas></body></html>\n```\n运行：用浏览器打开 index.html。", // 4: retry with code
  ];
  const fetcher = async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return anthropicReply(replies.shift()!);
  };
  const job = newJob({
    goal: "帮我做一个塔防小游戏的demo",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
    seer: "anthropic",
  });
  const deps = {
    save: () => {},
    isCancelled: () => false,
    credential: () => ({ provider: "anthropic", model: "claude-sonnet-4-5", key: "sk-ant-test" }),
    fetcher,
    sleep: async () => {},
    demoDelay: 0,
    refusalRedo: true, // Team → Data opt-in: the refusal redo is an extra paid call
    media: [{ name: "sketch.png", mime: "image/png", base64: "QUJD" }],
  };
  await runCollection(job, deps);

  const seer = job.events.find((e) => e.role === "seer");
  assert.ok(seer && !seer.failed, "the files were read");
  assert.match(seer!.text, /草图/);

  const answerBodies = bodies.slice(2);
  assert.match(answerBodies[0], /草图：3×4 格子/, "the answering agent works from the seer's notes");
  assert.equal(job.events.filter((e) => e.role === "answer").length, 1, "the retry replaces the refusal");
  const answer = job.events.find((e) => e.role === "answer")!;
  assert.ok(!answer.failed);
  assert.match(answer.text, /```index\.html/, "the final answer delivers the code");
  assert.ok(answerBodies.length >= 2, "the refusal was retried");
  assert.match(answerBodies[1], /BROKE THE USER'S REQUIREMENTS/);
});

test("with the opt-in off (default), a refusal is delivered as-is and no extra paid call is made", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return anthropicReply(calls === 1 ? JSON.stringify({ broad: false, constraints: {} }) : SCREENSHOT_STYLE);
  };
  const job = newJob({
    goal: "帮我做一个塔防小游戏的demo",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
  });
  await runCollection(job, {
    save: () => {},
    isCancelled: () => false,
    credential: () => ({ provider: "anthropic", model: "claude-sonnet-4-5", key: "k" }),
    fetcher,
    sleep: async () => {},
    demoDelay: 0,
    // refusalRedo intentionally unset: the default is off
  });
  const answer = job.events.find((e) => e.role === "answer")!;
  assert.equal(answer.text, SCREENSHOT_STYLE, "delivered unchanged — no silent redo");
  assert.equal(calls, 2, "scope + answer only; the redo did not spend another call");
});

test("the seer runs only once across resume and its failure does not kill the run", async () => {
  let calls = 0;
  const fetcher = async (_url: string, init: RequestInit) => {
    calls++;
    if (String(init.body).includes("Describe the attached files")) return new Response("bad key", { status: 400 });
    return anthropicReply(calls === 1 ? JSON.stringify({ broad: false, constraints: {} }) : "正文答案。");
  };
  const job = newJob({
    goal: "看看这张图的报价合理吗",
    mode: "live",
    preset: "make_and_ship",
    flow: "collection",
    panel: ["anthropic"],
    assignments: {},
    seer: "anthropic",
  });
  const deps = {
    save: () => {},
    isCancelled: () => false,
    credential: () => ({ provider: "anthropic", model: "claude-sonnet-4-5", key: "k" }),
    fetcher,
    sleep: async () => {},
    demoDelay: 0,
    media: [{ name: "quote.png", mime: "image/png", base64: "QUJD" }],
  };
  await runCollection(job, deps);
  const seer = job.events.find((e) => e.role === "seer");
  assert.ok(seer?.failed, "the failed read is recorded, not hidden");
  assert.ok(job.events.some((e) => e.role === "answer" && !e.failed), "the run carried on without the notes");
  const callsAfterFirstRun = calls;
  await runCollection(job, deps); // resume: user asked for more
  assert.equal(
    job.events.filter((e) => e.role === "seer").length,
    1,
    "no second paid seer call on resume",
  );
  assert.ok(calls > callsAfterFirstRun);
});

/* ---------- codepack ---------- */

test("code blocks become files: fence name, title=, comment name, heading above", () => {
  const md = [
    "这是完整项目：",
    "```index.html",
    "<html><body>demo</body></html>",
    "```",
    "",
    "```js title=\"src/game.js\"",
    "console.log('hi')",
    "```",
    "",
    "```python",
    "# tools/build.py",
    "print('build')",
    "```",
    "",
    "### styles/main.css",
    "```css",
    "body { margin: 0; }",
    "```",
  ].join("\n");
  const files = extractCodeFiles(md);
  assert.deepEqual(
    files.map((f) => f.name),
    ["index.html", "src/game.js", "tools/build.py", "styles/main.css"],
  );
  assert.match(files[0].content, /<html>/);
});

test("unnamed blocks are skipped unless one block is the whole answer", () => {
  assert.deepEqual(extractCodeFiles("说明：\n```\nsome inline snippet\n```\n```\nsecond\n```"), []);
  const one = extractCodeFiles("```html\n<html></html>\n```");
  assert.deepEqual(one.map((f) => f.name), ["main.html"]);
});

test("path traversal and device names cannot escape the zip", () => {
  assert.equal(sanitizePath("../../etc/passwd.txt"), "etc/passwd.txt");
  assert.equal(sanitizePath("/abs/x.js"), "abs/x.js");
  assert.equal(sanitizePath("a/../b.js"), "a/b.js"); // traversal segment removed, path stays inside the zip
  assert.equal(sanitizePath("CON.txt"), null);
  assert.equal(sanitizePath("no-extension"), null);
  assert.equal(sanitizePath("src/App.tsx"), "src/App.tsx");
});

test("a repeated file name keeps the latest revision", () => {
  const md = "```a.js\nold\n```\n修正：\n```a.js\nnew\n```";
  const files = extractCodeFiles(md);
  assert.equal(files.length, 1);
  assert.match(files[0].content, /new/);
});

test("makeZip writes a real archive that round-trips", () => {
  const zip = makeZip([
    { name: "index.html", content: "<html>你好</html>\n" },
    { name: "src/game.js", content: "let x = 1;\n" },
  ]);
  const files = unzipSync(zip);
  assert.deepEqual(Object.keys(files).sort(), ["index.html", "src/game.js"]);
  assert.equal(strFromU8(files["index.html"]), "<html>你好</html>\n");
});

test("makeZip bounds: duplicate names get a suffix, oversized projects throw", () => {
  const zip = makeZip([
    { name: "a.js", content: "1" },
    { name: "a.js", content: "2" },
  ]);
  const names = Object.keys(unzipSync(zip)).sort();
  assert.deepEqual(names, ["a-2.js", "a.js"]);
  assert.throws(
    () => makeZip([{ name: "big.txt", content: "x".repeat(10 * 1024 * 1024 + 1) }]),
    /10 MB limit/,
  );
  assert.throws(
    () =>
      makeZip(
        Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.txt`, content: "x" })),
      ),
    /Too many files/,
  );
});

test("fencedBlocks keeps the code verbatim", () => {
  const b = fencedBlocks("```js\nconst a = `template`;\n```");
  assert.equal(b[0].code, "const a = `template`;");
});

/* ---------- plan wiring ---------- */

test("existing entitlements are preserved: Code (.zip) is a Pro export, the free list is unchanged", () => {
  assert.deepEqual(LIMITS.free.exports, ["md", "pdf"]);
  assert.ok(LIMITS.pro.exports.includes("codezip"));
  assert.ok(LIMITS.pro.exports.includes("record"));
});

test("collection init still parses the brief", () => {
  const st = initCollection("给我20个北美生意点子");
  assert.equal(st.constraints.count, 20);
  assert.equal(st.total, 2);
});

/* ---------- data-package (zip) upload: bounded streaming extraction ---------- */

function patchDeclaredUncompressedSize(zip: Uint8Array, declared: number): Uint8Array {
  // Forge the header: claim a tiny uncompressed size in BOTH the local header and the central
  // directory while the real deflate stream stays huge. This is the attack header-trusting
  // extractors lose to. Local header: sig PK\x03\x04, uncompressed size at +22.
  // Central directory: sig PK\x01\x02, uncompressed size at +24.
  const z = zip.slice();
  const w = (o: number) => {
    z[o] = declared & 255;
    z[o + 1] = (declared >> 8) & 255;
    z[o + 2] = (declared >> 16) & 255;
    z[o + 3] = (declared >> 24) & 255;
  };
  assert.equal(z[0], 0x50, "local header sig");
  assert.equal(z[1], 0x4b);
  assert.equal(z[2], 3);
  assert.equal(z[3], 4);
  w(22);
  for (let i = 0; i < z.length - 4; i++) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 1 && z[i + 3] === 2) {
      w(i + 24);
      break;
    }
  }
  return z;
}

test("a zip upload is read as material: text members extracted, binary and nested zips listed only", () => {
  const inner = zipSync({ "secret.txt": strToU8("nested") });
  const archive = zipSync({
    "data/prices.csv": strToU8("item,price\ncoffee,30\n"),
    "notes.md": strToU8("# 计划\n先卖咖啡。\n"),
    "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    "inner.zip": inner,
  });
  assert.equal(kindOf("bundle.zip", "application/zip"), "zip");
  assert.equal(kindOf("bundle.zip", "application/octet-stream"), "zip");
  const text = zipToText(archive, "bundle.zip");
  assert.match(text, /prices\.csv/);
  assert.match(text, /coffee,30/);
  assert.match(text, /先卖咖啡/);
  assert.match(text, /logo\.png \(binary - not read\)/);
  assert.match(text, /inner\.zip \(nested zip - not opened\)/);
  assert.doesNotMatch(text, /secret\.txt/); // the nested archive is never examined
});

test("zip safety: a damaged zip says so plainly", () => {
  assert.throws(
    () => zipToText(strToU8("this is not a zip"), "bad.zip"),
    /could not read this zip/,
  );
});

test("zip safety: a 50 MB bomb is stopped by actual decompressed bytes, not by the header", () => {
  const huge = strToU8("y".repeat(50 * 1024 * 1024));
  const bomb = zipSync({ "huge.txt": huge });
  assert.ok(bomb.length < 200_000, `the bomb is tiny compressed (${bomb.length} bytes)`);
  for (const [label, archive] of [
    ["honest header", bomb],
    ["forged header claiming 100 bytes", patchDeclaredUncompressedSize(bomb, 100)],
  ] as const) {
    const started = Date.now();
    const text = zipToText(archive, "bomb.zip");
    assert.ok(Date.now() - started < 10_000, `${label}: reading stops promptly`);
    assert.ok(text.length < 260_000, `${label}: retained text stays near the 200 KB budget (got ${text.length})`);
    assert.match(text, /expands past 2[0-9] MB of actual data/, label);
    assert.match(text, /over 2 MB of actual data - only the first part shown/, label);
    assert.match(text, /0 text members extracted/, label); // a bomb yields no usable text at all
  }
});

test("zip safety: member count is capped and huge single members are cut", () => {
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i < 210; i++) many[`f${i}.txt`] = strToU8(`file ${i}`);
  const text = zipToText(zipSync(many), "many.zip");
  assert.match(text, /10 further members beyond the 200-member limit - not read/);

  const big = zipSync({ "huge.txt": strToU8("y".repeat(3 * 1024 * 1024)), "small.txt": strToU8("ok") });
  const t2 = zipToText(big, "mixed.zip");
  assert.match(t2, /huge\.txt: over 2 MB of actual data - only the first part shown/);
  assert.match(t2, /small\.txt/); // the next member is still read
});

test("zip upload: unknown extensions are sniffed by content, and the budget is shared across members", () => {
  const textFile = strToU8("plain words, no extension to help\n".repeat(100));
  const binFile = new Uint8Array(600);
  binFile[0] = 0; // NUL byte marks it binary
  const archive = zipSync({ "mystery1": textFile, "mystery2": binFile });
  const text = zipToText(archive, "mystery.zip");
  assert.match(text, /=== FILE: mystery1 ===\nplain words/);
  assert.match(text, /mystery2 \(binary - not read\)/);

  const half = strToU8("z".repeat(150_000));
  const two = zipToText(zipSync({ "a.txt": half, "b.txt": half, "c.txt": half }), "two.zip");
  assert.ok(two.length < 260_000, "three 150 KB members share the 200 KB budget");
  assert.match(two, /cut at the shared text budget|text budget used up/);
});

test("zip safety: the zip64 size marker is rejected up front (fflate z64e never runs)", () => {
  // fflate 0.8.2's streaming parser hangs in z64e when a local header declares the 0xFFFFFFFF
  // compressed-size marker without a zip64 extra field. The reader must reject this before parsing.
  const good = zipSync({ "a.csv": strToU8("x,1\ny,2\n") });
  const z = good.slice();
  z[18] = z[19] = z[20] = z[21] = 0xff; // local header compressed size = the zip64 marker
  assert.throws(() => zipToText(z, "z64.zip"), /zip64 archives are not supported/);
  // and the honest archive still reads fine
  assert.match(zipToText(good, "good.zip"), /a\.csv/);
});

/* ---------- Office (docx/xlsx/pptx): bounded streaming reader ---------- */

function forgeCentralUncompressedSize(zip: Uint8Array, declared: number): Uint8Array {
  // Forge every central-directory entry's declared uncompressed size (offset +24 from PK\x01\x02).
  const z = zip.slice();
  for (let i = 0; i < z.length - 28; i++) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 1 && z[i + 3] === 2) {
      z[i + 24] = declared & 255;
      z[i + 25] = (declared >> 8) & 255;
      z[i + 26] = (declared >> 16) & 255;
      z[i + 27] = (declared >> 24) & 255;
    }
  }
  return z;
}

const docxShape = () =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:body><w:p><w:r><w:t>Hello contract</w:t></w:r></w:p></w:body>"),
    "word/media/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });

test("office regression: a docx declaring 2 GB / 8 GB in its central directory reads bounded, no huge allocation", () => {
  // Baseline officeToText allocated the declared size up front (8 GB -> RangeError, 2 GB -> real
  // 2 GB allocation). The bounded reader never consults declared sizes.
  for (const declared of [2_000_000_000, 8_000_000_000]) {
    const forged = forgeCentralUncompressedSize(docxShape(), declared);
    const before = process.memoryUsage().heapUsed;
    const out = officeToText(forged, "case.docx");
    assert.match(out, /Hello contract/);
    assert.ok(process.memoryUsage().heapUsed - before < 50_000_000, `no huge allocation for declared ${declared}`);
  }
  // forged local-header zip64 marker: rejected before parsing
  const z = docxShape();
  z[18] = z[19] = z[20] = z[21] = 0xff;
  assert.throws(() => officeToText(z, "z64.docx"), /zip64 archives are not supported/);
});

test("office: damaged archives and oversized members fail clean - never a partial document", () => {
  assert.throws(() => officeToText(strToU8("not a document"), "bad.docx"), /could not read this document/);
  const big = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:body><w:p>${"x".repeat(5 * 1024 * 1024)}</w:p></w:body>`),
  });
  assert.throws(() => officeToText(big, "big.docx"), /too large to read/);
  // and the honest document still extracts, media members skipped
  assert.match(officeToText(docxShape(), "ok.docx"), /Hello contract/);
});
