// Guard against a launch crash on iPhone (build 35, Nov 2026): installing one extra package quietly moved a
// native module (expo-font 58.0.10 → 58.0.11) to a version the rest of the native code did not match, and the
// app closed at launch. Every native package — including ones that come in indirectly — must stay exactly at
// the versions of the last build that ran on a phone. Changing one is a deliberate decision: update this list
// only together with a real-device test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TESTED: Record<string, string> = {
  "@expo/dom-webview": "58.0.2",
  "@expo/log-box": "58.0.13",
  "@react-native-async-storage/async-storage": "2.2.0",
  expo: "58.0.20",
  "expo-clipboard": "58.0.4",
  "expo-constants": "58.0.13",
  "expo-crypto": "58.0.7",
  "expo-document-picker": "58.0.4",
  "expo-file-system": "58.0.12",
  "expo-haptics": "58.0.7",
  "expo-iap": "6.4.1",
  "expo-image-loader": "58.0.3",
  "expo-image-picker": "58.0.10",
  "expo-keep-awake": "58.0.3",
  "expo-linking": "58.0.14",
  "expo-modules-autolinking": "58.0.15",
  "expo-modules-cli": "0.3.3",
  "expo-modules-core": "58.0.27",
  "expo-modules-jsi": "58.0.20",
  "expo-modules-macros": "0.24.0",
  "expo-print": "58.0.7",
  "expo-secure-store": "58.0.2",
  "expo-server": "58.0.6",
  "expo-sharing": "58.0.20",
  "expo-splash-screen": "58.0.11",
  "expo-status-bar": "58.0.4",
  "expo-web-browser": "58.0.7",
  "expo-asset": "58.0.18",
  "expo-font": "58.0.10",
  "react-native": "0.88.0",
  "react-native-background-actions": "4.1.0",
  "react-native-safe-area-context": "5.10.1",
  "react-native-web": "0.21.4",
};

test("native packages in the lockfile match the last build that ran on a phone", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")).packages;
  const found: Record<string, string> = {};
  const problems: string[] = [];
  for (const [path, info] of Object.entries<any>(lock)) {
    const name = path.replace(/.*node_modules\//, "");
    if (
      !/^(expo|expo-[\w-]+|@expo\/(dom-webview|log-box|vector-icons)|react-native(-[\w-]+)?|@react-native-async-storage\/async-storage)$/.test(
        name,
      )
    )
      continue;
    if (!(name in TESTED)) problems.push(`new native package ${name}@${info.version} — not in a phone-tested build`);
    else if (TESTED[name] !== info.version) problems.push(`${name} is ${info.version}, phone-tested ${TESTED[name]}`);
    found[name] = info.version;
  }
  for (const name of Object.keys(TESTED)) if (!(name in found)) problems.push(`${name} disappeared from the lockfile`);
  assert.deepEqual(problems, []);
});
