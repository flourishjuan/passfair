// Brainstorm flow: Frame → Ideas (each agent through a different cross-domain lens) → Debate rounds
// (agents attack, steal from and combine each other's ideas) → Decision matrix → build + review.
// This file holds the prompts and parsing; the loop itself lives in orchestrator.runJob.
import type { Job, JobEvent } from "./orchestrator";
import { shortName } from "./providers";

export type Stage = "media" | "research" | "frame" | "ideas" | "debate" | "decision";

// Fields far from most businesses where hard problems have well-known, transferable solutions.
export const LENS_POOL = [
  "Video games & live-ops",
  "Hospital triage & operations",
  "Airline revenue management",
  "Luxury retail & clienteling",
  "Open-source communities",
  "Logistics & supply chain",
  "Insurance & risk pricing",
  "Live events & festivals",
  "Cohort-based education",
  "Restaurant franchising",
  "Payments & fintech",
  "Political campaign organising",
  "Sports scouting & leagues",
  "Dating apps & matchmaking",
  "Museums & curation",
  "Emergency dispatch",
];

export const SEAT_LETTERS = "ABCDEFGH";
export function seatName(job: Job, i: number): string {
  const p = job.panel?.[i] || "demo";
  if (p === "demo") return `Agent ${SEAT_LETTERS[i]}`;
  const base = shortName(p);
  const dup = (job.panel || []).filter((x) => x === p).length > 1;
  return dup ? `${base} ${SEAT_LETTERS[i]}` : base;
}

