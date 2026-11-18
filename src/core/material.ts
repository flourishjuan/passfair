// Turns uploaded files and links into material the agents can read. Pure functions, no network, no native code.
// Text-like files are read as text; Word / Excel / PowerPoint are unzipped and stripped to text;
// images, PDFs, video and audio are passed to an agent that can see them (see providers.canSee).
import { Unzip, UnzipInflate } from "fflate";

// UTF-8 decoding that works even where TextDecoder is missing (older Hermes builds).
export function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let cp = b;
    if (b >= 0xf0) cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else if (b >= 0xe0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else if (b >= 0xc0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export type AttachKind = "text" | "office" | "zip" | "image" | "pdf" | "video" | "audio" | "link" | "unsupported";
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
  zip: "application/zip",
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
  if (e === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
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


// ---- Bounded streaming ZIP reading (shared by data-package uploads and Office files) ----
//
// Both readers below feed the archive to fflate's streaming Unzip in small slices and count every
// actually-decompressed byte. No safety decision ever reads the archive's declared size fields
// (fflate's streaming UnzipInflate ignores them too). One emission is bounded by ~1032x one feed
// (DEFLATE spec max ratio); retained text and total examined bytes have hard caps; a tripwire
// stops feeding input entirely. Members are only ever kept as text in memory, never written to disk.
//
// fflate 0.8.2 bug guard: its streaming parser jumps into the zip64 extra-field reader (z64e)
// whenever a local header's compressed-size field is the 0xFFFFFFFF marker, and z64e scans for a
// zip64 record with no end-of-buffer check - without one it loops forever. Reject the marker up
// front instead: zip64 exists for archives over 4 GB, which cannot arrive here (input <= 18 MB).
function rejectZip64(bytes: Uint8Array, name: string) {
  for (let i = 0; i + 22 < bytes.length; i++) {
    if (
      bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4 &&
      bytes[i + 18] === 0xff && bytes[i + 19] === 0xff && bytes[i + 20] === 0xff && bytes[i + 21] === 0xff
    )
      throw new Error(`${name}: zip64 archives are not supported.`);
  }
}

const ZIP_PUSH = 16 * 1024; // feed granularity; bounds one emission to ~1032x this

// A chunk with a NUL byte or many control characters is not text.
const looksBinary = (head: Uint8Array) => {
  let bad = 0;
  for (const b of head) {
    if (b === 0) return true;
    if (b < 8 || (b > 13 && b < 32)) bad++;
  }
  return bad > head.length * 0.1;
};

class ZipStop extends Error {} // internal: a tripwire was hit, stop feeding input

export interface ZipReadPolicy {
  // per member: read it as streaming text, or never start it. "sniff" decides from the first chunk.
  pick: (memberName: string) => { action: "text" | "skip" | "sniff"; note?: string };
  maxRead: number; // members actually started at most
  textBudget: number; // total retained text bytes across members
  memberCap: number; // actual decompressed bytes examined per member at most
  examineCap: number; // total actual decompressed bytes; then hard stop (bomb tripwire)
}
export interface ZipReadOutcome {
  texts: Map<string, string>; // member name -> retained text (truncated members included, notes say so)
  files: number; // real files seen (directories excluded)
  read: number; // members with retained text
  notes: string[]; // human-readable notes (cuts, skips, tripwires)
  stopped: string; // tripwire message when reading aborted early
  corrupt: boolean; // a stream error occurred (damaged / encrypted / unsupported)
  cutAny: boolean; // any member truncated or the shared budget exhausted
  overflow: number; // picked members beyond maxRead, never read
}

function readZipBounded(bytes: Uint8Array, name: string, pol: ZipReadPolicy): ZipReadOutcome {
  rejectZip64(bytes, name);
  const o: ZipReadOutcome = {
    texts: new Map(),
    files: 0,
    read: 0,
    notes: [],
    stopped: "",
    corrupt: false,
    cutAny: false,
    overflow: 0,
  };
  let budget = pol.textBudget;
  let examined = 0;
  let started = 0;
  let budgetSpentNoted = false;

  let cur: {
    name: string;
    keep: boolean;
    sniff: boolean;
    chunks: Uint8Array[];
    kept: number;
    seen: number;
    cut: boolean;
  } | null = null;

  const uz = new Unzip((file) => {
    if (file.name.endsWith("/")) return; // directory entry
    o.files++;
    const d = pol.pick(file.name);
    if (d.note) o.notes.push(d.note);
    if (d.action === "skip") return; // never started; its compressed bytes stay bounded by the archive
    if (started >= pol.maxRead) {
      o.overflow++;
      return;
    }
    if (budget <= 0) {
      o.cutAny = true;
      if (!budgetSpentNoted) {
        budgetSpentNoted = true;
        o.notes.push("text budget used up - remaining members were not read");
      }
      return;
    }
    started++;
    const c = {
      name: file.name,
      keep: d.action === "text",
      sniff: d.action === "sniff",
      chunks: [] as Uint8Array[],
      kept: 0,
      seen: 0,
      cut: false,
    };
    cur = c;
    file.ondata = (err, chunk, final) => {
      if (err) {
        if (err instanceof ZipStop) throw err; // our own tripwire routed back through fflate's catch
        o.corrupt = true;
        throw new ZipStop(String((err as Error).message || err));
      }
      examined += chunk.length;
      c.seen += chunk.length;
      if (examined > pol.examineCap)
        throw new ZipStop(
          `the archive expands past ${Math.round(pol.examineCap / 1e6)} MB of actual data - reading stopped there (possible zip bomb)`,
        );
      if (c.sniff) {
        c.sniff = false;
        c.keep = !looksBinary(chunk.subarray(0, 512));
        if (!c.keep) o.notes.push(`${c.name} (binary - not read)`);
      }
      if (c.keep && !c.cut && chunk.length) {
        if (c.seen > pol.memberCap) {
          c.cut = true;
          o.cutAny = true;
          o.notes.push(
            `${c.name}: over ${Math.round(pol.memberCap / 1e6)} MB of actual data - only the first part shown`,
          );
        } else {
          const room = Math.min(budget - c.kept, chunk.length);
          if (room > 0) {
            c.chunks.push(chunk.subarray(0, room));
            c.kept += room;
          }
          if (c.kept >= budget) {
            c.cut = true;
            o.cutAny = true;
            o.notes.push(`${c.name}: cut at the shared text budget`);
          }
        }
      }
      if (final) {
        if (c.keep && c.kept) {
          const all = new Uint8Array(c.kept);
          let p = 0;
          for (const k2 of c.chunks) {
            all.set(k2, p);
            p += k2.length;
          }
          o.texts.set(c.name, utf8(all));
          budget -= c.kept;
          o.read++;
        }
        if (cur === c) cur = null;
      }
    };
    try {
      file.start();
    } catch (e2) {
      if (cur === c) cur = null;
      o.notes.push(`${file.name} (${e2 instanceof Error ? e2.message : "could not be read"})`);
    }
  });
  uz.register(UnzipInflate); // deflated members; stored members work out of the box

  try {
    for (let off = 0; off === 0 || off < bytes.length; off += ZIP_PUSH) {
      const end = Math.min(off + ZIP_PUSH, bytes.length);
      uz.push(bytes.subarray(off, end), end >= bytes.length);
      if (end >= bytes.length) break;
    }
  } catch (e) {
    if (e instanceof ZipStop) o.stopped = (e as Error).message;
    else o.corrupt = true;
  }
  if (o.stopped) o.notes.push(o.stopped);
  return o;
}

// ---- Data-package (.zip) uploads ----
// Text-like members are extracted up to a shared byte budget; binary members are listed by name only.
// Worst single emission ~1032x one feed (~16 MB) trips the abort before another byte is fed: a forged
// header or a zip bomb cannot expand into memory, and capped total work cannot hang the phone either.
const ZIP_TEXT_BUDGET = 200_000;
const ZIP_MAX_READ = 200;
const ZIP_MEMBER_CAP = 2 * 1024 * 1024;
const ZIP_EXAMINE_CAP = 25 * 1024 * 1024;

const TEXT_EXT = new Set(
  "txt md csv tsv json xml yaml yml js ts jsx tsx py java go rs c h cpp cs swift kt rb php sh sql html htm css ini cfg toml lock log vue svelte env gitignore".split(
    " ",
  ),
);
const BINARY_EXT = new Set(
  "png jpg jpeg gif webp heic mp4 mov m4v mp3 m4a wav pdf docx xlsx pptx zip gz 7z rar exe dylib so a o wasm bin dat db sqlite ico ttf otf woff woff2".split(
    " ",
  ),
);

export function zipToText(bytes: Uint8Array, name: string): string {
  const o = readZipBounded(bytes, name, {
    pick: (n) => {
      const e = ext(n);
      if (e === "zip") return { action: "skip", note: `${n} (nested zip - not opened)` };
      if (BINARY_EXT.has(e)) return { action: "skip", note: `${n} (binary - not read)` };
      if (TEXT_EXT.has(e)) return { action: "text" };
      return { action: "sniff" };
    },
    maxRead: ZIP_MAX_READ,
    textBudget: ZIP_TEXT_BUDGET,
    memberCap: ZIP_MEMBER_CAP,
    examineCap: ZIP_EXAMINE_CAP,
  });

  if (o.corrupt && !o.texts.size)
    throw new Error(`${name}: could not read this zip (damaged, encrypted, or unsupported compression).`);
  if (!o.files && !o.stopped && !o.corrupt) {
    // A real empty zip still ends with an end-of-central-directory record; garbage does not.
    let eocd = false;
    for (let i = bytes.length - 2; i >= 0 && i >= bytes.length - 65557; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
        eocd = true;
        break;
      }
    }
    if (!eocd) throw new Error(`${name}: could not read this zip (damaged, encrypted, or unsupported compression).`);
    return `${name}: empty zip.`;
  }
  const parts = [...o.texts.entries()].map(([n, t]) => `=== FILE: ${n} ===\n${t}`);
  const head = `${name}: ${o.files} member${o.files === 1 ? "" : "s"} in the zip, ${o.read} text member${o.read === 1 ? "" : "s"} extracted (shared budget ${Math.round(ZIP_TEXT_BUDGET / 1000)} KB of text).`;
  if (o.overflow) o.notes.push(`${o.overflow} further member${o.overflow === 1 ? "" : "s"} beyond the ${ZIP_MAX_READ}-member limit - not read`);
  return [head, ...parts, ...(o.notes.length ? [`Notes:\n- ${o.notes.join("\n- ")}`] : [])].join("\n\n");
}

// ---- Office documents (docx / xlsx / pptx) ----
// The one-shot unzipSync previously used here allocated the attacker-declared central-directory size
// up front (a forged 2-8 GB entry crashed or ballooned the phone) and had no size cap or clean error.
// The shared bounded reader fixes all three. Office XML is all-or-nothing: any truncation, tripwire
// or corruption is a clean error, never a partial document.
const OFFICE_MAX_READ = 1000;
const OFFICE_TEXT_BUDGET = 4 * 1024 * 1024;
const OFFICE_MEMBER_CAP = 4 * 1024 * 1024;
const OFFICE_EXAMINE_CAP = 25 * 1024 * 1024;

const OFFICE_PICK: Record<string, (p: string) => boolean> = {
  docx: (p) => p === "word/document.xml",
  pptx: (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p),
  xlsx: (p) => p === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(p),
};

export function officeToText(bytes: Uint8Array, name: string): string {
  const e = ext(name);
  const want = OFFICE_PICK[e] || (() => false);
  const o = readZipBounded(bytes, name, {
    pick: (n) => (want(n) ? { action: "text" } : { action: "skip" }),
    maxRead: OFFICE_MAX_READ,
    textBudget: OFFICE_TEXT_BUDGET,
    memberCap: OFFICE_MEMBER_CAP,
    examineCap: OFFICE_EXAMINE_CAP,
  });
  if (o.corrupt || !o.files)
    throw new Error(`${name}: could not read this document (damaged, encrypted, or unsupported).`);
  if (o.stopped || o.cutAny || o.overflow)
    throw new Error(`${name}: this document is too large to read on the phone.`);
  const read = (p: string) => o.texts.get(p) ?? "";
  if (e === "docx") return xmlText(read("word/document.xml"), /<\/w:p>/g);
  if (e === "pptx") {
    const slides = [...o.texts.keys()]
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    return slides.map((p, i) => `## Slide ${i + 1}\n${xmlText(read(p), /<\/a:p>/g)}`).join("\n\n");
  }
  if (e === "xlsx") {
    const shared = Array.from(read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) =>
      decodeEntities(m[1].replace(/<[^>]+>/g, "")),
    );
    const sheets = [...o.texts.keys()].filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort();
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
