# Changelog

## 2.0.0 — hotfix 8 (invite friends, free trial, new layout)
- Invite friends: the gift at the top right opens your invite code, a share button, progress and your rewards. Every 3 friends who enter your code **and finish their first real brief** earn you one free month of Pro, delivered as an App Store offer code / Google Play promo code (up to 12 a year). Downloads, ratings and samples never count. No cash rewards.
- Invite links (`https://challenge.agentsfair.ai/passfair/i/CODE`, `passfair://invite?code=CODE`) open the app with the code filled in; friends can also type it. The share text says the sender may get a free month.
- Free trial: when the store offers new subscribers a free trial (set up as a 1-month introductory offer / free-trial phase), the Pro page shows it — "1 month free, then $9.99/month" — and Google Play purchases use the trial offer. Prices are unchanged and always read from the store.
- Layout: top right is only the invite gift; new brief (✎) moved to the bottom left next to the input; history moved into the ••• page (running brief first, "See all" for the full list); the sample run moved from the home screen to ••• → About → "Watch a sample run".
- Needs the Passfair invite service (separate package) on challenge.agentsfair.ai. Privacy policy updated for the invite data.

## 2.0.0 — hotfix 7 (Android)
- Google Play subscriptions: the purchase now passes the base-plan offer token Play Billing requires; "Manage subscription" opens Google Play's page for Passfair.
- Photos and videos use Android's system Photo Picker, so the app no longer declares broad media/storage permissions (READ_MEDIA_*, READ/WRITE_EXTERNAL_STORAGE) or SYSTEM_ALERT_WINDOW — Play policy asks apps that only pick files to use the Photo Picker.
- Keyboard no longer covers the composer; the composer clears Android's navigation bar (edge-to-edge); code uses Android's monospace font.
- Store-neutral payment wording (Google Play on Android, Apple ID on iOS).
- Report AI-generated content in the app (each message and the final result) — required by Google Play's AI-generated content policy, available on iOS too.

## 2.0.0 — hotfix 6 (token saver)
- Depth: Quick / Standard (default) / Deep, in Team and as a chip next to the input. Measured on the same task (2 agents, ~3,000 words of material, one rejected round): Standard uses 43% fewer tokens and ~62% lower cost than before, in 9 waiting steps instead of 13; Quick 53% fewer tokens in 8 steps; Deep keeps the full process at ~28% lower cost through caching.
- Prompt caching: every call of a job opens with the same system text and the same brief + material, then the role. Claude gets an explicit cache marker; OpenAI, Gemini and DeepSeek cache the identical opening automatically. The result shows how much input came from cache.
- Revisions send only the sections that change ("## " headings) and Passfair merges them; the second reviewer checks only drafts the first one passed; no full-text polish pass outside Deep.
- Agents start ideas and debate turns with a one-line TL;DR (shown folded), never restate the brief or each other (they cite ids), and have tighter word limits.
- Fix: a targeted fix to one section of a long draft was mistaken for "unchanged" and caused extra rounds.

## 2.0.0 — hotfix 5
- The screen stays on while agents work (expo-keep-awake, pinned to the SDK version): a locked iPhone pauses the app and used to stop the run mid-way.
- Resume works reliably: the screen knows when a run is active, and resuming a job stops any other run first instead of "Wait for the current job".
- A stopped job explains why (closed / locked / you stopped it) and what Resume will do next.
- Download works before the draft exists: you get the decision ("Download decision"), and the message says what to do when there is nothing yet. Not a plan limit — PDF and Markdown are free.

## 2.0.0 — hotfix 4
- Every agent is sized from a per-model profile (how much it can read, how long it can write, whether it thinks first) instead of one number for everyone: drafts get 8k tokens, reviews and ideas 3k, thinking models double with at least 6k, never above what the model allows. The connect form shows each model's limits.
- Long discussions are condensed automatically for short-memory models (keeping the brief and the latest turn), and the feed says when that happened.
- Agents sharing one key (e.g. several OpenRouter agents) take turns instead of hitting the account at once; the vendor's Retry-After is respected on rate limits.
- Kimi now defaults to Kimi K2 (the 32k model was too short for debates).

## 2.0.0 — hotfix 3
- Reasoning models (GPT-5, GPT-5 mini, o4-mini, Gemini 2.5, Grok 4, DeepSeek reasoner) no longer fail with "returned no text": they get room to think (at least 4,000 output tokens, low reasoning effort on OpenAI), and an answer that comes back empty after thinking is retried once with three times the budget. Connecting such a model works again.
- If the cross-checker fails mid-job, the job continues with one reviewer and says so, instead of stopping after one round.
- The connect form shows its key and model fields (they were the same grey as the form) and the "Paste copied key" button promised in hotfix 2 is really there now.

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
