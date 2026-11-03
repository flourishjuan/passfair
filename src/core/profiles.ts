// One place that knows what each model can do. Every budget in the app is derived from here,
// so no agent is ever given less room than it needs or more than it can take.
//   context  — how much it can read (tokens, prompt + answer)
//   maxOut   — the longest answer it can write (tokens)
//   thinks   — reasoning model: hidden thinking counts against maxOut, so it needs headroom
//   rpm      — rough requests-at-once the account tolerates; agents sharing a key are queued
export interface ModelProfile {
  context: number;
  maxOut: number;
  thinks: boolean;
  note?: string;
}

const P = (context: number, maxOut: number, thinks = false, note?: string): ModelProfile => ({
  context,
  maxOut,
  thinks,
  ...(note ? { note } : {}),
});

// Matched in order against "provider/model" (OpenRouter ids already look like that). First match wins.
const TABLE: [RegExp, ModelProfile][] = [
  // Anthropic
  [/claude-(opus|sonnet)-4/i, P(200000, 16000)],
  [/claude-haiku-4|claude-3-5-haiku/i, P(200000, 8000)],
  [/claude/i, P(200000, 8000)],
  // OpenAI
  [/gpt-5/i, P(400000, 32000, true, "Thinks before answering: slower, uses more tokens.")],
  [/\bo[134](-mini|-pro)?\b/i, P(200000, 32000, true, "Thinks before answering: slower, uses more tokens.")],
  [/gpt-4\.1/i, P(1000000, 16000)],
  [/gpt-4o/i, P(128000, 16000)],
  // Google
  [/gemini-(2\.5|3)/i, P(1000000, 32000, true, "Thinks before answering.")],
  [/gemini/i, P(1000000, 8000)],
  // xAI
  [/grok-4/i, P(256000, 16000, true, "Thinks before answering.")],
  [/grok-3-mini/i, P(131000, 8000, true)],
  [/grok/i, P(131000, 8000)],
  // DeepSeek
  [/deepseek-(reasoner|r1)/i, P(128000, 16000, true, "Thinks before answering.")],
  [/deepseek/i, P(128000, 8000)],
  // Groq (fast open models; free tier has small per-minute token limits)
  [/gpt-oss/i, P(128000, 8000, true)],
  [/^groq\//i, P(128000, 8000, false, "On Groq's free tier, long briefs may hit its per-minute token limit.")],
  // Meta Llama
  [/llama/i, P(128000, 8000)],
  // Perplexity
  [/sonar-(reasoning|deep)/i, P(128000, 8000, true)],
  [/sonar/i, P(128000, 8000)],
  // Mistral, Qwen, Kimi
  [/mistral|magistral|codestral/i, P(128000, 8000)],
  [/qwen-(max|plus|turbo)|qwen3/i, P(128000, 8000)],
  [/kimi-k2|moonshot-v1-128k/i, P(128000, 8000)],
  [/moonshot-v1-32k/i, P(32000, 4000, false, "Short memory (32k): long discussions are condensed for it.")],
  [/moonshot-v1-8k/i, P(8000, 2000, false, "Very short memory (8k): use for short briefs only.")],
];
// Unknown or custom models: conservative, safe defaults.
export const UNKNOWN: ModelProfile = P(32000, 4000, false, "Unknown model: Passfair uses safe, shorter limits.");

export function profileFor(provider: string, model: string): ModelProfile {
  const id = `${provider}/${model}`;
  for (const [re, p] of TABLE) if (re.test(id)) return p;
  return UNKNOWN;
}

// What each role should get, before the model's own limits are applied.
export const ROLE_TARGET = {
  worker: 8000,
  polisher: 8000,
  decider: 6000,
  planner: 3000,
  framer: 2500,
  panelist: 3000,
  reviewer: 3000,
  verifier: 3000,
  seer: 3000,
  researcher: 3000,
} as const;

// Answer budget for one call: role target, plus headroom for thinking models, never above what the model allows,
// and never so big that prompt + answer overflow the model's memory.
export function budgetFor(role: keyof typeof ROLE_TARGET | string, p: ModelProfile, promptTokens = 0): number {
  const target = (ROLE_TARGET as Record<string, number>)[role] ?? 4000;
  const want = p.thinks ? Math.max(target * 2, 6000) : target;
  const room = Math.max(1000, Math.floor(p.context * 0.95) - promptTokens);
  return Math.max(256, Math.min(want, p.maxOut, room));
}

// Rough token count: CJK characters ≈ 1 token each, other text ≈ 4 characters per token.
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[　-鿿가-힯＀-￯]/g) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / 3.6);
}

// Makes a prompt fit the model's memory: keeps the start (brief, material headline) and the end
// (latest discussion and the instruction), and condenses the middle with a clear marker.
export function fitPrompt(prompt: string, p: ModelProfile, answerBudget: number): { text: string; condensed: boolean } {
  const limit = Math.floor(p.context * 0.9) - answerBudget - 1500; // system prompt + safety margin
  const tokens = estimateTokens(prompt);
  if (tokens <= limit || limit <= 0) return { text: prompt, condensed: false };
  const ratio = limit / tokens;
  const keep = Math.floor(prompt.length * ratio);
  const head = Math.floor(keep * 0.35);
  const tail = keep - head;
  return {
    text: `${prompt.slice(0, head)}\n\n[… earlier material and discussion condensed to fit this model's memory …]\n\n${prompt.slice(prompt.length - tail)}`,
    condensed: true,
  };
}
