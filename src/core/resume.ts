// Which paused run picks up again by itself when Passfair comes back to the foreground.
/** A run paused this way (or by the app being closed) resumes automatically within this window. */
export const AUTO_RESUME_MS = 6 * 60 * 60 * 1000;

/** Stopped states that resume by themselves: paused by the system, or paused mid-round by a reviewer outage. */
export const RESUMABLE_ERRORS = ["interrupted", "review_paused"];

/** A reviewer-outage pause retries the review step on every automatic resume, and each retry is a real
 *  reviewer API call. Automatic retries are therefore bounded: after this many attempts the run waits for
 *  an explicit tap on Resume instead of retrying by itself. */
export const AUTO_RESUME_MAX_ATTEMPTS = 3;

/** Minimum gap between automatic review retries, so reopening Passfair repeatedly within the resume
 *  window cannot fire a paid reviewer call every time. */
export const AUTO_RESUME_COOLDOWN_MS = 30 * 60 * 1000;

export function shouldAutoResume(
  j: {
    status: string;
    error?: string;
    events: { at: string }[];
    created: string;
    mode: string;
    autoResumeAttempts?: number;
    lastAutoResumeAt?: string;
  },
  now = Date.now(),
): boolean {
  if (j.mode !== "live" || j.status !== "stopped" || !RESUMABLE_ERRORS.includes(j.error || "")) return false;
  const last = j.events.length ? j.events[j.events.length - 1].at : j.created;
  if (now - Date.parse(last) >= AUTO_RESUME_MS) return false;
  if (j.error === "review_paused") {
    if ((j.autoResumeAttempts ?? 0) >= AUTO_RESUME_MAX_ATTEMPTS) return false;
    if (j.lastAutoResumeAt && now - Date.parse(j.lastAutoResumeAt) < AUTO_RESUME_COOLDOWN_MS) return false;
  }
  return true;
}
