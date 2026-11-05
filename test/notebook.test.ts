import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyIngest,
  emptyNotebook,
  knowledgeBlock,
  librarianPrompt,
  notebookMarkdown,
  removePage,
  selectPages,
  terms,
} from "../src/core/notebook";
import { headFor, newJob, promptFor } from "../src/core/orchestrator";
import { LIMITS } from "../src/core/plan";

const src = (id: string) => ({ jobId: id, date: "2026-11-01T00:00:00Z", brief: "Price the coffee cart" });
const reply = JSON.stringify({
  pages: [
    {
      kind: "decision",
      title: "咖啡车定价",
      body: "美式 $4，拿铁 $5（估算：校园咖啡均价 $4–6）。理由：低于星巴克。",
      tags: ["定价", "咖啡"],
    },
    { kind: "entity", title: "目标客户", body: "本校学生和教职工，早 8–10 点高峰。", tags: ["客户"] },
    { kind: "question", title: "是否需要营业执照", body: "未确认：校园摊位是否需要城市执照。", tags: ["执照"] },
  ],
  conflicts: [],
  summary: "定价和目标客户",
});

test("ingest files decisions, entities and questions with their source", () => {
  const r = applyIngest(emptyNotebook(), reply, src("j1"), "2026-11-01T00:00:00Z");
  assert.equal(r.added, 3);
  assert.equal(r.notebook.pages[0].sources[0].jobId, "j1");
  assert.match(r.notebook.log[0].text, /定价/);
});

test("a later result updates the same page and reports what changed", () => {
  const first = applyIngest(emptyNotebook(), reply, src("j1"), "2026-11-01T00:00:00Z").notebook;
  const id = first.pages.find((p) => p.title === "咖啡车定价")!.id;
  const r = applyIngest(
    first,
    JSON.stringify({
      pages: [{ id, kind: "decision", title: "咖啡车定价", body: "美式 $3.5（估算：开学促销）。", tags: ["定价"] }],
      conflicts: [{ id, was: "美式 $4", now: "美式 $3.5" }],
    }),
    src("j2"),
    "2026-11-03T00:00:00Z",
  );
  assert.equal(r.added, 0);
  assert.equal(r.updated, 1);
  assert.equal(r.notebook.pages.length, 3);
  const p = r.notebook.pages.find((x) => x.id === id)!;
  assert.match(p.body, /3\.5/);
  assert.deepEqual(
    p.sources.map((s) => s.jobId),
    ["j1", "j2"],
  );
  assert.deepEqual(r.conflicts, [{ title: "咖啡车定价", was: "美式 $4", now: "美式 $3.5" }]);
});

test("an unusable librarian reply changes nothing", () => {
  const nb = emptyNotebook();
  assert.equal(applyIngest(nb, "sorry, I can't", src("j")).notebook, nb);
  assert.equal(applyIngest(nb, '{"pages":[{"title":"","body":""}]}', src("j")).added, 0);
});

test("a new brief gets only the relevant pages, within budget; unrelated briefs get none", () => {
  const nb = applyIngest(emptyNotebook(), reply, src("j1")).notebook;
  const hit = selectPages(nb, "咖啡车下个月要不要涨价？");
  assert.equal(hit[0].title, "咖啡车定价");
  assert.ok(!hit.some((p) => p.title === "是否需要营业执照"));
  assert.equal(selectPages(nb, "Write a poem about the ocean").length, 0);
  assert.ok(selectPages(nb, "咖啡 定价 客户 执照", 120).length <= 1, "budget respected");
});

test("CJK and Latin words both match", () => {
  assert.ok(terms("咖啡车定价").has("定价"));
  assert.ok(terms("Pricing the coffee cart").has("pricing"));
});

test("every agent sees the notebook pages in the shared brief header", () => {
  const nb = applyIngest(emptyNotebook(), reply, src("j1")).notebook;
  const knowledge = knowledgeBlock(selectPages(nb, "咖啡车要不要涨价"));
  const job = newJob({ goal: "咖啡车要不要涨价", mode: "live", preset: "make_and_ship", assignments: {}, knowledge });
  assert.match(headFor(job), /WHAT THE TEAM ALREADY KNOWS/);
  assert.match(promptFor(job, "worker", 1), /美式 \$4/);
  assert.equal(knowledgeBlock([]), "");
});

test("librarian prompt carries the index, the brief and the language", () => {
  const nb = applyIngest(emptyNotebook(), reply, src("j1")).notebook;
  const { system, prompt } = librarianPrompt(
    nb,
    { goal: "涨价吗", lang: "Simplified Chinese (简体中文)" },
    "结论：不涨价",
  );
  assert.match(system, /JSON only/);
  assert.match(system, /Simplified Chinese/);
  assert.match(prompt, /咖啡车定价/);
  assert.match(prompt, /结论：不涨价/);
});

test("export and delete; the notebook is a Pro feature", () => {
  const nb = applyIngest(emptyNotebook(), reply, src("j1")).notebook;
  const md = notebookMarkdown(nb);
  assert.match(md, /^# Passfair team notebook/);
  assert.match(md, /## Decisions[\s\S]*咖啡车定价/);
  assert.equal(removePage(nb, nb.pages[0].id).pages.length, 2);
  assert.equal(LIMITS.pro.notebook, true);
  assert.equal(LIMITS.free.notebook, false);
});
