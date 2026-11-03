// Model provider adapters. Every agent — built-in or one the user adds — speaks one of four wire formats.
// Calls go straight from the phone to the vendor the user chose; no proxy, no middleman.
// Endpoints of built-in agents are fixed. A custom agent's endpoint is whatever HTTPS URL the user typed.

export type ApiStyle = "anthropic" | "openai-responses" | "openai-chat" | "gemini";
export type ProviderId = string;

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  short: string;
  api: ApiStyle;
  url: string;
  keyHint: string;
  defaultModel: string;
  models: string[];
  docs: string;
  color: string;
  /** "builtin": every answer is grounded in live web search; "tool": search can be switched on per call. */
  search?: "builtin" | "tool";
  maxOut: number;
  /** What the agent can look at directly when a file is attached. */
  media?: MediaKind[];
  note?: string;
  custom?: boolean;
}
export type MediaKind = "image" | "pdf" | "video" | "audio";
export interface MediaItem {
  name: string;
  mime: string;
  base64: string;
}
export const mediaKind = (mime: string): MediaKind | null =>
  /^image\/(jpeg|png|gif|webp)$/.test(mime)
    ? "image"
    : mime === "application/pdf"
      ? "pdf"
      : /^video\//.test(mime)
        ? "video"
        : /^audio\//.test(mime)
          ? "audio"
          : null;
export const canSee = (spec: ProviderSpec | undefined, mime: string) => {
  const k = mediaKind(mime);
  return !!(spec && k && spec.media?.includes(k));
};

const BUILTIN: ProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic · Claude",
    short: "Claude",
    api: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    keyHint: "sk-ant-…",
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    docs: "https://platform.claude.com/settings/keys",
    color: "#D97757",
    search: "tool",
    maxOut: 16000,
    media: ["image", "pdf"],
  },
  {
    id: "openai",
    label: "OpenAI · GPT",
    short: "GPT",
    api: "openai-responses",
    url: "https://api.openai.com/v1/responses",
    keyHint: "sk-…",
    defaultModel: "gpt-4.1",
    models: ["gpt-4.1", "gpt-5", "gpt-5-mini", "o4-mini"],
    docs: "https://platform.openai.com/api-keys",
    color: "#10A37F",
    search: "tool",
    maxOut: 16000,
    media: ["image", "pdf"],
  },
  {
    id: "google",
    label: "Google · Gemini",
    short: "Gemini",
    api: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    keyHint: "AIza…",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    docs: "https://aistudio.google.com/apikey",
    color: "#4285F4",
    search: "tool",
    maxOut: 16000,
    media: ["image", "pdf", "video", "audio"],
  },
  {
    id: "xai",
    label: "xAI · Grok",
    short: "Grok",
    api: "openai-chat",
    url: "https://api.x.ai/v1/chat/completions",
    keyHint: "xai-…",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-3", "grok-3-mini"],
    docs: "https://console.x.ai/",
    color: "#111111",
    maxOut: 16000,
    media: ["image"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    api: "openai-chat",
    url: "https://api.deepseek.com/chat/completions",
    keyHint: "sk-…",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docs: "https://platform.deepseek.com/api_keys",
    color: "#4D6BFE",
    maxOut: 8000,
  },
  {
    id: "meta",
    label: "Meta · Llama",
    short: "Llama",
    api: "openai-chat",
    url: "https://api.llama.com/compat/v1/chat/completions",
    keyHint: "LLM|…",
    defaultModel: "Llama-4-Maverick-17B-128E-Instruct-FP8",
    models: ["Llama-4-Maverick-17B-128E-Instruct-FP8", "Llama-3.3-70B-Instruct"],
    docs: "https://llama.developer.meta.com/",
    color: "#0866FF",
    maxOut: 4000,
  },
  {
    id: "perplexity",
    label: "Perplexity · Sonar (live web)",
    short: "Perplexity",
    api: "openai-chat",
    url: "https://api.perplexity.ai/chat/completions",
    keyHint: "pplx-…",
    defaultModel: "sonar-pro",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro"],
    docs: "https://www.perplexity.ai/account/api",
    color: "#20808D",
    search: "builtin",
    maxOut: 8000,
    note: "Searches the web on every answer — the best Researcher.",
  },
  {
    id: "mistral",
    label: "Mistral",
    short: "Mistral",
    api: "openai-chat",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyHint: "…",
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest"],
    docs: "https://console.mistral.ai/api-keys",
    color: "#FA520F",
    maxOut: 8000,
  },
  {
    id: "qwen",
    label: "Alibaba · Qwen",
    short: "Qwen",
    api: "openai-chat",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    keyHint: "sk-…",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    docs: "https://modelstudio.console.alibabacloud.com/",
    color: "#615CED",
    maxOut: 8000,
  },
  {
    id: "moonshot",
    label: "Moonshot · Kimi",
    short: "Kimi",
    api: "openai-chat",
    url: "https://api.moonshot.ai/v1/chat/completions",
    keyHint: "sk-…",
    defaultModel: "moonshot-v1-32k",
    models: ["moonshot-v1-32k", "kimi-k2-0905-preview"],
    docs: "https://platform.moonshot.ai/console/api-keys",
    color: "#1E1E1E",
    maxOut: 8000,
  },
  {
    id: "groq",
    label: "Groq (fast open models)",
    short: "Groq",
    api: "openai-chat",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyHint: "gsk_…",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    docs: "https://console.groq.com/keys",
    color: "#F55036",
    maxOut: 8000,
  },
  {
    id: "openrouter",
    label: "OpenRouter (one key, many models)",
    short: "OpenRouter",
    api: "openai-chat",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyHint: "sk-or-…",
    defaultModel: "anthropic/claude-sonnet-4.5",
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1", "x-ai/grok-4", "google/gemini-2.5-pro"],
    docs: "https://openrouter.ai/keys",
    color: "#6467F2",
    maxOut: 16000,
  },
];