// Picks one lens per seat: the framer's DOMAINS line first, then the pool (stable per job, no repeats).
export function parseLenses(frameText: string, seats: number, seed: string): string[] {
  const line = frameText.split("\n").find((l) => /^\s*\**\s*DOMAINS\s*\**\s*[:：]/i.test(l)) || "";
  const fromFrame = line
    .replace(/^[^:：]*[:：]/, "")
    .split(/[;；,，|]/)
    .map((x) => x.replace(/[*_`]/g, "").trim())
    .filter((x) => x.length > 2 && x.length < 60);
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pool = [...LENS_POOL].sort((a, b) => ((h ^ (a.length * 7919)) % 97) - ((h ^ (b.length * 7919)) % 97));
  const out: string[] = [];
  for (const x of [...fromFrame, ...pool]) {
    if (out.length >= seats) break;
    if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  }
  return out;
}

const stageEvents = (job: Job, stage: Stage) => job.events.filter((e) => e.stage === stage && !e.failed);
const block = (title: string, evs: JobEvent[], job: Job) =>
  evs.length
    ? `${title}:\n${evs.map((e) => `--- ${seatName(job, e.seat ?? 0)}${e.lens ? ` (lens: ${e.lens})` : ""}${e.round ? `, round ${e.round}` : ""} ---\n${e.text}`).join("\n\n")}`
    : "";

export const BS_SYSTEM = {
  seer: `Your role: EYES of the team. You are the only agent who can see the attached files (images, PDFs, video, audio). Describe them so other agents, who cannot see them, can work from your notes: every readable text verbatim (numbers, names, prices, dates), what is shown, layout, quality problems, anything relevant to the brief. Mark what you infer as inference. Use headings per file. Do not solve the brief.`,
  researcher: `Your role: RESEARCHER. You have live web search. Collect the facts the brief depends on: market size signals, competitors and their prices, regulations, recent news, comparable cases. Every fact gets its source URL and date. Separate "verified (source)" from "unclear". End with a section "WHERE SOURCES DISAGREE": each point on which sources conflict, what each side says, with both sources — the team must treat these as uncertain, not as fact. No recommendations. 400–700 words.`,
  framer: (n: number) =>
    `Your role: FRAMER of a live brainstorm between ${n} AI agents from different vendors. Do not answer the brief. Output markdown:
## The real question — one sentence.
## What we know — facts from the brief, material and research only.
## What we don't know — each unknown with the working assumption the team will use.
## Decision criteria — numbered C1, C2 … covering EVERY requirement in the brief, each measurable.
## Cross-domain lenses — ${n} fields FAR from this industry where a structurally similar problem has been solved well; one line each on the analogous problem.
Under 300 words. End with one line exactly: DOMAINS: field 1; field 2; … (${n} fields).`,
  ideas: (seat: string, letter: string, lens: string) =>
    `Your role: PANELIST "${seat}" in a live brainstorm with other AI agents from different vendors. Your cross-domain lens: ${lens}.
Give exactly 3 options, labelled ${letter}-1, ${letter}-2, ${letter}-3. At least one must be marked "↗ BORROWED FROM ${lens.toUpperCase()}": name who in ${lens} solves an analogous problem, the exact mechanism, and how it transfers here (what changes, what breaks).
For every option: who pays or uses it · the mechanism · one number (price, size, cost, time — a labelled assumption is fine) · the first concrete step this week · the main risk.
Start with one line "TL;DR: …" naming your three options. Be bold and specific; under 350 words in total. No generic advice, no option a consultant would give any company. Do not write the other panelists' parts.`,
  debate: (seat: string, letter: string, d: number) =>
    `Your role: PANELIST "${seat}", debate round ${d} of a live brainstorm. Talk to the other panelists by name.
1. Attack — pick the two weakest-looking ideas from OTHER panelists; for each, the strongest objection and the evidence that would settle it.
2. Steal & combine — one hybrid that joins a mechanism from another panelist's idea with one of yours; label it ${letter}-H${d} and say whose idea you took.
3. Defend or drop — answer every critique of your own ideas from the previous round: upgrade it, defend it with reasoning, or drop it explicitly.
4. Ranking — your current top 3 idea ids, one line each.
Start with one line "TL;DR: …" (your current pick and the one objection that matters most). Quote nobody at length — use idea ids. Disagree where you disagree. Under 300 words.`,
  decider: `Your role: DECIDER. You have the frame, every idea and the full debate. Output markdown:
## Decision matrix — a markdown table: rows = the 3–5 strongest ideas or hybrids (by id), columns = each criterion C1… scored 1–5, then Total.
## Decision — the one option (or hybrid) to pursue, in three sentences.
## What it borrowed — the cross-domain mechanism(s) it uses and which panelist proposed them.
## Strongest dissent — the best argument against it from the debate, and why we proceed anyway.
## Risks & stop rule — measurable kill criteria with a date.
## Assumptions to verify — each with the cheapest way to verify it.
## Next 3 actions — owner-assignable, with dates relative to today.
## Acceptance criteria for the final deliverable — numbered C1, C2 … restating EVERY requirement in the original brief, for the reviewers.
Start with one line "TL;DR: …" (the decision in one sentence). Under 600 words plus the table.`,
};

export function bsPrompt(job: Job, stage: Stage, seat = 0, round = 0, head = ""): string {
  const frame = stageEvents(job, "frame")[0]?.text || "";
  const ideas = block("IDEAS FROM ALL PANELISTS", stageEvents(job, "ideas"), job);
  const debate = (upto: number) =>
    block(
      "DEBATE SO FAR",
      stageEvents(job, "debate").filter((e) => (e.round || 0) <= upto),
      job,
    );
  const user = [...job.events].reverse().find((e) => e.role === "feedback" && e.source === "you");
  const steer = user ? `\n\nUSER INSTRUCTION (takes priority):\n${user.text}` : "";
  if (stage === "media" || stage === "research" || stage === "frame") return `${head}${steer}`;
  if (stage === "ideas")
    return `${head}${steer}\n\nFRAME:\n${frame}\n\nYour lens: ${job.lenses?.[seat]}. Give your 3 options now.`;
  if (stage === "debate")
    return `${head}${steer}\n\nFRAME:\n${frame}\n\n${ideas}\n\n${round > 1 ? debate(round - 1) + "\n\n" : ""}Debate round ${round} — your turn.`;
  return `${head}${steer}\n\nFRAME:\n${frame}\n\n${ideas}\n\n${debate(99)}\n\nDecide now.`;
}

/* ---------- scripted sample (demo) ---------- */
export const DEMO_BRAINSTORM_BRIEF =
  "A small online bakery sells 40 orders a week. Find one way to get its first 100 repeat customers in 60 days with no ad budget.";

const D_FRAME = `DEMO · scripted sample — no AI was called

## The real question
How does a 40-orders-a-week bakery turn one-off buyers into 100 people who order again within 60 days, without paying for ads?

## What we know
- 40 orders a week, online only. No ad budget. 60 days.

## What we don't know
- Repeat rate today → assume 15%.
- Delivery radius → assume one city.

## Decision criteria
C1. Produces at least 100 repeat customers in 60 days (show the arithmetic).
C2. Costs under $300 in total.
C3. Runs in under 5 hours a week.
C4. Names the first step for this week.

## Cross-domain lenses
- Video games & live-ops — daily streaks make people come back.
- Airline revenue management — fill empty capacity by selling it differently.

DOMAINS: Video games & live-ops; Airline revenue management`;

const D_IDEAS = [
  `A-1 · Loaf subscription "Friday Box" — $24/week, first box half price. Step: email the last 160 buyers. Risk: churn after week 3.
A-2 · Neighbour referral card in every box — both get a free croissant. Number: 1 in 8 boxes converts (assumption). Risk: weak at 40 orders.
↗ A-3 · BORROWED FROM VIDEO GAMES & LIVE-OPS — Live-ops teams run weekly "seasons" with a visible streak. Transfer: a 6-week "Bread Season" card; order 4 of 6 weeks and week 6 is free. Changes: physical stamp card + SMS reminder Thursday 6 pm. Number: $6 free bake per finisher. Risk: people forget — the reminder does the work.`,
  `B-1 · Pre-order window "Thursday drop" — menu opens Wed 8 pm, closes Thu noon. Scarcity drives return visits. Risk: alienates impulse buyers.
↗ B-2 · BORROWED FROM AIRLINE REVENUE MANAGEMENT — airlines sell the last seats cheap to fill the plane. Transfer: sell Saturday's unsold capacity on Friday as a $9 "surprise bag" to past buyers only. Number: 12 bags a week. Risk: trains people to wait for discounts.
B-3 · Office drop — one office, 20 people, Friday pastries. Step: ask 3 existing customers where they work. Risk: one-client dependency.`,
];
const D_DEBATE = [
  `Agent B, your B-2 surprise bag trains discount-waiting — airlines fence it with conditions; you didn't. Evidence that settles it: does full-price repeat drop in week 3?
Agent B, B-3 needs one decision-maker — 60 days is short for that.
Steal & combine → A-H1: my Bread Season streak (A-3) where the reward is your surprise bag (B-2) instead of a free loaf — costs us unsold stock, not margin.
Ranking: A-H1, A-3, B-1.`,
  `Agent A, A-1 at $24 is a price jump for people who bought once — expect <5% uptake.
Agent A, A-2 referral math: 40 orders × 1/8 = 5 a week, 40 in 60 days — not enough alone.
Steal & combine → B-H1: your streak card, but the season opens with my Thursday pre-order window, so the reminder has a deadline.
Ranking: A-H1, B-H1, B-1.`,
];
const D_DECISION = `## Decision matrix
| Idea | C1 reach | C2 cost | C3 time | C4 start | Total |
|---|---|---|---|---|---|
| A-H1 streak + surprise-bag reward | 4 | 5 | 4 | 5 | 18 |
| B-H1 streak + Thursday window | 4 | 5 | 3 | 4 | 16 |
| A-1 Friday Box | 2 | 5 | 4 | 4 | 15 |

## Decision
Run a 6-week "Bread Season": every buyer gets a streak card; order 4 of 6 weeks and the reward is a surprise bag made from unsold stock. A Thursday 6 pm SMS reminds everyone with a live streak.

## What it borrowed
Weekly seasons and streaks from video-game live-ops (Agent A); selling spare capacity from airline revenue management (Agent B).

## Strongest dissent
Surprise bags could train discount-waiting (Agent A's own objection). We proceed because the bag is earned, never sold.

## Risks & stop rule
Stop if fewer than 25 people hold a 2-week streak by day 21.

## Assumptions to verify
- 15% repeat today → count from last month's orders (10 minutes).

## Next 3 actions
1. Print 200 cards — today.
2. Text the last 160 buyers — this week.
3. Count streaks every Monday.

## Acceptance criteria for the final deliverable
C1. Shows the arithmetic to 100 repeat customers.
C2. Total cost under $300.
C3. Under 5 hours a week.
C4. First step this week.`;
const D_PLAN_DRAFT = `# Bread Season — 6-week repeat plan

**The math (C1):** 40 orders/week × 6 weeks ≈ 240 buyers; 160 past buyers texted on day 1. If 45% start a streak and 60% of those reach week 4: 400 × 0.45 × 0.6 ≈ 108 repeat customers by day 42.

**Cost (C2):** 200 cards $40 · SMS $35 · surprise bags from unsold stock ~$0 cash · total ≈ $75.

**Time (C3):** 2 h setup, then ~1.5 h a week (stamping, Thursday SMS, Monday count).

**This week (C4):** print cards today; text the 160 past buyers Thursday 6 pm.

**Stop rule:** fewer than 25 two-week streaks by day 21 → switch to the Thursday pre-order window.`;

export function demoBrainstorm(job: Job, stage: Stage, seat: number, round: number): string {
  if (stage === "frame") return D_FRAME;
  if (stage === "ideas") return D_IDEAS[seat % 2];
  if (stage === "debate")
    return D_DEBATE[seat % 2] + (round > 1 ? `\n(Round ${round}: positions hold; both rank A-H1 first.)` : "");
  if (stage === "decision") return D_DECISION;
  return "";
}
export const DEMO_BS_DRAFT = D_PLAN_DRAFT;
