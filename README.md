# Passfair

**Your AI agents, finally talking to each other.** Claude plans and drafts, GPT polishes, Claude reviews — and when your Muse can't publish the result, the problem comes straight back to the team. One conversation. No copy-paste. Runs on your phone with your own API keys.

Open source under the [Apache License 2.0](LICENSE). The Passfair name and logo are trademarks — see [TRADEMARKS.md](TRADEMARKS.md).

[中文说明在下方](#中文说明)

## What it does

1. **Connect** — one button per vendor (Claude, GPT, Gemini). Paste a key; it is checked with one tiny request and stored in the device keychain.
2. **Send a brief** — the team is assigned automatically from a preset: Planner → Worker → (Polisher) → Reviewer, up to 6 rounds. Every draft and verdict appears as a message.
3. **Cut in** — type while they work; the team stops and follows your new instruction.
4. **Hand off** — pair your own Muse (Meta's agent) with a one-time code. Approved work goes to Muse to publish; publishing problems come back as feedback and the team fixes them. Until the Muse connector is approved by Meta, *Copy for Muse* gives you a paste-ready package.
5. **Demo** — with nothing connected, Send runs a scripted demo so you can watch the loop for free.

## Privacy, in one line

Keys stay in your keychain and go only to their vendor; drafts stay on the phone; only what you hand off travels (encrypted relay, 7 days). No analytics. Full policy: [PRIVACY.md](PRIVACY.md).

## Run it

```sh
npm install
npm test            # core loop + provider adapters, no network
npm run typecheck
npx expo start      # scan the QR code with Expo Go, or press w for the web preview
```

`expo-secure-store` is a native module, so the keychain works in a development build or a store build; in Expo Go and on the web the app falls back to browser storage and says so.

## Build and ship (EAS, no Xcode needed)

```sh
npx eas-cli@latest login
npx eas-cli@latest init                       # writes extra.eas.projectId into app.json
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest build --platform android --profile production
npx eas-cli@latest submit --platform ios      # to TestFlight / App Store Connect
npx eas-cli@latest submit --platform android  # to Google Play internal track
```

Step-by-step store checklist (screenshots, privacy answers, review notes): [docs/STORE_SUBMISSION_ZH.md](docs/STORE_SUBMISSION_ZH.md).

## Project layout

```
App.tsx                  one screen: connect bar · conversation · composer
src/core/orchestrator.ts the collaboration loop, prompts, presets, demo (no UI, fully tested)
src/core/providers.ts    Anthropic / OpenAI / Google adapters (direct HTTPS, fixed endpoints)
src/core/relay.ts        Handoff Relay client (Muse pairing, orders, deliverables)
src/core/assign.ts       preset → who sits in which seat
src/store/storage.ts     keychain for keys, AsyncStorage for jobs and settings
src/ui/                  components, theme, the useStudio hook
test/core.test.ts        node --test, no network
```

The desktop edition of Passfair (Mac/Windows, same loop, same relay) lives in the Agents Fair repository and is downloadable at https://challenge.agentsfair.ai/passfair.

## Contributing

Issues and pull requests are welcome. Keep the core free of UI and network side effects so it stays testable; never log or persist API keys outside the keychain; never forward provider error bodies to the UI (they can echo prompts). Run `npm test && npm run typecheck` before opening a PR.

---

## 中文说明

**Passfair：让你的 AI 们真正组成一个团队。** Claude 规划、起草，GPT 润色，Claude 审核；交给你自己的 Muse 发布，发布出错自动退回团队修改。全部在一个对话框里完成，不用你复制粘贴。跑在你的手机上，用你自己的 API Key。

- **接入**：每家 AI 一个按钮，贴 Key 即连，Key 存在手机钥匙串里，只发给对应厂商。
- **发任务**：按预设自动分工（规划 → 起草 → 润色 → 审核），最多 6 轮，每一稿每一条意见都是一条消息。
- **随时打断**：AI 干活时直接打字，按 Cut in，团队停下来按你的新指令继续。
- **交给 Muse**：用一次性配对码连接你自己的 Muse；审核通过的成品自动交给 Muse 发布，发布报错自动回来修。Meta 审核通过连接器之前，用 "Copy for Muse" 一键复制。
- **演示**：不接任何 Key 也能看完整流程，免费。

**数据**：Key 在钥匙串，草稿在手机，只有你交出去的成品经过加密中转台（7 天自动清除）。没有任何统计或广告 SDK。详见 [PRIVACY.md](PRIVACY.md)。

**上架**：用 EAS 云端打包，不需要本机装 Xcode，步骤见 [docs/STORE_SUBMISSION_ZH.md](docs/STORE_SUBMISSION_ZH.md)。

**许可**：代码 Apache-2.0 开源；Passfair 名称与 logo 为商标，不随代码授权（见 [TRADEMARKS.md](TRADEMARKS.md)）。
