// Keeps a brief running when the user switches to another app or locks the phone.
//   Android: a foreground service ("Passfair agents are working" notification) keeps the run alive to the end.
//   iOS: the system grants a short background window (about 30 s); when it ends the run pauses cleanly and
//   resumes by itself, from the step it was on, as soon as Passfair is opened again.
import { Platform } from "react-native";

function lib(): any | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-background-actions").default;
  } catch {
    return null;
  }
}

let release: (() => void) | null = null;

/** Start background time for a run. `onExpire` fires on iOS when the system takes the time back. */
export async function holdBackground(onExpire: () => void): Promise<void> {
  const bg = lib();
  if (!bg || bg.isRunning()) return;
  try {
    bg.removeAllListeners?.("expiration");
    bg.on?.("expiration", onExpire);
    await bg.start(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
      {
        taskName: "passfair-run",
        taskTitle: "Passfair agents are working",
        taskDesc: "Your brief keeps running. Tap to watch.",
        taskIcon: { name: "ic_launcher", type: "mipmap" },
        linkingURI: "passfair://",
        foregroundServiceType: ["dataSync"],
      },
    );
  } catch {}
}

export async function releaseBackground(): Promise<void> {
  const bg = lib();
  release?.();
  release = null;
  try {
    if (bg?.isRunning()) await bg.stop();
  } catch {}
}

export { AUTO_RESUME_MS, shouldAutoResume } from "../core/resume";
