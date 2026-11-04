import assert from "node:assert/strict";
import { test } from "node:test";
import { createReferralClient, inviteLink, inviteMessage, parseInvite } from "../src/core/referral";

test("invite links: build and parse both forms", () => {
  assert.equal(inviteLink("ABC234"), "https://challenge.agentsfair.ai/passfair/i/ABC234");
  assert.match(inviteMessage("ABC234"), /invite code ABC234: https:\/\/challenge\.agentsfair\.ai\/passfair\/i\/ABC234/);
  assert.equal(parseInvite("passfair://invite?code=abc234"), "ABC234");
  assert.equal(parseInvite("https://challenge.agentsfair.ai/passfair/i/ABC234"), "ABC234");
  assert.equal(parseInvite("passfair://auth?code=xyz"), null, "the sign-in return is not an invite");
  assert.equal(parseInvite("https://evil.example/x"), null);
});

test("client: registers on first status, sends the install id, surfaces server errors", async () => {
  const calls: { url: string; body?: any }[] = [];
  let registered = false;
  const f = (async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes("/register")) {
      registered = true;
      return new Response(JSON.stringify({ code: "ABC234" }), { status: 200 });
    }
    if (url.includes("/status"))
      return registered
        ? new Response(JSON.stringify({ code: "ABC234", successful: 0 }), { status: 200 })
        : new Response(JSON.stringify({ error: "register first" }), { status: 409 });
    return new Response(JSON.stringify({ error: "You can't use your own invite code." }), { status: 400 });
  }) as any;
  const c = createReferralClient({ installId: async () => "a".repeat(32), platform: "ios", fetcher: f });
  const st = await c.status();
  assert.equal(st.code, "ABC234");
  assert.deepEqual(calls[1].body, { installId: "a".repeat(32), platform: "ios" });
  await assert.rejects(c.claim("ABC234"), /own invite code/);
});

test("invite message discloses the reward; the client has no cash or payout calls", () => {
  assert.match(inviteMessage("ABC234"), /I may get a free month\./);
  const c = createReferralClient({
    installId: async () => "a".repeat(32),
    platform: "ios",
    fetcher: (async () => new Response("{}")) as any,
  });
  assert.deepEqual(Object.keys(c).sort(), ["activate", "claim", "register", "status"]);
});
