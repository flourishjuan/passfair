// Passfair ↔ Handoff Relay client. The relay (hosted by Agents Fair) is the public mailbox that lets
// the user's own Muse place briefs, collect finished deliverables and report publishing problems.
// The phone polls it; nothing is pushed into the phone. API keys never travel here. Content travels
// only when a deliverable is handed off.
import { fail, type Fetcher } from "./providers";

export const DEFAULT_RELAY = "https://challenge.agentsfair.ai";

export interface RelaySettings {
  relay_url?: string;
  relay_token?: string;
  relay_code?: string;
  relay_paired?: "0" | "1" | "";
}
export interface RelayInbox {
  paired: boolean;
  orders?: { id: string; brief: string; context?: string }[];
  issues?: { id: string; jobId: string; problem: string }[];
  published?: { id: string; jobId: string; where?: string }[];
}

export function createRelayClient(opts: {
  getSettings: () => RelaySettings;
  setSetting: (k: keyof RelaySettings, v: string) => void | Promise<void>;
  fetcher?: Fetcher;
}) {
  const fetcher = opts.fetcher ?? fetch;
  const base = () => (opts.getSettings().relay_url || DEFAULT_RELAY).replace(/\/$/, "");
  const token = () => opts.getSettings().relay_token || "";
  async function call(path: string, method = "GET", body?: unknown) {
    const t = token();
    if (!t && path !== "/relay-api/pair") fail("Passfair is not paired with the relay yet.", 409);
    let r: Response;
    try {
      r = await fetcher(base() + path, {
        method,
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return fail("Relay unreachable. Check your internet connection.", 502);
    }
    let d: any = {};
    try {
      d = await r.json();
    } catch {}
    if (!r.ok) fail(d.error || `Relay returned HTTP ${r.status}.`, r.status === 401 ? 401 : 502);
    return d;
  }
  return {
    async pair(): Promise<{ code: string; expires: string }> {
      const d = await call("/relay-api/pair", "POST", { client: "passfair-mobile" });
      await opts.setSetting("relay_token", d.studioToken);
      await opts.setSetting("relay_code", d.code);
      await opts.setSetting("relay_paired", "0");
      return { code: d.code, expires: d.expires };
    },
    async status(): Promise<{ paired: boolean }> {
      const d = await call("/relay-api/studio/status");
      await opts.setSetting("relay_paired", d.paired ? "1" : "0");
      return d;
    },
    async unpair() {
      try {
        await call("/relay-api/studio/unpair", "POST", {});
      } catch {}
      for (const k of ["relay_token", "relay_code", "relay_paired"] as const) await opts.setSetting(k, "");
    },
    inbox: (): Promise<RelayInbox> => call("/relay-api/studio/inbox"),
    ack: (ids: { orders: string[]; issues: string[]; published: string[] }) =>
      call("/relay-api/studio/ack", "POST", ids),
    deliver: (payload: {
      jobId: string;
      version: number;
      title: string;
      content: string;
      format: "markdown";
      outcome: string | null;
      orderId: string | null;
    }): Promise<{ deliverableId: string }> => call("/relay-api/studio/deliver", "POST", payload),
    configured: () => !!token(),
  };
}
