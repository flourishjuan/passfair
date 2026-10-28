// App state: connections, jobs, the running loop, Muse relay. One hook, used by App.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Assignments,
  type FeedbackSource,
  type Job,
  type PresetId,
  lastDeliverable,
  newJob,
  packageFor,
  presets,
  reopenWithFeedback,
  runJob,
} from "../core/orchestrator";
import { type ProviderId, providerIds, verify } from "../core/providers";
import { createRelayClient } from "../core/relay";
import { type Connection, type Settings, jobs as jobStore, keys, settings as settingsStore } from "../store/storage";

export type Toast = (message: string) => void;

import { autoAssign } from "../core/assign";
export { autoAssign };

export function useStudio(toast: Toast) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  const jobsRef = useRef<Job[]>([]);
  const settingsRef = useRef<Settings>({});
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef<string | null>(null);

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
      const [c, j, s] = await Promise.all([keys.list(providerIds), jobStore.load(), settingsStore.load()]);
      setConnections(c);
      jobsRef.current = j;
      setJobs(j);
      settingsRef.current = s;
      setSettings(s);
      setReady(true);
    })();
  }, []);

  const job = jobs.find((j) => j.id === jobId) || null;
  const active = !!runningRef.current;

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

  // Runs a job in the foreground. The app must stay open; iOS suspends background JS.
  const run = useCallback(
    async (j: Job) => {
      if (runningRef.current) return toast("Wait for the current job to finish, or stop it.");
      runningRef.current = j.id;
      const ac = new AbortController();
      abortRef.current = ac;
      setJobId(j.id);
      const creds: Record<string, { provider: ProviderId; model: string; key: string }> = {};
      for (const p of providerIds) {
        const c = await keys.get(p);
        if (c) creds[p] = { provider: p, ...c };
      }
      try {
        await runJob(j, {
          save: (x) => upsert({ ...x, events: [...x.events] }),
          isCancelled: () => ac.signal.aborted,
          credential: (p) => creds[p] || null,
          signal: ac.signal,
          demoDelay: 700,
        });
        if (ac.signal.aborted) {
          j.status = "stopped";
          j.current = null;
          upsert({ ...j });
        } else if (j.status === "awaiting_review") {
          const auto = settingsRef.current.autoHandoff || "off";
          if (auto === "always" || (auto === "approved" && j.outcome === "approved_by_reviewer"))
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

  const start = useCallback(
    async (goal: string, opts: { seed?: string; context?: string; live: boolean }) => {
      const preset = (settingsRef.current.preset as PresetId) || "make_and_ship";
      const connected = connections.map((c) => c.provider);
      const live = opts.live && connected.length > 0;
      const j = newJob({
        goal,
        seed: opts.seed,
        context: opts.context,
        mode: live ? "live" : "demo",
        preset,
        assignments: autoAssign(preset, live ? connected : []),
        maxRounds: settingsRef.current.maxRounds || 3,
      });
      upsert(j);
      await run(j);
      return j;
    },
    [connections, run, upsert],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Cut in: stop the current run and resume with the user's instruction as the top-priority issue.
  const cutIn = useCallback(
    async (instruction: string) => {
      const j = jobsRef.current.find((x) => x.id === runningRef.current);
      if (!j) return;
      abortRef.current?.abort();
      // Wait until the loop has exited, then continue.
      while (runningRef.current) await new Promise((r) => setTimeout(r, 50));
      await feedback(j.id, instruction, "you");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const feedback = useCallback(
    async (id: string, problem: string, source: FeedbackSource) => {
      const j = jobsRef.current.find((x) => x.id === id);
      if (!j) return;
      if (!["awaiting_review", "accepted", "stopped", "failed", "delivered", "published"].includes(j.status))
        return toast("Finish or stop the job first.");
      // Drop a half-finished round so the Worker starts from the last reviewed draft.
      const workers = j.events.filter((e) => e.role === "worker").length;
      const reviewers = j.events.filter((e) => e.role === "reviewer").length;
      if (workers > reviewers) {
        const i = j.events.map((e) => e.role).lastIndexOf("worker");
        j.events = j.events.slice(0, i);
      }
      reopenWithFeedback(j, source, problem);
      upsert({ ...j });
      await run(j);
    },
    [run, toast, upsert],
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
      if (jobId === id) setJobId(null);
    },
    [jobId, persistJobs],
  );

  const connect = useCallback(async (provider: ProviderId, model: string, key: string) => {
    await verify({ provider, model, key });
    await keys.save(provider, model, key);
    setConnections(await keys.list(providerIds));
  }, []);
  const disconnect = useCallback(async (provider: ProviderId) => {
    await keys.remove(provider);
    setConnections(await keys.list(providerIds));
  }, []);

  async function handoff(id: string, auto = false): Promise<{ delivered: boolean; package?: string }> {
    const j = jobsRef.current.find((x) => x.id === id);
    if (!j) return { delivered: false };
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
      const connected = connections.map((c) => c.provider);
      const j = newJob({
        goal: o.brief,
        context: o.context || "",
        mode: connected.length ? "live" : "demo",
        preset: "make_and_ship",
        assignments: autoAssign("make_and_ship", connected),
        maxRounds: settingsRef.current.maxRounds || 3,
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
  }, [connections, feedback, relay, run, saveSettings, upsert]);

  useEffect(() => {
    if (!ready || !settings.relay_token) return;
    const t = setInterval(() => pollRelay().catch(() => {}), 30000);
    pollRelay().catch(() => {});
    return () => clearInterval(t);
  }, [ready, settings.relay_token, pollRelay]);

  return {
    ready,
    connections,
    jobs,
    job,
    jobId,
    setJobId,
    active,
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
    handoff,
    resume: run,
  };
}
