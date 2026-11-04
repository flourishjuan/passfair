// Which paused run picks up again by itself when Passfair comes back to the foreground.
/** A run paused this way (or by the app being closed) resumes automatically within this window. */
export const AUTO_RESUME_MS = 6 * 60 * 60 * 1000;

export function shouldAutoResume(
  j: { status: string; error?: string; events: { at: string }[]; created: string; mode: string },
  now = Date.now(),
): boolean {
  if (j.mode !== "live" || j.status !== "stopped" || j.error !== "interrupted") return false;
  const last = j.events.length ? j.events[j.events.length - 1].at : j.created;
  return now - Date.parse(last) < AUTO_RESUME_MS;
}
