# Changelog

## 2.0.0 — hotfix (build after 22)
- Fix launch crash on iOS: expo-print 58.0.8 required a newer ExpoModulesJSI than the app ships ("Symbol not found" at launch). All native modules are now pinned to exactly the versions this Expo SDK was tested with, and a test fails the build if any drifts.
- Keychain-safe names for custom and OpenRouter agents (ids with ":" could not be saved).
- Unexpected errors show on screen with "Copy error" instead of closing the app.
- The clipboard is read only when you tap "Paste copied key" (no surprise paste prompts).
- Type: one regular weight everywhere (no bold UI text); hierarchy by size and grey.
- Text files decode even where TextDecoder is missing; stable list keys in the feed; a reminder to keep the app open while agents work.

## 2.0.0 — 2026-11-03
1.2.0 was never released; everything in it ships here.

**Brainstorm, the new default**
- Frame → Ideas → Debate → Decision → Build. The framer turns the brief into measurable criteria and picks one distant industry per agent; every agent proposes three options through its own industry's lens (at least one "↗ borrowed" mechanism); then the agents debate each other by name for 1–4 rounds — attack, steal & combine, defend or drop — and a decider scores the strongest options in a decision matrix with dissent, stop rule and next actions. Only then does the team write and cross-check the deliverable.
- Agents in the same stage run at the same time; one agent failing does not stop the others.
- Long answers are no longer cut off: Passfair detects a cut-off and asks the agent to continue, then stitches the parts (up to 3 times for drafts). Output limit raised from 2,500 to 8,000 tokens per call.

**Agents**
- New: Grok (xAI), DeepSeek, Llama (Meta), Perplexity (live web), Mistral, Qwen, Kimi, Groq, OpenRouter — alongside Claude, GPT and Gemini.
- Sign in with OpenRouter: one login in the browser, no key to copy; adds Claude, GPT, Grok, Gemini, DeepSeek and Llama.
- A key copied from a vendor's page is recognised: "Use the key you just copied".
- Custom agents (Pro): any OpenAI- or Anthropic-compatible endpoint, your own name and brand.
- Cursor has no public model API; the app says so and points to the same models directly.

**Files, photos, video, links**
- Attach photos, videos, camera shots, files, web links or the clipboard. Text, CSV, JSON, Markdown and Word / Excel / PowerPoint are read on the phone; images, PDFs, video and audio are read by an agent that can see them (Claude / GPT: images and PDF; Gemini: also video and audio), whose notes go to the whole team.
- Live web research stage (Pro): Perplexity, or Claude / GPT / Gemini web search, collects facts with sources first.
- Download: PDF, Word, PowerPoint, Markdown and the full record of the conversation.

**Interface**
- Muse-style layout: ••• menu at the top left holds agents and settings; animated logo in the centre (spins while agents work — tap it to see who is doing what); history and new brief at the top right; the old top banner is gone.
- Full-width output with rendered headings, lists and tables, grouped by stage; long parts fold; full-screen reader for the final. Borderless buttons, system typography.

**Passfair Pro (App Store subscription)**
- Free: 2 agents, 2 debate rounds, 4 review rounds, text files and 2 images, PDF/Markdown download. Pro: 6 agents, 4 debate rounds, 8 review rounds, live research, custom agents, PDF/Office/video uploads, Word/PowerPoint/full-record download. Pro features stay visible in the free app with 🔒 and unlock as soon as the App Store confirms the purchase. Restore purchases is in the ••• menu.

## 1.2.0 — 2026-11-02 (unreleased, included in 2.0.0)
- Cross-check: with two or more AI vendors connected, every round is reviewed by a Reviewer and a Cross-checker from a different vendor (e.g. Claude and GPT check each other). A round passes only when both pass.
- Fixed verification rounds: the team always runs at least N rounds (Team → "Cross-check rounds", default 2), then stops as soon as both reviewers approve, up to the max-rounds limit.
- Best-round final: the final version is the best-reviewed round since the last outside feedback, so a later round cannot quietly make the work worse.
- Regression check: reviewers get the issues raised in earlier rounds and must confirm they stay fixed.
- Muse hand-off "When both reviewers approve" only fires on a double approval; otherwise the result waits for you.
- Quality: the Planner lists every requirement as numbered criteria (C1, C2 …); reviewers must check each one with a quoted piece of evidence, and an unchecked or evidence-free criterion is not a pass.
- Quality: an automatic check (no AI) blocks approval of placeholder text ("Point A", "TBD", "[insert …]"), answers far too thin for the brief, and revisions that leave a rejected draft essentially unchanged.
- Quality: revisions must answer every numbered issue in revision notes ("What changed in this draft"); reviewers verify the notes against the text. Reviewers also list the assumptions that remain unverified, shown under the final result together with AI calls, tokens and models used.
- Honesty: Send no longer falls back to the scripted demo when no AI is connected — it asks you to connect one. The demo only plays a fixed sample brief, is labelled "DEMO · scripted sample", is never marked approved, and cannot be exported or handed to Muse. Muse orders wait until an AI is connected.
- Export ▾ on a finished job: PDF, Word (.docx), PowerPoint (.pptx) or Markdown through the share sheet. Converted on the phone; no model call, nothing uploaded. (Replaces the unreleased 1.1.0 export build.)

## 1.0.0 — 2026-10-27
- First release: chat-first team loop (Planner → Worker → Polisher → Reviewer), cut-in, demo mode.
- Claude / GPT / Gemini via your own API keys, stored in the device keychain.
- Muse hand-off through the Agents Fair Handoff Relay; publishing problems re-open the job.
- Apache-2.0 source; Passfair name and logo reserved as trademarks.
