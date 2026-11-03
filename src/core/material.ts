// Turns uploaded files and links into material the agents can read. Pure functions, no network, no native code.
// Text-like files are read as text; Word / Excel / PowerPoint are unzipped and stripped to text;
// images, PDFs, video and audio are passed to an agent that can see them (see providers.canSee).
import { unzipSync } from "fflate";

export type AttachKind = "text" | "office" | "image" | "pdf" | "video" | "audio" | "link" | "unsupported";
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: AttachKind;
  size: number;
  text?: string; // extracted text (text, office, link)
  base64?: string; // binary for agents that can see it (image, pdf, video, audio)
}

const EXT_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  js: "text/javascript",
  ts: "text/plain",
  py: "text/x-python",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};
export const ext = (name: string) => (name.split(".").pop() || "").toLowerCase();
export function mimeFor(name: string, given?: string | null): string {
  const g = (given || "").toLowerCase();
  if (g && g !== "application/octet-stream") return g === "image/jpg" ? "image/jpeg" : g;
  return EXT_MIME[ext(name)] || "application/octet-stream";
}
export function kindOf(name: string, mime: string): AttachKind {
  const e = ext(name);
  if (["docx", "xlsx", "pptx"].includes(e)) return "office";
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) return "image";
  if (/^video\//.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  if (/^text\//.test(mime) || /json|xml|yaml|javascript/.test(mime) || EXT_MIME[e]?.startsWith("text/")) return "text";
  return "unsupported";
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
const tidy = (s: string) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  return { title, text: tidy(decodeEntities(body)) };
}

const xmlText = (xml: string, paraTag: RegExp) =>
  tidy(
    decodeEntities(
      xml
        .replace(paraTag, "\n")
        .replace(/<w:tab\/>|<a:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, ""),
    ),
  );

export function officeToText(bytes: Uint8Array, name: string): string {
  const files = unzipSync(bytes);
  const dec = new TextDecoder();
  const read = (p: string) => (files[p] ? dec.decode(files[p]) : "");
  const e = ext(name);
  if (e === "docx") return xmlText(read("word/document.xml"), /<\/w:p>/g);
  if (e === "pptx") {
    const slides = Object.keys(files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    return slides.map((p, i) => `## Slide ${i + 1}\n${xmlText(read(p), /<\/a:p>/g)}`).join("\n\n");
  }
  if (e === "xlsx") {
    const shared = Array.from(read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) =>
      decodeEntities(m[1].replace(/<[^>]+>/g, "")),
    );
    const sheets = Object.keys(files)
      .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
      .sort();
    return sheets
      .map((p, i) => {
        const rows = Array.from(read(p).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map((r) =>
          Array.from(r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g))
            .map((c) => {
              const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
              return /t="s"/.test(c[1]) ? (shared[Number(v)] ?? "") : decodeEntities(v);
            })
            .join("\t"),
        );
        return `## Sheet ${i + 1}\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  return "";
}

// All text-like attachments as one material block for the agents (capped so a huge file cannot crowd out the brief).
export function materialFrom(items: Attachment[], cap = 60000): string {
  const parts: string[] = [];
  let used = 0;
  for (const a of items) {
    if (!a.text) continue;
    const room = Math.max(0, cap - used);
    if (!room) break;
    const t = a.text.length > room ? `${a.text.slice(0, room)}\n[… cut at ${room} characters]` : a.text;
    parts.push(`=== FILE: ${a.name}${a.kind === "link" ? " (web page)" : ""} ===\n${t}`);
    used += t.length;
  }
  return parts.join("\n\n");
}
