# Passfair privacy policy

_Last updated: 2026-10-27. This page is the privacy policy for the Passfair iOS and Android apps. Host it at a public URL (for example `https://challenge.agentsfair.ai/passfair/privacy`) and enter that URL in App Store Connect and Google Play Console._

## The short version

Passfair runs on your phone. It has no account system and no server of its own for your content.

- **Your API keys** are stored in your device's keychain (iOS Keychain / Android Keystore via `expo-secure-store`) and are sent only to the provider they belong to (Anthropic, OpenAI or Google) when you run a live job. They are never sent to Agents Fair.
- **Your briefs, drafts and reviews** are stored on your device. When you run a live job they are sent to the providers you connected, under those providers' own terms. In demo mode nothing leaves the phone.
- **Hand-off to Muse** is optional. Only when you pair your own Muse account and hand a job off, the finished deliverable (title and text) is sent through the Agents Fair Handoff Relay so your Muse can collect it. The relay stores it encrypted for at most 7 days and never reads or executes it.
- **No analytics, no advertising SDKs, no tracking.** The app contains no third-party analytics or crash-reporting code.

## What the app collects

| Data | Where it goes | Why |
|---|---|---|
| API keys you paste | Device keychain only; sent to that provider's API on each request | To call the model you chose |
| Briefs, material, drafts, reviews | Device storage; sent to your connected providers during live runs | That is the product |
| Relay pairing token and code | Device storage; used to talk to the Handoff Relay | To let your Muse collect finished work |
| Deliverables you hand off | Handoff Relay (encrypted at rest, ≤ 7 days) | To deliver to your Muse |

The app does not collect your name, email, contacts, location, photos, advertising identifiers or device identifiers.

## Third parties

When you run a live job, your content is processed by the providers you connected under their own privacy terms:

- Anthropic — https://www.anthropic.com/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Google AI Studio / Gemini API — https://ai.google.dev/gemini-api/terms

Muse is a product of Meta Platforms, Inc.; its handling of what you publish is governed by Meta's terms.

## Your choices

- Disconnect any provider at any time from the Connect bar; the key is deleted from the keychain.
- Delete any conversation from the app; it is removed from the device.
- Unpair Muse from the Muse panel; the relay token is deleted and pending deliverables expire within 7 days.
- Uninstalling the app removes all local data.

## Children

Passfair is not directed at children under 13 and does not knowingly collect information from them.

## Changes

Changes to this policy are published in this repository and at the hosted URL, with the date above updated.

## Contact

Open an issue in the Passfair repository or write to the contact address on https://agentsfair.ai.