// Tools people ask for that have no public model API. Shown in the agent list with an honest note.
export const notConnectable: { name: string; note: string }[] = [
  {
    name: "Cursor",
    note: "Cursor runs Claude, GPT and others inside its editor but offers no public model API. Connect the same models here directly, or add an OpenAI-compatible endpoint as a custom agent.",
  },
];

export const providers: Record<string, ProviderSpec> = Object.fromEntries(BUILTIN.map((p) => [p.id, p]));
export const providerIds: ProviderId[] = BUILTIN.map((p) => p.id);

/* ---------- custom agents ---------- */
export interface CustomAgent {
  id: string; // "custom:<slug>"
  name: string;
  brand?: string;
  baseUrl: string; // e.g. https://api.example.com/v1
  style: "openai-chat" | "anthropic";
  model: string;
  color?: string;
  /** Share another agent's key (e.g. every OpenRouter agent uses the one OpenRouter key). */
  keyRef?: string;
  /** Created by a sign-in, not by hand — not counted as a Pro custom agent. */
  managed?: boolean;
}
const custom = new Map<string, ProviderSpec>();
export function customUrl(a: Pick<CustomAgent, "baseUrl" | "style">): string {
  const base = a.baseUrl.trim().replace(/\/+$/, "");
  if (a.style === "anthropic") return /\/messages$/.test(base) ? base : `${base}/messages`;
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}
export function validateCustom(a: CustomAgent): string | null {
  if (!a.name.trim()) return "Give the agent a name.";
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(a.baseUrl.trim())) return "The endpoint must start with https://";
  if (!a.model.trim()) return "Enter the model name.";
  return null;
}
export function setCustomAgents(list: CustomAgent[]) {
  custom.clear();
  for (const a of list)
    custom.set(a.id, {
      id: a.id,
      label: a.brand ? `${a.brand} · ${a.name}` : a.name,
      short: a.name.slice(0, 16),
      api: a.style,
      url: customUrl(a),
      keyHint: "API key",
      defaultModel: a.model,
      models: [a.model],
      docs: "",
      color: a.color || "#7149F2",
      maxOut: 8000,
      custom: !a.managed,
      // OpenRouter passes images through to vision models.
      ...(a.keyRef === "openrouter" ? { media: ["image" as MediaKind] } : {}),
    });
}
export function getProvider(id: ProviderId): ProviderSpec | undefined {
  return providers[id] || custom.get(id);
}
export function allProviders(): ProviderSpec[] {
  return [...BUILTIN, ...custom.values()];
}
export const shortName = (id: string) =>
  getProvider(id)?.short || (id === "demo" ? "Demo" : id === "muse" || id === "relay" ? "Muse" : id);

