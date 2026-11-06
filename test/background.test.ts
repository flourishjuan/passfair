import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { shouldAutoResume } from "../src/core/resume";

test("a run paused by the system resumes by itself; stopped-by-you, failed and demo runs do not", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const at = (m: number) => new Date(now - m * 60000).toISOString();
  const j = (o: object) => ({
    status: "stopped",
    error: "interrupted",
    mode: "live",
    created: at(10),
    events: [{ at: at(5) }],
    ...o,
  });
  assert.equal(shouldAutoResume(j({}), now), true);
  assert.equal(shouldAutoResume(j({ error: undefined }), now), false, "the user pressed Stop");
  assert.equal(shouldAutoResume(j({ status: "failed" }), now), false);
  assert.equal(shouldAutoResume(j({ mode: "demo" }), now), false);
  assert.equal(shouldAutoResume(j({ events: [{ at: at(60 * 7) }] }), now), false, "older than 6 hours");
});

test("Android: the foreground service is declared with type dataSync and its permissions", () => {
  const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
  assert.ok(app.plugins.includes("./plugins/with-background-run"));
  const plugin = readFileSync("plugins/with-background-run.js", "utf8");
  assert.match(plugin, /foregroundServiceType": "dataSync"|"android:foregroundServiceType": "dataSync"/);
  assert.match(plugin, /FOREGROUND_SERVICE_DATA_SYNC/);
  assert.ok(!app.android.blockedPermissions.some((p: string) => /FOREGROUND_SERVICE/.test(p)));
});

test("the run holds background time and a system cut-off pauses instead of failing", () => {
  const s = readFileSync("src/ui/useStudio.ts", "utf8");
  assert.match(s, /holdBackground\(/);
  assert.match(s, /releaseBackground\(/);
  assert.match(s, /bgCutRef\.current \|\| AppState\.currentState !== "active"/);
  assert.match(s, /AppState\.addEventListener\("change"/);
});
