// Reporting AI-generated content from inside the app (Google Play's AI-generated content policy; useful on iOS too).
// The report is built on the phone and sent through the system share sheet — no account, no server of ours.
import type { Job, JobEvent } from "./orchestrator";

export const REPORT_REASONS = [
  { id: "offensive", label: "Offensive or hateful" },
  { id: "harmful", label: "Harmful or dangerous" },
  { id: "sexual", label: "Sexual content" },
  { id: "false", label: "False or misleading" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export function reportText(
  job: Job,
  e: JobEvent | null,
  reason: ReportReason,
  note: string,
  appVersion: string,
): string {
  const label = REPORT_REASONS.find((r) => r.id === reason)?.label || reason;
  const who = e
    ? `${e.provider}${e.model ? ` (${e.model})` : ""} · ${e.stage || e.role}${e.round ? ` · round ${e.round}` : ""}`
    : "final result";
  const excerpt = (e ? e.text : job.final || "").slice(0, 1200);
  return [
    "Passfair content report",
    `Reason: ${label}`,
    `Content from: ${who}`,
    `Job: ${job.id.slice(0, 8)} · ${new Date().toISOString()} · app ${appVersion}`,
    note.trim() ? `Note: ${note.trim().slice(0, 1000)}` : "",
    "",
    "Reported text (excerpt):",
    excerpt,
  ]
    .filter((x) => x !== "")
    .join("\n");
}
