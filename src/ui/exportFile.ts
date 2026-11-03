// Export the final deliverable as a file and hand it to the system share sheet (save to Files, WeChat, mail…).
// Everything happens on the device: no model, no network. On the web preview the file downloads instead.
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { type ExportFormat, formats, toDocx, toHtml, toPptx } from "../core/export";
import { type Job, lastDeliverable } from "../core/orchestrator";

export type { ExportFormat };
export type ExportChoice = ExportFormat | "record";
export const exportOrder: ExportChoice[] = ["pdf", "docx", "pptx", "md", "record"];
export const exportLabel: Record<ExportChoice, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  md: "Markdown",
  record: "Full record",
};

// The whole conversation — frame, every idea, the debate, decision, drafts and reviews — as one Markdown file.
export function recordOf(job: Job): string {
  const lines = [
    `# ${job.goal}`,
    "",
    `Passfair · ${new Date(job.created).toLocaleString()} · ${job.flow || "build"}`,
    "",
  ];
  for (const e of job.events) {
    const head = [
      e.stage || e.role,
      e.round ? `round ${e.round}` : "",
      e.provider,
      e.model,
      e.lens ? `lens: ${e.lens}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`## ${head}`, "", e.review ? "```json\n" + JSON.stringify(e.review, null, 2) + "\n```" : e.text, "");
    if (e.notes) lines.push("**What changed:**", "", e.notes, "");
  }
  lines.push("## Final", "", job.final || lastDeliverable(job));
  return lines.join("\n");
}

export function exportMeta(job: Job) {
  const approved = job.outcome === "approved_by_reviewer";
  return {
    title: job.goal.slice(0, 80) || "Passfair deliverable",
    creator: "Passfair",
    footer: `Made with Passfair · ${approved ? (job.assignments.verifier ? "approved by both reviewers" : "reviewer approved") : "read critically"} · v${job.version || 1}`,
    filename: `passfair-${job.id.slice(0, 8)}`,
  };
}

export async function exportJob(job: Job, choice: ExportChoice): Promise<void> {
  if (job.mode === "demo") throw new Error("The demo is a scripted sample, not your work — nothing to export.");
  const format: ExportFormat = choice === "record" ? "md" : choice;
  const text = choice === "record" ? recordOf(job) : job.final || lastDeliverable(job);
  if (!text) throw new Error("Nothing to export yet.");
  const meta = {
    ...exportMeta(job),
    ...(choice === "record" ? { filename: `${exportMeta(job).filename}-record` } : {}),
  };
  const f = formats[format];
  const name = `${meta.filename}.${f.ext}`;

  if (Platform.OS === "web") {
    if (format === "pdf") {
      const w = window.open("", "_blank");
      if (!w) throw new Error("Allow pop-ups to save as PDF.");
      w.document.write(toHtml(text, meta));
      w.document.close();
      return;
    }
    const bytes = format === "docx" ? toDocx(text, meta) : format === "pptx" ? toPptx(text, meta) : text;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: f.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }

  let uri: string;
  if (format === "pdf") {
    // The system renderer handles Chinese and other scripts with the phone's own fonts.
    const out = await Print.printToFileAsync({ html: toHtml(text, { ...meta, bare: true }) });
    uri = out.uri;
  } else {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(format === "docx" ? toDocx(text, meta) : format === "pptx" ? toPptx(text, meta) : text);
    uri = file.uri;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(uri, { mimeType: f.mime, UTI: f.uti, dialogTitle: `Export as ${f.label}` });
}
