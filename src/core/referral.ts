// Invite friends → every 3 friends who finish a first real brief = one free month of Pro (a store code). No cash. Talks to the Passfair referral service.
// The install id is a random secret kept in the keychain; the invite code is the public part people share.
// A friend counts only after they enter the code and finish their first real brief (never for a bare install).
import { fail, type Fetcher } from "./providers";
import { DEFAULT_RELAY } from "./relay";

export interface ReferralStatus {
  code: string;
  perReward: number;
  invited: number;
  successful: number;
  towardNext: number;
  usedCode: string | null;
  maxPerYear: number;
  rewards: { platform: "ios" | "android"; code: string | null; issued: string; url: string | null }[];
}

export const inviteLink = (code: string, base = DEFAULT_RELAY) => `${base.replace(/\/$/, "")}/passfair/i/${code}`;
export const inviteMessage = (code: string) =>
  `I use Passfair — my AI agents brainstorm, debate and cross-check each other. Try it with my invite code ${code}: ${inviteLink(code)} (I may get a free month.)`;

// Invite code from passfair://invite?code=X or https://…/passfair/i/X (anything else → null).
export function parseInvite(url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    url.match(/^passfair:\/\/invite\?(?:.*&)?code=([A-Za-z0-9]{4,12})/) ||
    url.match(/\/passfair\/i\/([A-Za-z0-9]{4,12})\/?(?:[?#].*)?$/);
  return m ? m[1].toUpperCase() : null;
}

export function createReferralClient(o: {
  installId: () => Promise<string>;
  platform: string;
  base?: string;
  fetcher?: Fetcher;
}) {
  const fetcher = o.fetcher ?? fetch;
  const base = (o.base || DEFAULT_RELAY).replace(/\/$/, "");
  async function call(path: string, body?: object) {
    const id = await o.installId();
    let r: Response;
    try {
      r = await fetcher(
        body ? `${base}/referral-api/${path}` : `${base}/referral-api/${path}?installId=${encodeURIComponent(id)}`,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ installId: id, ...body }),
            }
          : { method: "GET" },
      );
    } catch {
      return fail("Invites are unreachable right now. Check your connection.", 502);
    }
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) fail(data?.error || `Invites returned HTTP ${r.status}.`, r.status);
    return data;
  }
  return {
    async status(): Promise<ReferralStatus> {
      try {
        return await call("status");
      } catch (e: any) {
        if (e?.status !== 409) throw e;
        await call("register", { platform: o.platform });
        return await call("status");
      }
    },
    register: () => call("register", { platform: o.platform }),
    claim: (code: string) => call("claim", { code }),
    activate: () => call("activate", {}),
  };
}
