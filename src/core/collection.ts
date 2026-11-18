// "Collection" — each AI vendor answers on its own, under its own name, side by side. Nobody rewrites anybody.
//   1. Scope: the user's hard constraints (market, count, budget, currency, language) are pinned for every step,
//      and a broad question first gets a few short directions to choose from.
//   2. Answers: every connected agent writes its own answer at the same time, one screen per segment
//      ("Continue" for the next). A list of N items gets all N, from every agent.
//   3. A follow-up question is answered together: agents reply in turn, each reading the others first.
//   4. "Debate": on request, agents argue the topic for two rounds, then stop.
// The user only ever sees the agents' own words — no internal ids, revision notes or round numbers.
import { detectLanguage, languageFor, languageRule } from "./language";
import type { Job, JobEvent, LiveTurn, RunDeps } from "./orchestrator";
import { BS_SYSTEM } from "./brainstorm";
import { complete, getProvider, type ProviderId, type Usage } from "./providers";

export interface Constraints {
  market?: string;
  currency?: string;
  count?: number;
  budget?: string;
  other?: string[];
}
export interface Direction {
  title: string;
  line: string;
}
export interface CollectionState {
  constraints: Constraints;
  scoped: boolean;
  directions?: Direction[];
  choice?: string | null;
  segSize: number;
  /** Segments planned (lists) — open answers grow one screen at a time while the user asks for more. */
  total: number;
  /** Segments every agent has finished. */
  done: number;
  debated?: number;
}

export const SEG_ITEMS = 10; // list items per screen
const SCREEN = "about one phone screen (≈250 words, ≈450 characters in Chinese or Japanese)";
// Build briefs are exempt from the one-screen limit: the deliverable must arrive complete.
const lengthRule = (build: boolean) =>
  build
    ? "This asks for something made: deliver it COMPLETE — full working code (every file in its own fenced block, file name on the fence line or in the first line as a comment) or the full document/design — however long it needs to be. Do not cut it short or split it across screens."
    : `Keep this part to ${SCREEN}; the user can ask for more.`;

/** Notes the seeing agent wrote about the attached files, for prompts of agents that cannot see them. */
export function mediaNotes(job: Job): string {
  return job.events.find((e) => e.role === "seer" && !e.failed)?.text || "";
}
const notesPart = (job: Job) => {
  const n = mediaNotes(job);
  return n ? `NOTES ON THE ATTACHED FILES (written by ${job.events.find((e) => e.role === "seer" && !e.failed)?.model || "the seeing agent"}, the agent that could see them — work from these; you cannot see the files yourself):\n${n.slice(0, 8000)}` : "";
};

/* ---------- hard constraints, read from the user's own words ---------- */

const MARKETS: [RegExp, string, string][] = [
  [
    /北美|北米|north[\s-]*america|nord[\s-]*am[ée]ric|am[ée]rique du nord|norte?[\s-]*am[ée]ric|norteam[ée]ric|nordamerika|[ée]tats[\s-]*unis|estados unidos|米国|アメリカ|カナダ|美国|美國|\bU\.?S\.?A?\b|united states|加拿大|canada|\bamerican?\b/i,
    "North America (United States and Canada)",
    "USD ($)",
  ],
  [/欧洲|歐洲|europe|\bEU\b/i, "Europe", "EUR (€)"],
  [/英国|英國|\bU\.?K\.?\b|united kingdom|britain/i, "United Kingdom", "GBP (£)"],
  [/日本|japan/i, "Japan", "JPY (¥)"],
  [/澳洲|澳大利亚|australia/i, "Australia", "AUD (A$)"],
  [/中国大陆|中國大陸|国内市场|中国市场|china|中国|中國/i, "China", "CNY (¥)"],
];
const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
};
function cnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "百" || s === "一百") return 100;
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  const h = s.match(/^([一二两三四五六七八九])百$/);
  if (h) return CN_NUM[h[1]] * 100;
  return CN_NUM[s] ?? null;
}

