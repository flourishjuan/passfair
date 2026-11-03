// App state: agents, jobs, the running loop, files, Pro, Muse relay. One hook, used by App.tsx.
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoAssign, panelOrder } from "../core/assign";
import { DEMO_BRAINSTORM_BRIEF } from "../core/brainstorm";
import { type Attachment, materialFrom } from "../core/material";
import { OPENROUTER_AGENTS, authUrl, codeFrom, exchangeCode, pkce } from "../core/oauth";
import {
  DEMO_BRIEF,
  type FeedbackSource,
  type Job,
  type PresetId,
  lastDeliverable,
  newJob,
  packageFor,
  reopenWithFeedback,
  runJob,
} from "../core/orchestrator";
import { LIMITS, type Tier, clamp } from "../core/plan";
import {
  type CustomAgent,
  type MediaItem,
  type ProviderId,
  allProviders,
  canSee,
  getProvider,
  mediaKind,
  setCustomAgents,
  validateCustom,
  verify,
} from "../core/providers";
import { createRelayClient } from "../core/relay";
import { type Connection, type Settings, jobs as jobStore, keys, settings as settingsStore } from "../store/storage";

export type Toast = (message: string) => void;
export { autoAssign };

const randomBytes = (n: number) => {
  try {
    return Crypto.getRandomBytes(n);
  } catch {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }
};

