import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { newJob } from "../src/core/orchestrator";
import { reportText } from "../src/core/report";

const app = JSON.parse(readFileSync("app.json", "utf8")).expo;

test("android config: system Photo Picker (no broad media permissions), keyboard resizes the screen", () => {
  for (const p of ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE", "SYSTEM_ALERT_WINDOW"])
    assert.ok(app.android.blockedPermissions.includes(`android.permission.${p}`), p);
  assert.equal(app.android.softwareKeyboardLayoutMode, "resize");
  assert.equal(app.android.package, "ai.agentsfair.passfair");
  assert.equal(app.scheme, "passfair");
});

test("report: reason, which agent, job id and an excerpt", () => {
  const job = newJob({ goal: "g", mode: "live", preset: "balanced", assignments: {} });
  const e = {
    role: "panelist" as const,
    stage: "ideas" as const,
    round: 0,
    provider: "xai",
    model: "grok-4",
    text: "bad text ".repeat(300),
    usage: { input: 0, output: 0 },
    at: "",
  };
  const r = reportText(job, e, "offensive", "  rude  ", "2.0.0");
  assert.match(r, /Reason: Offensive or hateful/);
  assert.match(r, /Content from: xai \(grok-4\) · ideas/);
  assert.match(r, new RegExp(`Job: ${job.id.slice(0, 8)}`));
  assert.match(r, /Note: rude/);
  assert.ok(r.length < 1600, "excerpt is capped");
});