/** What the user literally asked for: market, currency, how many, budget. The user's words always win. */
export function readConstraints(text: string): Constraints {
  const t = String(text || "");
  const c: Constraints = {};
  // The first market named wins ("北美市场，不要中国平台" is North America).
  let first = -1;
  for (const [re, market, currency] of MARKETS) {
    const i = t.search(re);
    if (i >= 0 && (first < 0 || i < first)) {
      first = i;
      c.market = market;
      c.currency = currency;
    }
  }
  if (/美元|\bUSD\b|US\$/i.test(t)) c.currency = "USD ($)";
  else if (/人民币|人民幣|\bRMB\b|\bCNY\b/i.test(t)) c.currency = "CNY (¥)";
  else if (/欧元|\bEUR\b|€/.test(t)) c.currency = "EUR (€)";
  const n =
    t.match(/(\d{1,4}|[一二两三四五六七八九十百]{1,3})\s*(?:个|個|件|つ|條|条|款|种|種|家|项|項|则|則|篇|份)/) ||
    t.match(
      /\b(\d{1,4})\s+(?:[a-z-]+\s+){0,3}(?:items?|ideas?|projects?|businesses|business ideas|options|examples|names|products|startups|companies|tools|ways|tips|projets|id[ée]es|entreprises|activit[ée]s|proyectos|negocios|ideen|projekte)/i,
    ) ||
    t.match(/\b(?:top|list(?: of)?|give me)\s+(\d{1,4})\b/i);
  if (n) {
    const v = cnNumber(n[1]);
    if (v && v >= 2 && v <= 500) c.count = v;
  }
  const b =
    t.match(
      /(?:投资|投資|预算|預算|资金|資金|成本|启动资金|啟動資金)[^\d一二三四五六七八九十]{0,6}([\d.,]+\s*(?:万|萬|千|k|K|m|M|百万|million)?)\s*(美元|美金|元|刀|USD|\$)?\s*(?:以下|以内|以內|之内|内|左右|上下)?/,
    ) ||
    t.match(/([\d.,]+\s*(?:万|萬|千|k|K)?)\s*(美元|美金|ドル|円|元|USD)?\s*(?:以下|以内|以內|未満)/) ||
    t.match(
      /(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?|moins de|jusqu'à|menos de|hasta|unter|bis zu)\s*\$?\s*(\d(?:[\d.,\s\u202f\u00a0]*\d)?\s*(?:k|K|m|M|million)?)/i,
    );
  if (b) {
    const raw = b[1].replace(/[,\s\u202f\u00a0]/g, "");
    let v = parseFloat(raw);
    if (/万|萬/.test(raw)) v *= 10000;
    else if (/千/.test(raw)) v *= 1000;
    else if (/k$/i.test(raw)) v *= 1000;
    else if (/百万|m$|million/i.test(raw)) v *= 1000000;
    const cur =
      (b[2] && /元/.test(b[2]) && !/美/.test(b[2]) ? "CNY (¥)" : null) ||
      (b[2] && /円/.test(b[2]) ? "JPY (¥)" : null) ||
      (b[2] && /ドル/.test(b[2]) ? "USD ($)" : null) ||
      c.currency ||
      "USD ($)";
    const sym = cur.match(/\((.+)\)/)?.[1] || "$";
    if (Number.isFinite(v) && v > 0)
      c.budget = `under ${sym}${Math.round(v).toLocaleString("en-US")} per item, in ${cur}`;
  }
  return c;
}

// Platforms and money that give away the wrong market.
const CHINA_ONLY =
  /淘宝|淘寶|天猫|天貓|京东|京東|拼多多|抖音|小红书|小紅書|微信|美团|美團|闲鱼|閒魚|快手|饿了么|支付宝|支付寶|B站|哔哩哔哩|知乎|1688|\bTaobao\b|\bTmall\b|\bJD\.com\b|\bPinduoduo\b|\bDouyin\b|\bXiaohongshu\b|\bWeChat\b|\bMeituan\b|\bAlipay\b|\bKuaishou\b|\bRED app\b/i;
const CNY = /人民币|人民幣|\bRMB\b|\bCNY\b|￥|¥\s?\d|\d\s?元(?!素)/;

/** The constraints every agent is held to, word for word. */
export function constraintBlock(c: Constraints, choice?: string | null): string {
  const lines: string[] = [];
  if (c.market) {
    lines.push(
      `Market: ${c.market}. Every example, platform, regulation, price, statistic and source must be for this market.`,
    );
    if (/North America/.test(c.market))
      lines.push(
        "Do not use Chinese platforms (Taobao, Tmall, JD, Pinduoduo, Douyin, Xiaohongshu, WeChat, Meituan …) or Chinese market data.",
      );
  }
  if (c.currency) lines.push(`Currency: ${c.currency} for every amount — never another currency.`);
  if (c.count) lines.push(`Quantity: exactly ${c.count} items in total — never fewer.`);
  if (c.budget) lines.push(`Budget: ${c.budget}.`);
  for (const o of c.other || []) lines.push(o);
  if (choice) lines.push(`Direction the user chose: ${choice}.`);
  return lines.length
    ? `HARD CONSTRAINTS (the user's own requirements — follow them exactly, in every part; never drop or swap them):\n- ${lines.join("\n- ")}`
    : "";
}

/** Breaks of the hard constraints in an answer (empty = fine). */
/** The answer is not in the user's language (e.g. English when the user wrote Chinese). */
export function wrongLanguage(text: string, lang?: string | null): string | null {
  if (!lang) return null;
  const body = String(text)
    .replace(/\*\*[^*]{1,80}\*\*/g, " ")
    .replace(/https?:\/\/\S+/g, " "); // names may stay as they are
  const cjk = (body.match(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  const latin = (body.match(/[A-Za-z]/g) || []).length;
  const wantsCjk = /Chinese|Japanese|Korean/.test(lang);
  if (wantsCjk && cjk < 0.3 * (cjk + latin / 2))
    return `It is not written in ${lang}. Rewrite it all in ${lang}; product and brand names may stay as they are.`;
  if (!wantsCjk && cjk > latin / 2 && cjk > 20) return `It is not written in ${lang}. Rewrite it all in ${lang}.`;
  // Latin-script languages (French, Spanish, German …): only when the answer is clearly another language.
  const seen = !wantsCjk ? detectLanguage(body) : null;
  if (seen && seen !== lang && !/Chinese|Japanese|Korean/.test(seen) && latin > 200)
    return `It is written in ${seen}, not ${lang}. Rewrite it all in ${lang}; product and brand names may stay as they are.`;
  return null;
}

export function constraintProblems(
  text: string,
  c: Constraints,
  range?: { from: number; to: number },
  lang?: string | null,
): string[] {
  const out: string[] = [];
  const lw = wrongLanguage(text, lang);
  if (lw) out.push(lw);
  if (c.market && /North America/.test(c.market)) {
    const p = text.match(CHINA_ONLY);
    if (p) out.push(`It mentions "${p[0]}", a platform outside North America.`);
    if (!/CNY/.test(c.currency || "") && CNY.test(text)) out.push("It gives amounts in Chinese yuan; use US dollars.");
  }
  if (range) {
    const want = range.to - range.from + 1;
    const got = numbered(text).filter((n) => n >= range.from && n <= range.to).length;
    if (got < want) out.push(`It has ${got} of the ${want} items numbered ${range.from}–${range.to}.`);
  }
  return out;
}

// Numbers of the numbered list items in a text ("12." / "12)" / "**12.**" at the start of a line).
export function numbered(text: string): number[] {
  return [...String(text).matchAll(/^\s*(?:[-*]\s*)?(?:\*\*)?(\d{1,4})[.)、]/gm)].map((m) => Number(m[1]));
}

/* ---------- prompts ---------- */

const SOLO = `You are one of several independent AI experts. Each expert answers the user separately and the user compares the answers side by side, so give YOUR OWN best answer, in your own voice. Never mention other experts, the app, internal ids, drafts, rounds or reviews.
Answer the question directly and concretely. Every number states its basis (a source, or "estimate:" with a one-line reason). No filler, no self-praise, no scores like "10/10".
You CAN write complete, working code, documents and designs. When the question asks for something made (software, a demo, a game, a website, a tool, a document), your answer IS that deliverable: complete and ready to use, not advice about making it. Code ships as full files, each in its own fenced code block with the file name on the fence line (\`\`\`index.html) or in the first line as a comment, plus the exact commands to run it. Never give up on making the deliverable or redirect the user to hiring developers, buying services or using other tools instead of answering. Where a detail is missing, state a one-line assumption and deliver anyway. Two honest exceptions, stated in one line each: (1) what a text answer genuinely cannot do — it cannot run, compile or install anything on the user's device, so say what must be run and by whom — and (2) anything you would decline anywhere for safety or policy reasons: keep declining it and say why. Everything that CAN be delivered as text must be delivered, in full.`;

// A brief that asks for something buildable gets the full deliverable, not a one-screen teaser.
export function wantsBuild(text: string): boolean {
  return /\b(demo|prototype|app(lication)?|website|web\s?page|game|tool|script|plugin|mini-?program|code|software)\b/i.test(
    String(text || ""),
  ) || /演示|样例|原型|游戏|软件|网站|网页|工具|脚本|插件|小程序|应用|程序|代码|开发(一|个|款)?/.test(String(text || ""));
}

// An answer that declines to build and redirects elsewhere (hire a developer, buy a service) instead of
// delivering — the failure Juan reported. Only flagged on a build brief that got no code at all.
const REFUSAL = [
  /无法(直接)?(为你|为您|帮你|帮您)?(实际)?(提供|生成|编写|撰写|构建|制作|开发|交付|输出)[^。\n]{0,40}(代码|程序|软件|应用|游戏|文件|安装包|可执行|demo)/i,
  /(不能|无法)(为你|为您|帮您)?(写|编写|生成|构建|开发|制作)[^。\n]{0,20}(完整|可运行|可下载)?的?(代码|程序|软件|应用|游戏)/,
  /作为(一名|一个)?AI助手[^。\n]{0,30}(无法|不能)/,
  /\bI (cannot|can't|am not able to|am unable to)\b[^.\n]{0,80}\b(write|build|code|generate|create|deliver|provide)\b/i,
  /\bas an AI\b[^.\n]{0,60}\b(cannot|can't|unable|not able)\b/i,
];
const HANDBACK = [
  /外包(开发)?团队|聘请(一名|一位)?(开发|程序员)|找(一名|一个|位)?(程序员|开发者|开发团队)|程序员客栈|猪八戒/,
  /\b(hire|outsourc(e|ing)|find)( a | an )?(developer|programmer|freelancer|agency|dev team)\b/i,
];
export function capabilityRefusal(text: string, goal: string): string | null {
  const t = String(text || "");
  if (!wantsBuild(goal) || t.includes("```")) return null; // code (or any fenced block) was delivered
  const hit = REFUSAL.find((re) => re.test(t));
  const handed = HANDBACK.some((re) => re.test(t));
  if (!hit && !handed) return null;
  return hit
    ? "It claims it cannot write or deliver the code. Require the complete working files, each in its own fenced block with its file name, plus the exact run commands. (Exception: a refusal made for safety or policy reasons stands — in that case it must say so in one line.)"
    : "It hands the work to outside developers or paid services instead of delivering. Require the complete working deliverable now, written by the agent itself. (Exception: a refusal made for safety or policy reasons stands — in that case it must say so in one line.)";
}

function scopePrompt(job: Job, c: Constraints) {
  return {
    system: `You prepare a question for a panel of AI experts. Reply with JSON only:
{"broad":true|false,"directions":[{"title":"at most 8 words","line":"at most 18 words"}],"constraints":{"market":"","currency":"","count":0,"budget":"","other":["…"]}}
"broad" is true when the question is open-ended or asks for a long list or plan, so a few short directions to choose from would help (3–5 directions that genuinely differ: by sector, approach, budget level, customer …). It is false for a specific or narrow question. "constraints" lists only what the user actually required (market/region, currency, number of items, budget, language, other hard limits) — never invent any. Write titles and lines in ${job.lang || "the user's language"}.`,
    prompt: `QUESTION:\n${job.goal}\n\nALREADY READ FROM THE USER'S WORDS (keep these): ${JSON.stringify(c)}`,
  };
}

export function answerPrompt(job: Job, st: CollectionState, seg: number, own: string[]) {
  const c = st.constraints;
  const build = wantsBuild(job.goal);
  const range = c.count ? { from: (seg - 1) * st.segSize + 1, to: Math.min(seg * st.segSize, c.count) } : null;
  const parts = [
    languageRule(job.lang),
    `QUESTION:\n${job.goal}`,
    constraintBlock(c, st.choice),
    job.knowledge || "",
    notesPart(job),
    job.context ? `MATERIAL FROM THE USER:\n${job.context.slice(0, 12000)}` : "",
  ];
  if (range) {
    parts.push(
      own.length ? `YOU ALREADY GAVE (do not repeat any of these):\n${own.join("\n").slice(-6000)}` : "",
      `NOW WRITE ITEMS ${range.from} TO ${range.to} of ${c.count}: a numbered list starting at ${range.from} and ending at ${range.to} — every number present. Each item: a bold name, then one or two lines with what it is, why it fits the constraints, and the key number (startup cost, price or market size, with its basis).${seg === 1 ? " Start with one sentence on how you chose them." : " No introduction."}`,
    );
  } else if (seg === 1) {
    parts.push(`Write your answer: the answer first, then the reasons. ${lengthRule(build)}`);
  } else {
    parts.push(
      `YOUR ANSWER SO FAR:\n${own.join("\n\n").slice(-8000)}`,
      build
        ? "Continue the deliverable: the remaining files or sections, complete. Don't repeat what you already wrote. When the deliverable is finished, say so in one line."
        : `Continue your answer with the next part (${SCREEN}), going deeper where it matters most. Don't repeat what you already said. If there is nothing important left, say so in one line.`,
    );
  }
  return { system: SOLO, prompt: parts.filter(Boolean).join("\n\n"), range };
}

function relayPrompt(
  job: Job,
  st: CollectionState,
  question: string,
  answers: string,
  before: { name: string; text: string }[],
) {
  return {
    system: `You are one of several AI experts working TOGETHER on the user's follow-up question. Read the earlier answers and what your colleagues already said, then add what is missing or correct what is wrong — do not repeat them. Refer to colleagues by name when you build on them (e.g. "Building on GPT's point …"). Never mention the app, internal ids, drafts or rounds. Every number states its basis.`,
    prompt: [
      languageRule(job.lang),
      `ORIGINAL QUESTION:\n${job.goal}`,
      constraintBlock(st.constraints, st.choice),
      `EARLIER ANSWERS:\n${answers.slice(-14000)}`,
      notesPart(job),
      `THE USER NOW ASKS:\n${question}`,
      before.length
        ? `YOUR COLLEAGUES ALREADY REPLIED:\n${before
            .map((b) => `${b.name}: ${b.text}`)
            .join("\n\n")
            .slice(-8000)}`
        : "You reply first.",
      lengthRule(wantsBuild(`${job.goal}\n${question}`)),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function debatePrompt(job: Job, st: CollectionState, round: number, answers: string, prior: string) {
  return {
    system: `You are in a two-round debate between AI experts about the user's question. Defend what you believe is right and challenge the others with specific reasons and evidence — name the expert you disagree with and quote the point. Concede where they are right. No pleasantries, no scores, never mention the app or internal ids.`,
    prompt: [
      languageRule(job.lang),
      `QUESTION:\n${job.goal}`,
      constraintBlock(st.constraints, st.choice),
      `THE EXPERTS' ANSWERS:\n${answers.slice(-14000)}`,
      prior ? `ROUND 1 OF THE DEBATE:\n${prior.slice(-8000)}` : "",
      round === 1
        ? "Round 1: state the two or three points where you most disagree with the others, and why."
        : "Round 2 (last): answer the challenges made to you, say what you now concede, and state your final position in two sentences.",
      `Keep it under 200 words (or 350 characters in Chinese or Japanese)${wantsBuild(job.goal) ? ", unless you are answering with code or a made deliverable — then give it complete" : ""}.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/* ---------- running ---------- */

export const vendorName = (provider: string) =>
  provider === "demo" ? "Sample" : getProvider(provider)?.short || provider;

export function initCollection(goal: string): CollectionState {
  const c = readConstraints(goal);
  const total = c.count ? Math.ceil(c.count / SEG_ITEMS) : 1;
  return { constraints: c, scoped: false, segSize: SEG_ITEMS, total, done: 0 };
}

/** Text of every answer by one vendor so far (for "do not repeat" and for exports). */
export function answersOf(job: Job, provider: string): string[] {
  return job.events.filter((e) => e.role === "answer" && e.provider === provider && !e.failed).map((e) => e.text);
}

/** All vendors' answers, labelled, for follow-ups, debate and download. */
export function collectionText(job: Job, panel: string[]): string {
  return panel
    .map((p) => `## ${vendorName(p)}\n\n${answersOf(job, p).join("\n\n")}`)
    .filter((s) => !/\n\n$/.test(s))
    .join("\n\n");
}

export async function runCollection(job: Job, deps: RunDeps): Promise<void> {
  const st = job.collection!;
  const panel = (job.panel || []) as string[];
  const save = deps.save;
  const fetcher = deps.fetcher;
  const aborted = () => deps.isCancelled();
  const add = (u: Usage) => {
    job.usage.input += u.input;
    job.usage.output += u.output;
    job.usage.calls += 1;
    job.usage.cached = (job.usage.cached || 0) + (u.cached || 0);
  };
  // Agents that share one key take turns (most providers limit parallel calls per key).
  const keyLocks = new Map<string, Promise<unknown>>();
  async function ask(
    provider: string,
    p: { system: string; prompt: string },
    live: Omit<LiveTurn, "text" | "provider" | "model"> & { key: string },
    maxTokens = 6000,
  ): Promise<{ text: string; usage: Usage; model: string }> {
    if (job.mode === "demo") {
      const text = demoText(job, st, provider, live);
      const steps = 8;
      for (let k = 1; k <= steps; k++) {
        await (deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))((deps.demoDelay ?? 400) / steps);
        deps.onLive?.(live.key, {
          ...live,
          provider,
          model: "sample",
          text: text.slice(0, Math.ceil((text.length * k) / steps)),
        });
      }
      return { text, usage: { input: 0, output: 0 }, model: "sample" };
    }
    const cred = deps.credential(provider as ProviderId);
    if (!cred) throw new Error(`${vendorName(provider)} is not connected.`);
    const prev = keyLocks.get(cred.key) || Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((r) => (release = r));
    keyLocks.set(
      cred.key,
      prev.then(() => mine),
    );
    await prev;
    try {
      deps.onLive?.(live.key, { ...live, provider, model: cred.model, text: "" });
      const out = await complete(
        {
          provider: cred.provider,
          model: cred.model,
          key: cred.key,
          system: p.system,
          prompt: p.prompt,
          maxTokens,
          signal: deps.signal,
          ...(deps.onLive
            ? { onDelta: (t: string) => deps.onLive!(live.key, { ...live, provider, model: cred.model, text: t }) }
            : {}),
        },
        fetcher,
      );
      add(out.usage);
      return { text: out.text, usage: out.usage, model: cred.model };
    } finally {
      release();
    }
  }
  const event = (e: Partial<JobEvent> & Pick<JobEvent, "role" | "provider" | "text">): JobEvent => ({
    round: 0,
    model: "",
    usage: { input: 0, output: 0 },
    at: new Date().toISOString(),
    ...e,
  });

  job.status = "running";
  save(job);

  // 1. Scope: pin the constraints; offer directions for a broad question.
  if (!st.scoped) {
    try {
      const sp = scopePrompt(job, st.constraints);
      const r = await ask(panel[0], sp, { role: "scope", round: 0, key: "scope" }, 1500);
      deps.onLive?.("scope", null);
      const data = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || "{}");
      const llm = data.constraints || {};
      const mine = st.constraints;
      st.constraints = {
        market: mine.market || (llm.market ? String(llm.market) : undefined),
        currency: mine.currency || (llm.currency ? String(llm.currency) : undefined),
        count: mine.count || (Number(llm.count) >= 2 && Number(llm.count) <= 500 ? Number(llm.count) : undefined),
        budget: mine.budget || (llm.budget ? String(llm.budget) : undefined),
        other: Array.isArray(llm.other) ? llm.other.map(String).slice(0, 4) : undefined,
      };
      st.total = st.constraints.count ? Math.ceil(st.constraints.count / st.segSize) : 1;
      const dirs = (Array.isArray(data.directions) ? data.directions : [])
        .map((d: any) => ({ title: String(d?.title || "").slice(0, 80), line: String(d?.line || "").slice(0, 160) }))
        .filter((d: Direction) => d.title)
        .slice(0, 5);
      if (data.broad && dirs.length >= 2) st.directions = dirs;
    } catch {
      deps.onLive?.("scope", null);
      if (aborted()) return;
      // Scoping is a help, not a gate: carry on with what the user's words say.
    }
    st.scoped = true;
    if (st.directions?.length && st.choice === undefined) {
      job.status = "awaiting_choice";
      job.current = null;
      save(job);
      return;
    }
  }
  if (aborted()) return;

  // 1.5. Attached images / PDFs / video: one agent that can see them describes them for everyone.
  // Without this the files were validated and stored, then silently never shown to any agent.
  if (deps.media?.length && job.seer && !job.events.some((e) => e.role === "seer")) {
    const cred = job.mode === "demo" ? null : deps.credential(job.seer as ProviderId);
    if (cred) {
      try {
        deps.onLive?.("seer", { role: "seer", round: 0, provider: job.seer, model: cred.model, text: "" });
        const out = await complete(
          {
            ...cred,
            system: `You are one of several independent AI experts answering the user side by side. ${BS_SYSTEM.seer} Write in the user's language.`,
            prompt: `${languageRule(job.lang)}\n\nBRIEF:\n${job.goal}\n\nDescribe the attached files now.`,
            maxTokens: 3000,
            media: deps.media,
            signal: deps.signal,
            ...(deps.onLive
              ? { onDelta: (t: string) => deps.onLive!("seer", { role: "seer", round: 0, provider: job.seer!, model: cred.model, text: t }) }
              : {}),
          },
          fetcher,
        );
        add(out.usage);
        job.events.push(
          event({ role: "seer", round: 0, provider: job.seer, model: cred.model, text: out.text, usage: out.usage }),
        );
      } catch (e: any) {
        if (aborted()) return;
        job.events.push(
          event({
            role: "seer",
            round: 0,
            provider: job.seer,
            text: `Couldn't read the attached files: ${e?.message || "error"}`,
            failed: true,
          }),
        );
      } finally {
        deps.onLive?.("seer", null);
      }
      save(job);
    }
  }
  if (aborted()) return;

  // 2. The next segment from every agent, at the same time.
  const seg = st.done + 1;
  job.current = { role: "answer", round: seg };
  save(job);
  const outs = await Promise.allSettled(
    panel.map(async (p) => {
      const ap = answerPrompt(job, st, seg, answersOf(job, p));
      const key = `answer|${seg}|${p}`;
      // Build briefs need room for complete files; ordinary answers keep the original 6,000-token cap.
      const answerCap = wantsBuild(job.goal) ? 8000 : 6000;
      let r = await ask(p, ap, { role: "answer", round: seg, key }, answerCap);
      // The user's constraints are not optional: one more try, told exactly what was wrong.
      const allProblems = (text: string) => {
        const ps = constraintProblems(text, st.constraints, ap.range || undefined, job.lang);
        // Opt-in only (Team → Data): detecting a refusal is free, the redo is an extra paid call.
        const cr = deps.refusalRedo ? capabilityRefusal(text, job.goal) : null;
        if (cr) ps.push(cr);
        return ps;
      };
      const problems = allProblems(r.text);
      if (problems.length && !aborted()) {
        const fix = await ask(
          p,
          {
            system: ap.system,
            prompt: `${ap.prompt}\n\nYOUR PREVIOUS ATTEMPT BROKE THE USER'S REQUIREMENTS:\n- ${problems.join("\n- ")}\nRewrite it so every requirement holds.`,
          },
          { role: "answer", round: seg, key },
          answerCap,
        );
        if (allProblems(fix.text).length <= problems.length) r = fix;
      }
      return r;
    }),
  );
  if (aborted()) return;
  outs.forEach((o, k) => {
    const p = panel[k];
    deps.onLive?.(`answer|${seg}|${p}`, null);
    job.events.push(
      o.status === "fulfilled"
        ? event({
            role: "answer",
            round: seg,
            provider: p,
            model: o.value.model,
            text: o.value.text,
            usage: o.value.usage,
          })
        : event({
            role: "answer",
            round: seg,
            provider: p,
            text: `Couldn't answer: ${o.reason?.message || "error"}`,
            failed: true,
          }),
    );
  });
  if (outs.every((o) => o.status === "rejected")) throw (outs[0] as PromiseRejectedResult).reason;
  st.done = seg;
  job.current = null;
  job.status = st.done < st.total || !st.constraints.count ? "partial" : "awaiting_review";
  save(job);
}

/** A follow-up: the agents answer it together, in turn, each reading the others first. */
export async function runFollowUp(job: Job, question: string, deps: RunDeps): Promise<void> {
  const st = job.collection!;
  const panel = (job.panel || []) as string[];
  // The user's latest words can change the language and the constraints at once.
  job.lang = languageFor(question, job.lang) || job.lang;
  const now = readConstraints(question);
  st.constraints = { ...st.constraints, ...Object.fromEntries(Object.entries(now).filter(([, v]) => v !== undefined)) };
  const n = job.events.filter((e) => e.role === "feedback").length + 1;
  job.events.push({
    role: "feedback",
    source: "you",
    round: n,
    provider: "you",
    model: "",
    text: question,
    usage: { input: 0, output: 0 },
    at: new Date().toISOString(),
  });
  job.status = "running";
  deps.save(job);
  const answers = collectionText(job, panel);
  const before: { name: string; text: string }[] = [];
  for (const p of panel) {
    if (deps.isCancelled()) return;
    const sub: RunDeps = { ...deps };
    const r = await runOne(
      job,
      p,
      relayPrompt(job, st, question, answers, before),
      "followup",
      n,
      sub,
      `${job.goal}\n${question}`,
    );
    if (r) before.push({ name: vendorName(p), text: r });
  }
  job.status = "partial";
  deps.save(job);
}

/** Two rounds of debate on the current topic, then stop. */
export async function runDebate(job: Job, deps: RunDeps): Promise<void> {
  const st = job.collection!;
  const panel = (job.panel || []) as string[];
  const answers = collectionText(job, panel);
  job.status = "running";
  deps.save(job);
  let prior = "";
  for (const round of [1, 2]) {
    const texts = await Promise.all(
      panel.map((p) => runOne(job, p, debatePrompt(job, st, round, answers, prior), "debater", round, deps)),
    );
    if (deps.isCancelled()) return;
    prior = panel
      .map((p, k) => (texts[k] ? `${vendorName(p)}: ${texts[k]}` : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  st.debated = (st.debated || 0) + 1;
  job.status = "partial";
  deps.save(job);
}

async function runOne(
  job: Job,
  p: string,
  pr: { system: string; prompt: string },
  role: "followup" | "debater",
  round: number,
  deps: RunDeps,
  buildGoal?: string,
) {
  const key = `${role}|${round}|${p}`;
  try {
    let text: string;
    let model = "sample";
    let usage: Usage = { input: 0, output: 0 };
    if (job.mode === "demo") {
      text = demoText(job, job.collection!, p, { role, round, key });
      deps.onLive?.(key, { role, round, provider: p, model, text });
      await (deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(deps.demoDelay ?? 400);
    } else {
      const cred = deps.credential(p as ProviderId);
      if (!cred) return null;
      deps.onLive?.(key, { role, round, provider: p, model: cred.model, text: "" });
      // Build follow-ups need room for complete code; ordinary follow-ups keep the original 4,000-token cap.
      const turnCap = buildGoal && wantsBuild(buildGoal) ? 6000 : 4000;
      const out = await complete(
        {
          ...cred,
          system: pr.system,
          prompt: pr.prompt,
          maxTokens: turnCap,
          signal: deps.signal,
          ...(deps.onLive
            ? { onDelta: (t: string) => deps.onLive!(key, { role, round, provider: p, model: cred.model, text: t }) }
            : {}),
        },
        deps.fetcher,
      );
      text = out.text;
      model = cred.model;
      usage = out.usage;
      // Follow-ups and debate are read by the user too: the wrong language gets one rewrite.
      const lw = wrongLanguage(text, job.lang);
      if (lw && !deps.isCancelled()) {
        const again = await complete(
          { ...cred, system: pr.system, prompt: `${pr.prompt}\n\n${lw}`, maxTokens: turnCap, signal: deps.signal },
          deps.fetcher,
        );
        if (!wrongLanguage(again.text, job.lang)) text = again.text;
        usage = { input: usage.input + again.usage.input, output: usage.output + again.usage.output };
      }
      // A follow-up that declines to build ("as an AI I cannot…, hire a developer") gets one retry told to
      // deliver — only when the user opted in (Team → Data); the redo is an extra paid call.
      const cr = deps.refusalRedo && buildGoal ? capabilityRefusal(text, buildGoal) : null;
      if (cr && !deps.isCancelled()) {
        const again = await complete(
          {
            ...cred,
            system: pr.system,
            prompt: `${pr.prompt}\n\nYOUR PREVIOUS REPLY FAILED THE USER: ${cr}`,
            maxTokens: turnCap,
            signal: deps.signal,
          },
          deps.fetcher,
        );
        if (!capabilityRefusal(again.text, buildGoal!)) text = again.text;
        usage = { input: usage.input + again.usage.input, output: usage.output + again.usage.output };
      }
      job.usage.input += usage.input;
      job.usage.output += usage.output;
      job.usage.calls += 1;
    }
    deps.onLive?.(key, null);
    job.events.push({ role, round, provider: p, model, text, usage, at: new Date().toISOString() });
    deps.save(job);
    return text;
  } catch (e: any) {
    deps.onLive?.(key, null);
    if (deps.isCancelled()) return null;
    job.events.push({
      role,
      round,
      provider: p,
      model: "",
      text: `Couldn't answer: ${e?.message || "error"}`,
      usage: { input: 0, output: 0 },
      at: new Date().toISOString(),
      failed: true,
    });
    deps.save(job);
    return null;
  }
}

/* ---------- the sample (no AI called) ---------- */

export const SAMPLE_QUESTION =
  "Give me 20 low-cost business ideas for the North American market, each under $10,000 to start.";
const SAMPLE_DIRS: Direction[] = [
  { title: "Local services", line: "Neighbourhood businesses you can start this month" },
  { title: "Online & digital", line: "Run from a laptop, sell across the US and Canada" },
  { title: "Weekend side business", line: "Under 10 hours a week to start" },
];
const SAMPLE_IDEAS: Record<string, string[]> = {
  anthropic: [
    "Mobile bike repair",
    "Senior tech help",
    "Pet waste removal",
    "Window cleaning",
    "Garage organizing",
    "Car interior detailing",
    "Lawn aeration",
    "Pressure washing",
    "Home-office setup",
    "Holiday light installs",
    "Grocery delivery for seniors",
    "Move-out cleaning",
    "Furniture assembly",
    "Gutter cleaning",
    "Small-engine repair",
    "Dog walking",
    "Notary on the go",
    "Bulk trash hauling",
    "Smart-home installs",
    "Laundry pickup",
  ],
  openai: [
    "Etsy printable planners",
    "Shopify store setup",
    "Podcast editing",
    "Notion templates",
    "Resume rewriting",
    "Local SEO audits",
    "Bookkeeping for trades",
    "Faceless YouTube channel",
    "UGC video creation",
    "Newsletter for a niche",
    "Canva brand kits",
    "Amazon KDP low-content books",
    "Online tutoring",
    "Virtual assistant",
    "Stock photo bundles",
    "Translation (EN–ES)",
    "Course editing",
    "Email marketing setup",
    "Pinterest management",
    "Website speed fixes",
  ],
  google: [
    "Farmers-market coffee cart",
    "Plant rental for offices",
    "Kids' coding camp",
    "Event photo booth",
    "Mobile car wash",
    "Meal-prep for gyms",
    "Vintage resale",
    "Cookie decorating classes",
    "Bike rentals",
    "Dog grooming van",
    "Balloon garlands",
    "Candle making",
    "Home staging",
    "Mini storage organizing",
    "Sneaker cleaning",
    "Board-game cafe pop-up",
    "Tool rental",
    "Craft beer tours",
    "Phone screen repair",
    "Flower subscriptions",
  ],
};
function demoText(
  job: Job,
  st: CollectionState,
  p: string,
  live: { role: string; round: number; key?: string },
): string {
  if (live.role === "scope")
    return JSON.stringify({
      broad: true,
      directions: SAMPLE_DIRS,
      constraints: { market: "North America", currency: "USD ($)", count: 20, budget: "under $10,000" },
    });
  const ideas = SAMPLE_IDEAS[p] || SAMPLE_IDEAS.anthropic;
  if (live.role === "answer") {
    const from = (live.round - 1) * st.segSize;
    const items = ideas.slice(from, from + st.segSize);
    const head =
      live.round === 1
        ? `Chosen for ${st.choice || "the US and Canada"}: cheap to start, steady local demand.\n\n`
        : "";
    return (
      head +
      items
        .map(
          (x, i) =>
            `${from + i + 1}. **${x}** — startup cost about $${(1 + ((i * 7 + p.length) % 9)) * 900} (estimate: equipment + first month of ads).`,
        )
        .join("\n")
    );
  }
  if (live.role === "followup")
    return `Building on the list: start with ${ideas[0].toLowerCase()} — lowest cost and fastest first customer.`;
  return live.round === 1
    ? `I disagree that online ideas are safer: ${ideas[2]} has steadier demand.`
    : `I concede the margin point; my final pick stays ${ideas[0]}.`;
}