export function useStudio(toast: Toast, tier: Tier) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  const jobsRef = useRef<Job[]>([]);
  const settingsRef = useRef<Settings>({});
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef<string | null>(null);
  const mediaRef = useRef(new Map<string, MediaItem[]>());
  const limits = LIMITS[tier];

  const persistJobs = useCallback((xs: Job[]) => {
    jobsRef.current = xs;
    setJobs([...xs]);
    jobStore.save(xs).catch(() => {});
  }, []);
  const saveSettings = useCallback(async (patch: Settings) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await settingsStore.save(next);
  }, []);

  const refs = () =>
    Object.fromEntries((settingsRef.current.customAgents || []).map((a) => [a.id, a.keyRef])) as Record<
      string,
      string | undefined
    >;
  const reloadConnections = useCallback(async () => {
    setCustomAgents(settingsRef.current.customAgents || []);
    setConnections(
      await keys.list(
        allProviders().map((p) => p.id),
        refs(),
      ),
    );
  }, []);

  const relay = useMemo(
    () =>
      createRelayClient({
        getSettings: () => settingsRef.current,
        setSetting: (k, v) => saveSettings({ [k]: v }),
      }),
    [saveSettings],
  );

  useEffect(() => {
    (async () => {
      const [j, s] = await Promise.all([jobStore.load(), settingsStore.load()]);
      settingsRef.current = s;
      setSettings(s);
      await reloadConnections();
      jobsRef.current = j;
      setJobs(j);
      setReady(true);
    })();
  }, [reloadConnections]);

  const job = jobs.find((j) => j.id === jobId) || null;

  const upsert = useCallback(
    (j: Job) => {
      const xs = jobsRef.current;
      const i = xs.findIndex((x) => x.id === j.id);
      if (i >= 0) xs[i] = j;
      else xs.unshift(j);
      persistJobs(xs);
    },
    [persistJobs],
  );

  const connectedIds = connections.map((c) => c.provider);
  // The brainstorm panel: the agents picked in Team (or all connected), best seat first, within the plan limit.
  const panel = useMemo(() => {
    const chosen = (settings.panel || []).filter((p) => connectedIds.includes(p));
    return panelOrder(chosen.length ? chosen : connectedIds).slice(0, limits.agents);
  }, [settings.panel, connectedIds.join(","), limits.agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs a job in the foreground. The app must stay open; iOS suspends background JS.
  const run = useCallback(
    async (j: Job) => {
      if (runningRef.current) return toast("Wait for the current job to finish, or stop it.");
      runningRef.current = j.id;
      const ac = new AbortController();
      abortRef.current = ac;
      setJobId(j.id);
      const creds: Record<string, { provider: ProviderId; model: string; key: string }> = {};
      const r = refs();
      for (const p of allProviders()) {
        const c = await keys.get(p.id, r[p.id]);
        if (c) creds[p.id] = { provider: p.id, ...c };
      }
      try {
        await runJob(j, {
          save: (x) => upsert({ ...x, events: [...x.events] }),
          isCancelled: () => ac.signal.aborted,
          credential: (p) => creds[p] || null,
          signal: ac.signal,
          demoDelay: 650,
          media: mediaRef.current.get(j.id),
        });
        if (ac.signal.aborted) {
          j.status = "stopped";
          j.current = null;
          upsert({ ...j });
        } else if (j.status === "awaiting_review") {
          const auto = settingsRef.current.autoHandoff || "off";
          if (j.mode === "live" && (auto === "always" || (auto === "approved" && j.outcome === "approved_by_reviewer")))
            await handoff(j.id, true);
        }
      } catch (e: any) {
        j.status = "failed";
        j.current = null;
        j.error = e?.message || "Failed.";
        upsert({ ...j });
        toast(j.error!);
      } finally {
        runningRef.current = null;
        abortRef.current = null;
        setJobs([...jobsRef.current]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, upsert],
  );

  // Checks files against the plan and picks the agent that will look at them.
  function prepareFiles(files: Attachment[]) {
    const bin = files.filter((a) => a.base64);
    const images = bin.filter((a) => a.kind === "image").length;
    if (images > limits.images) throw new Error(`Up to ${limits.images} images per brief on your plan.`);
    if (!limits.pdf && bin.some((a) => a.kind === "pdf")) throw new Error("PDF reading is a Pro feature.");
    if (!limits.video && bin.some((a) => a.kind === "video" || a.kind === "audio"))
      throw new Error("Video and audio are Pro features.");
    if (!limits.office && files.some((a) => a.kind === "office"))
      throw new Error("Word, Excel and PowerPoint are Pro features.");
    const media: MediaItem[] = bin.map((a) => ({ name: a.name, mime: a.mime, base64: a.base64! }));
    let seer: ProviderId | undefined;
    if (media.length) {
      const needsVideo = media.some((m) => ["video", "audio"].includes(mediaKind(m.mime) || ""));
      const order = needsVideo ? ["google"] : ["anthropic", "openai", "google", "xai", ...connectedIds];
      seer = order.find((p) => connectedIds.includes(p) && media.every((m) => canSee(getProvider(p), m.mime)));
      if (!seer)
        throw new Error(
          needsVideo
            ? "To watch video or listen to audio, connect Gemini (••• → Agents)."
            : "To read images or PDFs, connect Claude, GPT or Gemini (••• → Agents).",
        );
    }
    return { media, seer, context: materialFrom(files) };
  }

  const start = useCallback(
    async (goal: string, opts: { demo?: boolean; files?: Attachment[] } = {}) => {
      const flow = settingsRef.current.flow || "brainstorm";
      if (opts.demo) {
        const j = newJob({
          goal: flow === "brainstorm" ? DEMO_BRAINSTORM_BRIEF : DEMO_BRIEF,
          mode: "demo",
          preset: "make_and_ship",
          flow,
          panel: ["demo", "demo"],
          debateRounds: 1,
          minRounds: 2,
          maxRounds: 3,
          assignments: autoAssign("make_and_ship", []),
        });
        upsert(j);
        await run(j);
        return j;
      }
      // A real brief is never answered by the scripted demo: no connected agent means no run.
      if (!connectedIds.length) throw new Error("Connect an agent first: tap ••• at the top left.");
      const files = opts.files || [];
      const { media, seer, context } = prepareFiles(files);
      const s = settingsRef.current;
      const preset = (s.preset as PresetId) || "make_and_ship";
      const research =
        limits.research && s.research
          ? connectedIds.includes("perplexity")
            ? "perplexity"
            : connectedIds.find((p) => getProvider(p)?.search === "tool")
          : undefined;
      const team = flow === "brainstorm" ? panel : connectedIds;
      const j = newJob({
        goal,
        context,
        mode: "live",
        preset,
        flow,
        panel: flow === "brainstorm" ? panel : undefined,
        debateRounds: clamp(tier, "debateRounds", s.debateRounds || 2),
        assignments: autoAssign(preset, team),
        maxRounds: clamp(tier, "maxBuildRounds", s.maxRounds || 4),
        minRounds: Math.min(s.minRounds || 2, clamp(tier, "maxBuildRounds", s.maxRounds || 4)),
        researcher: research,
        seer,
        attachments: files.map((a) => ({ name: a.name, mime: a.mime, kind: a.kind, chars: a.text?.length })),
      });
      if (media.length) mediaRef.current.set(j.id, media);
      upsert(j);
      await run(j);
      return j;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectedIds.join(","), panel, run, upsert, tier],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const feedback = useCallback(
    async (id: string, problem: string, source: FeedbackSource) => {
      const j = jobsRef.current.find((x) => x.id === id);
      if (!j) return;
      if (j.mode === "demo") return toast("That was the scripted demo. Connect an agent and send a real brief.");
      if (!["awaiting_review", "accepted", "stopped", "failed", "delivered", "published"].includes(j.status))
        return toast("Finish or stop the job first.");
      // Drop a half-finished round (not every reviewer answered) so the Worker starts from the last reviewed draft.
      const lastWorker = j.events.map((e) => e.role).lastIndexOf("worker");
      const lastRound = lastWorker >= 0 ? j.events[lastWorker].round : 0;
      if (lastWorker >= 0 && !(j.rounds || []).some((r) => r.round === lastRound))
        j.events = j.events.slice(0, lastWorker);
      reopenWithFeedback(j, source, problem);
      upsert({ ...j });
      await run(j);
    },
    [run, toast, upsert],
  );

  // Cut in: stop the current run and resume with the user's instruction as the top-priority issue.
  const cutIn = useCallback(
    async (instruction: string) => {
      const j = jobsRef.current.find((x) => x.id === runningRef.current);
      if (!j) return;
      abortRef.current?.abort();
      if (j.mode === "demo") return toast("Demo stopped. Connect an agent to give the team real instructions.");
      while (runningRef.current) await new Promise((r) => setTimeout(r, 50));
      await feedback(j.id, instruction, "you");
    },
    [feedback, toast],
  );

  const accept = useCallback(
    (id: string) => {
      const j = jobsRef.current.find((x) => x.id === id);
      if (!j) return;
      j.status = "accepted";
      upsert({ ...j });
    },
    [upsert],
  );
  const remove = useCallback(
    (id: string) => {
      persistJobs(jobsRef.current.filter((x) => x.id !== id));
      mediaRef.current.delete(id);
      if (jobId === id) setJobId(null);
    },
    [jobId, persistJobs],
  );

  /* ---------- agents ---------- */
  const connect = useCallback(
    async (provider: ProviderId, model: string, key: string) => {
      await verify({ provider, model, key });
      await keys.save(provider, model, key);
      await reloadConnections();
    },
    [reloadConnections],
  );
  const disconnect = useCallback(
    async (provider: ProviderId) => {
      const ref = refs()[provider];
      if (ref) await keys.setModel(provider, "");
      else await keys.remove(provider);
      await reloadConnections();
    },
    [reloadConnections],
  );
  const setModel = useCallback(
    async (provider: ProviderId, model: string) => {
      await keys.setModel(provider, model);
      await reloadConnections();
    },
    [reloadConnections],
  );
  const addCustom = useCallback(
    async (a: CustomAgent, key: string) => {
      if (!limits.customAgents) throw new Error("Custom agents are a Pro feature.");
      const err = validateCustom(a);
      if (err) throw new Error(err);
      const list = [...(settingsRef.current.customAgents || []).filter((x) => x.id !== a.id), a];
      setCustomAgents(list);
      await verify({ provider: a.id, model: a.model, key });
      await saveSettings({ customAgents: list });
      await keys.save(a.id, a.model, key);
      await reloadConnections();
    },
    [limits.customAgents, reloadConnections, saveSettings],
  );
  const removeCustom = useCallback(
    async (id: string) => {
      await keys.remove(id);
      await saveSettings({ customAgents: (settingsRef.current.customAgents || []).filter((x) => x.id !== id) });
      await reloadConnections();
    },
    [reloadConnections, saveSettings],
  );
  // One login in the browser; the key comes back by itself and adds Claude, GPT, Grok, Gemini … via OpenRouter.
  const signInOpenRouter = useCallback(async () => {
    const { verifier, challenge } = pkce(randomBytes);
    const callback = Linking.createURL("auth");
    const res = await WebBrowser.openAuthSessionAsync(authUrl(callback, challenge), callback);
    if (res.type !== "success") return false;
    const code = codeFrom(res.url);
    if (!code) throw new Error("OpenRouter did not return a sign-in code.");
    const key = await exchangeCode(code, verifier);
    await keys.save("openrouter", "anthropic/claude-sonnet-4.5", key);
    const managed: CustomAgent[] = OPENROUTER_AGENTS.map((a) => ({
      id: a.id,
      name: a.name,
      brand: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      style: "openai-chat",
      model: a.model,
      color: a.color,
      keyRef: "openrouter",
      managed: true,
    }));
    const others = (settingsRef.current.customAgents || []).filter((x) => !x.managed);
    await saveSettings({ customAgents: [...others, ...managed] });
    for (const a of managed) await keys.setModel(a.id, a.model);
    await reloadConnections();
    return true;
  }, [reloadConnections, saveSettings]);

  /* ---------- Muse ---------- */
  async function handoff(id: string, auto = false): Promise<{ delivered: boolean; package?: string }> {
    const j = jobsRef.current.find((x) => x.id === id);
    if (!j || j.mode === "demo") return { delivered: false };
    if (!relay.configured() || settingsRef.current.relay_paired !== "1") {
      if (auto) return { delivered: false };
      return { delivered: false, package: packageFor(j) };
    }
    const d = await relay.deliver({
      jobId: j.id,
      version: j.version || 1,
      title: j.goal.slice(0, 120),
      content: j.final || lastDeliverable(j),
      format: "markdown",
      outcome: j.outcome,
      orderId: j.origin?.orderId || null,
    });
    j.status = "delivered";
    j.handoffs.push({ deliverableId: d.deliverableId, version: j.version || 1, at: new Date().toISOString(), auto });
    j.events.push({
      role: "handoff",
      round: j.events.filter((e) => e.role === "worker").length,
      provider: "relay",
      model: "muse",
      text: `Handed off to Muse · deliverable ${d.deliverableId.slice(0, 8)} · v${j.version || 1}`,
      usage: { input: 0, output: 0 },
      at: new Date().toISOString(),
    });
    upsert({ ...j });
    return { delivered: true };
  }

  // Poll the relay for Muse orders, publishing problems and "published" confirmations.
  const pollRelay = useCallback(async () => {
    if (!relay.configured()) return;
    let inbox;
    try {
      inbox = await relay.inbox();
    } catch {
      return;
    }
    await saveSettings({ relay_paired: inbox.paired ? "1" : "0" });
    const done = { orders: [] as string[], issues: [] as string[], published: [] as string[] };
    for (const o of inbox.orders || []) {
      if (runningRef.current) break;
      if (!connectedIds.length) break; // leave Muse orders queued until an agent is connected
      const j = newJob({
        goal: o.brief,
        context: o.context || "",
        mode: "live",
        preset: "make_and_ship",
        flow: settingsRef.current.flow || "brainstorm",
        panel,
        assignments: autoAssign("make_and_ship", panel.length ? panel : connectedIds),
        maxRounds: clamp(tier, "maxBuildRounds", settingsRef.current.maxRounds || 4),
        debateRounds: clamp(tier, "debateRounds", settingsRef.current.debateRounds || 2),
        origin: { source: "muse", orderId: o.id },
      });
      upsert(j);
      done.orders.push(o.id);
      run(j).catch(() => {});
    }
    for (const i of inbox.issues || []) {
      const j = jobsRef.current.find((x) => x.id === i.jobId);
      if (!j) {
        done.issues.push(i.id);
        continue;
      }
      if (runningRef.current) continue;
      done.issues.push(i.id);
      feedback(j.id, i.problem, "muse").catch(() => {});
    }
    for (const p of inbox.published || []) {
      const j = jobsRef.current.find((x) => x.id === p.jobId);
      if (j) {
        j.status = "published";
        j.events.push({
          role: "published",
          round: j.events.filter((e) => e.role === "worker").length,
          provider: "muse",
          model: "external",
          text: p.where || "Published by Muse",
          usage: { input: 0, output: 0 },
          at: new Date().toISOString(),
        });
        upsert({ ...j });
      }
      done.published.push(p.id);
    }
    if (done.orders.length || done.issues.length || done.published.length) await relay.ack(done).catch(() => {});
  }, [connectedIds.join(","), feedback, panel, relay, run, saveSettings, tier, upsert]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !settings.relay_token) return;
    const t = setInterval(() => pollRelay().catch(() => {}), 30000);
    pollRelay().catch(() => {});
    return () => clearInterval(t);
  }, [ready, settings.relay_token, pollRelay]);

  return {
    ready,
    tier,
    limits,
    connections,
    panel,
    jobs,
    job,
    jobId,
    setJobId,
    runningId: runningRef.current,
    settings,
    saveSettings,
    relay,
    start,
    stop,
    cutIn,
    feedback,
    accept,
    remove,
    connect,
    disconnect,
    setModel,
    addCustom,
    removeCustom,
    signInOpenRouter,
    handoff,
    resume: run,
  };
}