/* ---------- calls ---------- */
export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function fail(message: string, status = 400): never {
  throw new ProviderError(message, status);
}

export interface CompletionRequest {
  provider: ProviderId;
  model: string;
  key: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Ask the vendor to ground the answer in live web search (if it can). */
  search?: boolean;
  /** Files the agent should look at directly (only kinds it supports are sent). */
  media?: MediaItem[];
  signal?: AbortSignal;
}
export interface Usage {
  input: number;
  output: number;
}
export interface Completion {
  text: string;
  usage: Usage;
  truncated: boolean;
  sources?: string[];
  searched?: boolean;
}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

function buildRequest(
  spec: ProviderSpec,
  r: {
    model: string;
    key: string;
    system: string;
    prompt: string;
    maxTokens: number;
    search: boolean;
    media?: MediaItem[];
  },
): { url: string; headers: Record<string, string>; body: any } {
  const json = { "Content-Type": "application/json" };
  const media = (r.media || []).filter((m) => canSee(spec, m.mime));
  const dataUrl = (m: MediaItem) => `data:${m.mime};base64,${m.base64}`;
  if (spec.api === "anthropic")
    return {
      url: spec.url,
      headers: {
        ...json,
        "x-api-key": r.key,
        "anthropic-version": "2023-06-01",
        // Required for direct browser/app calls; harmless elsewhere.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: r.model,
        max_tokens: r.maxTokens,
        system: r.system,
        messages: [
          {
            role: "user",
            content: media.length
              ? [
                  ...media.map((m) =>
                    mediaKind(m.mime) === "pdf"
                      ? { type: "document", source: { type: "base64", media_type: m.mime, data: m.base64 } }
                      : { type: "image", source: { type: "base64", media_type: m.mime, data: m.base64 } },
                  ),
                  { type: "text", text: r.prompt },
                ]
              : r.prompt,
          },
        ],
        ...(r.search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}),
      },
    };
  if (spec.api === "openai-responses")
    return {
      url: spec.url,
      headers: { ...json, Authorization: `Bearer ${r.key}` },
      body: {
        model: r.model,
        instructions: r.system,
        input: media.length
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: r.prompt },
                  ...media.map((m) =>
                    mediaKind(m.mime) === "pdf"
                      ? { type: "input_file", filename: m.name, file_data: dataUrl(m) }
                      : { type: "input_image", image_url: dataUrl(m) },
                  ),
                ],
              },
            ]
          : r.prompt,
        max_output_tokens: r.maxTokens,
        store: false,
        ...(r.search ? { tools: [{ type: "web_search" }] } : {}),
      },
    };
  if (spec.api === "gemini")
    return {
      url: spec.url.replace("{model}", encodeURIComponent(r.model)),
      headers: { ...json, "x-goog-api-key": r.key },
      body: {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [
          {
            role: "user",
            parts: [...media.map((m) => ({ inline_data: { mime_type: m.mime, data: m.base64 } })), { text: r.prompt }],
          },
        ],
        generationConfig: { maxOutputTokens: r.maxTokens },
        ...(r.search ? { tools: [{ google_search: {} }] } : {}),
      },
    };
  return {
    url: spec.url,
    headers: {
      ...json,
      Authorization: `Bearer ${r.key}`,
      ...(spec.id === "openrouter"
        ? { "HTTP-Referer": "https://challenge.agentsfair.ai/passfair", "X-Title": "Passfair" }
        : {}),
    },
    body: {
      model: r.model,
      max_tokens: r.maxTokens,
      messages: [
        { role: "system", content: r.system },
        {
          role: "user",
          content: media.length
            ? [
                { type: "text", text: r.prompt },
                ...media.map((m) => ({ type: "image_url", image_url: { url: dataUrl(m) } })),
              ]
            : r.prompt,
        },
      ],
    },
  };
}

