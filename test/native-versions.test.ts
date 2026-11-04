// Guards against the 2.0.0 launch crash: a native module newer than the Expo core it is linked against
// (expo-print 58.0.8 needed ExpoModulesJSI 58.0.21; the app shipped 58.0.20 → "Symbol not found" at launch).
// Every native dependency must be pinned to exactly the version this Expo SDK was tested with.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const pkg = json("package.json");
const sdk: Record<string, string> = json("node_modules/expo/bundledNativeModules.json");

test("native modules: installed and pinned to the exact SDK-tested version", () => {
  const bad: string[] = [];
  for (const [name, spec] of Object.entries(pkg.dependencies as Record<string, string>)) {
    if (!sdk[name] || name === "expo") continue;
    const want = sdk[name].replace(/^[~^]/, "");
    const got = json(`node_modules/${name}/package.json`).version;
    if (got !== want) bad.push(`${name}: installed ${got}, SDK tested ${want}`);
    if (spec !== want) bad.push(`${name}: package.json says "${spec}", pin it to "${want}"`);
  }
  assert.deepEqual(bad, []);
});

test("third-party native modules are pinned exactly", () => {
  for (const name of ["expo-iap", "react-native-background-actions"]) assert.match(pkg.dependencies[name], /^\d+\.\d+\.\d+$/, name);
});
