// Model provider adapters. One function, one shape, three vendors.
// Each adapter sends a single system+user prompt straight from the phone to the vendor
// and returns plain text plus usage. Endpoints are fixed; no proxy, no middleman.

export type ProviderId = "anthropic" | "openai" | "google";

export interface ProviderSpec {
  label: string;
  short: string;
  url: string;
  keyHint: string;
  defaultModel: string;
  docs: string;
}

export const providers: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    label: "Anthropic (Claude)",
    short: "Claude",
    url: "https://api.anthropic.com/v1/messages",
    keyHint: "sk-ant-…",
    defaultModel: "claude-sonnet-4-5",
    docs: "https://console.anthropic.com/",
  },
  openai: {
    label: "OpenAI (GPT)",
    short: "GPT",
    url: "https://api.openai.com/v1/responses",
    keyHint: "sk-…",
    defaultModel: "gpt-4.1",
    docs: "https://platform.openai.com/api-keys",
  },
  google: {
    label: "Google (Gemini)",
    short: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    keyHint: "AIza…",
    defaultModel: "gemini-2.5-flash",
    docs: "https://aistudio.google.com/apikey",
  },
};

export const providerIds = Object.keys(providers) as ProviderId[];

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
}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

function buildRequest(
  p: ProviderId,
  r: { model: string; key: string; system: string; prompt: string; maxTokens: number },
): { url: string; headers: Record<string, string>; body: unknown } {
  if (p === "anthropic")
    return {
      url: providers.anthropic.url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": r.key,
        "anthropic-version": "2023-06-01",
        // Required for direct browser/app calls; harmless elsewhere.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: r.model,
        max_tokens: r.maxTokens,
        system: r.system,
        messages: [{ role: "user", content: r.prompt }],
      },
    };
  if (p === "openai")
    return {
      url: providers.openai.url,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${r.key}` },
      body: { model: r.model, instructions: r.system, input: r.prompt, max_output_tokens: r.maxTokens, store: false },
    };
  return {
    url: providers.google.url.replace("{model}", encodeURIComponent(r.model)),
    headers: { "Content-Type": "application/json", "x-goog-api-key": r.key },
    body: {
      systemInstruction: { parts: [{ text: r.system }] },
      contents: [{ role: "user", parts: [{ text: r.prompt }] }],
      generationConfig: { maxOutputTokens: r.maxTokens },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extract(p: ProviderId, data: any): Completion {
  if (p === "anthropic")
    return {
      text: (data.content || [])
        .filter((x: any) => x.type === "text")
        .map((x: any) => x.text)
        .join("\n"),
      usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
      truncated: data.stop_reason === "max_tokens",
    };
  if (p === "openai")
    return {
      text:
        data.output_text ||
        (data.output || [])
          .flatMap((x: any) => x.content || [])
          .filter((x: any) => x.type === "output_text")
          .map((x: any) => x.text)
          .join("\n"),
      usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
      truncated: data.status === "incomplete",
    };
  const cand = data.candidates?.[0];
  return {
    text: (cand?.content?.parts || []).map((x: any) => x.text || "").join("\n"),
    usage: { input: data.usageMetadata?.promptTokenCount || 0, output: data.usageMetadata?.candidatesTokenCount || 0 },
    truncated: cand?.finishReason === "MAX_TOKENS",
  };
}

export async function complete(req: CompletionRequest, fetcher: Fetcher = fetch): Promise<Completion> {
  const spec = providers[req.provider];
  if (!spec) fail("Unsupported provider.");
  const built = buildRequest(req.provider, { ...req, maxTokens: req.maxTokens ?? 2500 });
  const timeout = AbortSignal.timeout(180000);
  let response: Response;
  try {
    response = await fetcher(built.url, {
      method: "POST",
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
    });
  } catch {
    return fail(req.signal?.aborted ? "Cancelled." : `${spec.label}: connection failed or timed out.`, 502);
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
            : "Check model access and quota.";
    fail(`${spec.label} returned HTTP ${response.status}. ${hint}`, 502);
  }
  const raw = await response.text();
  if (raw.length > 2000000) fail("Provider response exceeded limit.", 502);
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("Provider returned invalid JSON.", 502);
  }
  if (data.error) fail(`${spec.label} reported an error. Check key, model and quota.`, 502);
  const out = extract(req.provider, data);
  out.text = (out.text || "").trim();
  if (!out.text) fail(`${spec.label} returned no text.`, 502);
  return out;
}

// One tiny request to confirm a key works before it is saved.
export async function verify(c: { provider: ProviderId; model: string; key: string }, fetcher: Fetcher = fetch) {
  const r = await complete(
    { ...c, system: "Reply with the single word OK.", prompt: "Say OK.", maxTokens: 16 },
    fetcher,
  );
  return { ok: true, sample: r.text.slice(0, 40) };
}