const uniq = (xs: string[]) => Array.from(new Set(xs.filter((x) => /^https?:\/\//.test(x)))).slice(0, 12);

export function extract(spec: ProviderSpec, data: any): Completion {
  if (spec.api === "anthropic") {
    const blocks = (data.content || []).filter((x: any) => x.type === "text");
    return {
      text: blocks.map((x: any) => x.text).join(""),
      usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
      truncated: data.stop_reason === "max_tokens",
      sources: uniq(blocks.flatMap((b: any) => (b.citations || []).map((c: any) => c.url))),
    };
  }
  if (spec.api === "openai-responses") {
    const parts = (data.output || []).flatMap((x: any) => x.content || []).filter((x: any) => x.type === "output_text");
    return {
      text: data.output_text || parts.map((x: any) => x.text).join("\n"),
      usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
      truncated: data.status === "incomplete",
      sources: uniq(parts.flatMap((p: any) => (p.annotations || []).map((a: any) => a.url))),
    };
  }
  if (spec.api === "gemini") {
    const cand = data.candidates?.[0];
    return {
      text: (cand?.content?.parts || []).map((x: any) => x.text || "").join(""),
      usage: {
        input: data.usageMetadata?.promptTokenCount || 0,
        output: data.usageMetadata?.candidatesTokenCount || 0,
      },
      truncated: cand?.finishReason === "MAX_TOKENS",
      sources: uniq((cand?.groundingMetadata?.groundingChunks || []).map((g: any) => g.web?.uri)),
    };
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  return {
    text: Array.isArray(content) ? content.map((c: any) => c.text || "").join("") : content || "",
    usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
    truncated: choice?.finish_reason === "length",
    sources: uniq([...(data.citations || []), ...(data.search_results || []).map((s: any) => s.url)]),
  };
}

const RETRY = new Set([429, 500, 502, 503, 504, 529]);

export async function complete(
  req: CompletionRequest,
  fetcher: Fetcher = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Completion> {
  const spec = getProvider(req.provider);
  if (!spec) return fail("Unknown agent. Connect it again from the ••• menu.");
  const wantSearch = !!req.search && spec.search === "tool";
  const maxTokens = Math.min(req.maxTokens ?? 4000, spec.maxOut);
  const once = async (search: boolean) => {
    const built = buildRequest(spec, { ...req, maxTokens, search });
    const timeout = AbortSignal.timeout(240000);
    try {
      return await fetcher(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
      });
    } catch {
      return fail(req.signal?.aborted ? "Cancelled." : `${spec.short}: connection failed or timed out.`, 502);
    }
  };
  let searched = wantSearch;
  let response = await once(searched);
  // A model or account without web search access: answer without it rather than fail the run.
  if (searched && (response.status === 400 || response.status === 404)) {
    searched = false;
    response = await once(false);
  }
  for (let i = 0; i < 2 && RETRY.has(response.status) && !req.signal?.aborted; i++) {
    await wait(2500 * (i + 1));
    response = await once(searched);
  }
  if (!response.ok) {
    // Status only. Provider error bodies can echo the prompt, so they are never surfaced.
    const hint =
      response.status === 401 || response.status === 403
        ? "Check the API key."
        : response.status === 404
          ? "Check the model name."
          : response.status === 429
            ? "Rate limit or quota reached."
            : response.status === 402
              ? "Out of credit with this provider."
              : "Check model access and quota.";
    fail(`${spec.short} returned HTTP ${response.status}. ${hint}`, 502);
  }
  const raw = await response.text();
  if (raw.length > 4000000) fail("Provider response exceeded limit.", 502);
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("Provider returned invalid JSON.", 502);
  }
  if (data.error) fail(`${spec.short} reported an error. Check key, model and quota.`, 502);
  const out = extract(spec, data);
  out.text = (out.text || "").trim();
  out.searched = searched || spec.search === "builtin";
  if (!out.text) fail(`${spec.short} returned no text.`, 502);
  if (out.sources?.length && !/\n(Sources|来源)[:：]/.test(out.text))
    out.text += `\n\nSources:\n${out.sources.map((u) => `- ${u}`).join("\n")}`;
  return out;
}

// One tiny request to confirm a key works before it is saved.
export async function verify(c: { provider: ProviderId; model: string; key: string }, fetcher: Fetcher = fetch) {
  const r = await complete(
    { ...c, system: "Reply with the single word OK.", prompt: "Say OK.", maxTokens: 16 },
    fetcher,
    async () => {},
  );
  return { ok: true, sample: r.text.slice(0, 40) };
}
