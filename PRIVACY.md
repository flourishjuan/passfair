# Passfair privacy policy

_Last updated: 2026-11-04. This page is the privacy policy for the Passfair iOS and Android apps. Host it at a public URL (for example `https://challenge.agentsfair.ai/passfair/privacy`) and enter that URL in App Store Connect and Google Play Console._

## The short version

Passfair runs on your phone. It has no account system and no server of its own for your content. The only Agents Fair servers it talks to are the optional invite programme and the optional Muse hand-off, described below.

- **Your API keys** are stored in your device's keychain (iOS Keychain / Android Keystore via `expo-secure-store`) and are sent only to the provider they belong to (for example Anthropic, OpenAI, Google, xAI, OpenRouter, or a custom endpoint you entered) when you run a live job. They are never sent to Agents Fair.
- **Sign in with OpenRouter** opens OpenRouter's own login page in the system browser. OpenRouter returns an API key to the app, which is stored in the keychain like any other key. Agents Fair never sees your OpenRouter login.
- **Files, photos, videos and links you attach** are read on your device. Text is sent to the agents on your team; images, PDFs, video and audio are sent only to the one connected agent that can read them, and its written notes are shared with the team. Photo-library, camera and microphone access are used only when you tap to attach something.
- **Passfair Pro** is sold through the App Store (iOS) and Google Play (Android), including any free trial they offer. Apple or Google processes the payment; the app checks your subscription on the device. Agents Fair receives no payment or account details from the app.
- **Your briefs, drafts and reviews** are stored on your device. When you run a live job they are sent to the providers you connected, under those providers' own terms. In demo mode nothing leaves the phone.
- **Hand-off to Muse** is optional. Only when you pair your own Muse account and hand a job off, the finished deliverable (title and text) is sent through the Agents Fair Handoff Relay so your Muse can collect it. The relay stores it encrypted for at most 7 days and never reads or executes it.
- **Invite friends** (optional). To give you an invite code and count friends who join, the app registers a random install id (created on the phone, not a device or advertising identifier) with the Agents Fair invite server, together with your platform (iOS/Android). The server keeps a one-way hash of that id, your invite code, which invite code you entered, and whether you finished your first brief (yes/no only — never its content). Free-month rewards are App Store / Google Play promotional codes shown to you in the app. There are no cash rewards, and the invite programme never asks for your name, email or payment details.
- **Reporting AI-generated content**: when you tap Report, the app prepares the report on your phone and you choose how to send it. It is not sent anywhere automatically.
- **No analytics, no advertising SDKs, no tracking.** The app contains no third-party analytics or crash-reporting code.

## What the app collects

| Data | Where it goes | Why |
|---|---|---|
| API keys you paste | Device keychain only; sent to that provider's API on each request | To call the model you chose |
| Briefs, material, drafts, reviews | Device storage; sent to your connected providers during live runs | That is the product |
| Files, photos, videos, links you attach | Read on the device; sent to your connected providers during live runs (binary files only to an agent that can read them) | So the agents can use them |
| Pro subscription status | Checked with the App Store or Google Play on the device | To unlock Pro features |
| Relay pairing token and code | Device storage; used to talk to the Handoff Relay | To let your Muse collect finished work |
| Deliverables you hand off | Handoff Relay (encrypted at rest, ≤ 7 days) | To deliver to your Muse |
| Random install id (hashed on the server), platform, invite code, code you entered, "first brief finished" yes/no | Agents Fair invite server | To run the invite programme and prevent duplicate rewards |

The app does not collect your name, email, contacts, location, advertising identifiers or device identifiers. Photos and files are used only when you attach them and are not sent to Agents Fair.

## Third parties

When you run a live job, your content is processed by the providers you connected under their own privacy terms:

- Anthropic — https://www.anthropic.com/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Google AI Studio / Gemini API — https://ai.google.dev/gemini-api/terms
- xAI, DeepSeek, Meta (Llama API), Perplexity, Mistral, Alibaba Cloud (Qwen), Moonshot (Kimi), Groq, OpenRouter, or any custom endpoint you add — under each provider's own privacy terms

Muse is a product of Meta Platforms, Inc.; its handling of what you publish is governed by Meta's terms.

## Your choices

- Disconnect any provider at any time from the ••• menu; the key is deleted from the keychain.
- Delete any conversation from the app; it is removed from the device.
- Unpair Muse from the Muse panel; the relay token is deleted and pending deliverables expire within 7 days.
- Uninstalling the app removes all local data. To delete your invite record from the invite server, contact us (below) with your invite code.
- You never have to use the invite programme; the app works the same without it.

## Children

Passfair is not directed at children under 13 and does not knowingly collect information from them.

## Changes

Changes to this policy are published in this repository and at the hosted URL, with the date above updated.

## Contact

Open an issue in the Passfair repository or write to the contact address on https://agentsfair.ai.
