// Persistence. API keys go to the device keychain (expo-secure-store); jobs and settings go to
// AsyncStorage. On web (the browser demo) SecureStore is unavailable, so keys fall back to
// localStorage and the UI says so.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Job } from "../core/orchestrator";
import { type CustomAgent, type ProviderId, safeName } from "../core/providers";
import type { RelaySettings } from "../core/relay";

const JOBS = "passfair.jobs.v1";
const SETTINGS = "passfair.settings.v1";
// Keychain names allow only letters, digits, ".", "-" and "_" — agent ids like "custom:acme" are made safe here.
const KEY = (p: string) => `passfair.key.${safeName(p)}`;
const MODEL = (p: string) => `passfair.model.${safeName(p)}`;

export const secureAvailable = Platform.OS !== "web";

async function secureSet(k: string, v: string) {
  if (secureAvailable)
    return SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  try {
    globalThis.localStorage?.setItem(k, v);
  } catch {}
}
async function secureGet(k: string): Promise<string | null> {
  if (secureAvailable) return SecureStore.getItemAsync(k);
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
async function secureDel(k: string) {
  if (secureAvailable) return SecureStore.deleteItemAsync(k);
  try {
    globalThis.localStorage?.removeItem(k);
  } catch {}
}

export interface Connection {
  provider: ProviderId;
  model: string;
}
// Agents created by a sign-in share one key (keyRef). Their own model is stored under their id.

export const keys = {
  async save(provider: ProviderId, model: string, key: string) {
    await secureSet(KEY(provider), key);
    await AsyncStorage.setItem(MODEL(provider), model);
  },
  async remove(provider: ProviderId) {
    await secureDel(KEY(provider));
    await AsyncStorage.removeItem(MODEL(provider));
  },
  async get(provider: ProviderId, keyRef?: string): Promise<{ model: string; key: string } | null> {
    const [key, model] = await Promise.all([secureGet(KEY(keyRef || provider)), AsyncStorage.getItem(MODEL(provider))]);
    return key && model ? { key, model } : null;
  },
  async saveKeyOnly(ref: string, key: string) {
    await secureSet(KEY(ref), key);
  },
  async setModel(provider: ProviderId, model: string) {
    await AsyncStorage.setItem(MODEL(provider), model);
  },
  async list(ids: ProviderId[], refs: Record<string, string | undefined> = {}): Promise<Connection[]> {
    const out: Connection[] = [];
    for (const p of ids) {
      const c = await this.get(p, refs[p]);
      if (c) out.push({ provider: p, model: c.model });
    }
    return out;
  },
};

export interface Settings extends RelaySettings {
  preset?: string;
  maxRounds?: number;
  minRounds?: number;
  autoHandoff?: "off" | "approved" | "always";
  seenWelcome?: boolean;
  flow?: "brainstorm" | "build";
  /** Agents chosen for the panel, in seat order. Empty = all connected, up to the plan limit. */
  panel?: ProviderId[];
  debateRounds?: number;
  research?: boolean;
  customAgents?: CustomAgent[];
  pro?: { active: boolean; checked: string };
}

export const settings = {
  async load(): Promise<Settings> {
    try {
      return JSON.parse((await AsyncStorage.getItem(SETTINGS)) || "{}");
    } catch {
      return {};
    }
  },
  async save(s: Settings) {
    await AsyncStorage.setItem(SETTINGS, JSON.stringify(s));
  },
};

export const jobs = {
  async load(): Promise<Job[]> {
    try {
      const xs: Job[] = JSON.parse((await AsyncStorage.getItem(JOBS)) || "[]");
      // Anything left "running" when the app was killed is resumable, not running.
      for (const j of xs) if (j.status === "running") j.status = "stopped";
      return xs;
    } catch {
      return [];
    }
  },
  async save(xs: Job[]) {
    await AsyncStorage.setItem(JOBS, JSON.stringify(xs.slice(0, 200)));
  },
  async wipe() {
    await AsyncStorage.removeItem(JOBS);
  },
};
