# Changelog

## 1.2.0 — 2026-11-02
- Cross-check: with two or more AI vendors connected, every round is reviewed by a Reviewer and a Cross-checker from a different vendor (e.g. Claude and GPT check each other). A round passes only when both pass.
- Fixed verification rounds: the team always runs at least N rounds (Team → "Cross-check rounds", default 2), then stops as soon as both reviewers approve, up to the max-rounds limit.
- Best-round final: the final version is the best-reviewed round since the last outside feedback, so a later round cannot quietly make the work worse.
- Regression check: reviewers get the issues raised in earlier rounds and must confirm they stay fixed.
- Muse hand-off "When both reviewers approve" only fires on a double approval; otherwise the result waits for you.
- Export ▾ on a finished job: PDF, Word (.docx), PowerPoint (.pptx) or Markdown through the share sheet. Converted on the phone; no model call, nothing uploaded. (Replaces the unreleased 1.1.0 export build.)

## 1.0.0 — 2026-10-27
- First release: chat-first team loop (Planner → Worker → Polisher → Reviewer), cut-in, demo mode.
- Claude / GPT / Gemini via your own API keys, stored in the device keychain.
- Muse hand-off through the Agents Fair Handoff Relay; publishing problems re-open the job.
- Apache-2.0 source; Passfair name and logo reserved as trademarks.
