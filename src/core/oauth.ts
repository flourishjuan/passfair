// One-tap sign-in with OpenRouter (OAuth PKCE): the user logs in once in the system browser and the app
// receives an API key — no copy-paste. One OpenRouter account reaches Claude, GPT, Grok, Gemini, Llama and more.
// Also: recognise an API key the user just copied, so connecting another vendor is one tap.
import { fail, type Fetcher } from "./providers";

/* ---------- SHA-256 (small, dependency-free; needed for the PKCE challenge) ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  const w = new Uint32Array(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}
export function base64url(bytes: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += abc[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += abc[n & 63];
  }
  return out;
}
export function pkce(random: (n: number) => Uint8Array) {
  const verifier = base64url(random(32));
  const challenge = base64url(sha256(new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export const OPENROUTER_AUTH = "https://openrouter.ai/auth";
export const OPENROUTER_EXCHANGE = "https://openrouter.ai/api/v1/auth/keys";
export const authUrl = (callback: string, challenge: string) =>
  `${OPENROUTER_AUTH}?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
export function codeFrom(redirect: string): string | null {
  const m = redirect.match(/[?&]code=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export async function exchangeCode(code: string, verifier: string, fetcher: Fetcher = fetch): Promise<string> {
  let r: Response;
  try {
    r = await fetcher(OPENROUTER_EXCHANGE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
  } catch {
    return fail("OpenRouter: connection failed.", 502);
  }
  if (!r.ok) fail(`OpenRouter sign-in failed (HTTP ${r.status}). Try again.`, 502);
  const data: any = await r.json().catch(() => ({}));
  if (!data.key) fail("OpenRouter did not return a key.", 502);
  return String(data.key);
}

// The agents one OpenRouter sign-in adds. They share the one key; models can be changed later.
export const OPENROUTER_AGENTS = [
  { id: "or:claude", name: "Claude", model: "anthropic/claude-sonnet-4.5", color: "#D97757" },
  { id: "or:gpt", name: "GPT", model: "openai/gpt-4.1", color: "#10A37F" },
  { id: "or:grok", name: "Grok", model: "x-ai/grok-4", color: "#111111" },
  { id: "or:gemini", name: "Gemini", model: "google/gemini-2.5-pro", color: "#4285F4" },
  { id: "or:deepseek", name: "DeepSeek", model: "deepseek/deepseek-chat", color: "#4D6BFE" },
  { id: "or:llama", name: "Llama", model: "meta-llama/llama-4-maverick", color: "#0866FF" },
];

/* ---------- recognise a copied key ---------- */
const PATTERNS: [RegExp, string][] = [
  [/^sk-ant-[A-Za-z0-9_-]{20,}$/, "anthropic"],
  [/^sk-or-v1-[A-Za-z0-9]{20,}$/, "openrouter"],
  [/^sk-proj-[A-Za-z0-9_-]{20,}$/, "openai"],
  [/^xai-[A-Za-z0-9]{20,}$/, "xai"],
  [/^AIza[0-9A-Za-z_-]{30,}$/, "google"],
  [/^pplx-[A-Za-z0-9]{20,}$/, "perplexity"],
  [/^gsk_[A-Za-z0-9]{20,}$/, "groq"],
  [/^LLM\|[0-9]+\|[A-Za-z0-9_-]{10,}$/, "meta"],
];
export function detectKey(clip: string): { provider: string; key: string } | null {
  const key = (clip || "").trim();
  if (key.length > 300 || /\s/.test(key)) return null;
  for (const [re, provider] of PATTERNS) if (re.test(key)) return { provider, key };
  return null;
}
