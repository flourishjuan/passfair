import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLanguage, languageFor } from "../src/core/language";
import { headFor, newJob, promptFor, reopenWithFeedback, systemFor } from "../src/core/orchestrator";

test("detects the user's language", () => {
  assert.equal(detectLanguage("帮我想想第一款产品应该卖什么"), "Simplified Chinese (简体中文)");
  assert.equal(detectLanguage("幫我想想第一款產品應該賣什麼，這個問題很重要"), "Traditional Chinese (繁體中文)");
  assert.equal(detectLanguage("最初に何を売るべきか考えてください"), "Japanese");
  assert.equal(detectLanguage("무엇을 먼저 팔아야 할까요"), "Korean");
  assert.equal(detectLanguage("¿Qué producto debería vender primero para mi tienda?"), "Spanish");
  assert.equal(detectLanguage("What should we sell first and how do we price it?"), "English");
  assert.equal(detectLanguage("Что продавать в первую очередь?"), "Russian");
});

test("too little to tell keeps the language of the conversation so far", () => {
  assert.equal(detectLanguage("ok"), null);
  assert.equal(detectLanguage("```js\nconst x = 1\n```"), null);
  assert.equal(languageFor("ok", "Simplified Chinese (简体中文)"), "Simplified Chinese (简体中文)");
  assert.equal(languageFor("Make it shorter please, and add prices", "Simplified Chinese (简体中文)"), "English");
});

const base = { mode: "live" as const, preset: "make_and_ship" as const, assignments: {} };

test("every agent's prompt carries the language: brainstorm, build and review steps", () => {
  const j = newJob({
    ...base,
    goal: "帮我给新咖啡店定价，三个方案",
    flow: "brainstorm",
    panel: ["openai", "anthropic"],
  });
  assert.equal(j.lang, "Simplified Chinese (简体中文)");
  assert.match(headFor(j), /^OUTPUT LANGUAGE: Simplified Chinese/);
  for (const role of ["planner", "worker", "reviewer", "verifier", "framer", "researcher"] as const)
    assert.match(promptFor(j, role, 1), /OUTPUT LANGUAGE: Simplified Chinese/, role);
  assert.match(systemFor(j, "panelist", 0, 1), /OUTPUT LANGUAGE stated at the top/);
});

test("a short new brief follows the previous conversation; the user's follow-up language wins", () => {
  const j = newJob({ ...base, goal: "ok", previousLang: "Simplified Chinese (简体中文)" });
  assert.equal(j.lang, "Simplified Chinese (简体中文)");
  reopenWithFeedback(j, "you", "Please rewrite this for an American audience and keep it short");
  assert.equal(j.lang, "English");
  reopenWithFeedback(j, "muse", "Error 500 while publishing");
  assert.equal(j.lang, "English", "deployment errors don't change the language");
  reopenWithFeedback(j, "you", "好");
  assert.equal(j.lang, "English", "one character is too little to switch");
  reopenWithFeedback(j, "you", "改成中文，再短一点");
  assert.equal(j.lang, "Simplified Chinese (简体中文)");
});
