// Turns the agents' fenced code blocks into a real, downloadable project (.zip).
// Pure functions, no network, no native code. The zip is written with fflate (already a dependency).
import { strToU8, zipSync } from "fflate";

export interface CodeFile {
  name: string;
  content: string;
}

// ```lang or ```lang title="name" or ```name — the info string after the opening fence.
interface Block {
  info: string;
  code: string;
  /** Lines (up to 4) right before the fence, for a filename in a heading or bold text. */
  before: string[];
}

export function fencedBlocks(md: string): Block[] {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^```([^\n`]*)$/);
    if (!open) {
      i++;
      continue;
    }
    const before: string[] = [];
    for (let k = i - 1; k >= 0 && before.length < 4; k--) {
      if (!lines[k].trim()) {
        if (before.length) break; // stop at the paragraph boundary once we have text
        continue;
      }
      before.unshift(lines[k]);
    }
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    blocks.push({ info: open[1].trim(), code: body.join("\n"), before });
    i = j + 1;
  }
  return blocks;
}

// A plausible file path: word characters, dots, dashes and slashes, with a real extension. Not a URL.
const PATH = /(?<![\w:/])((?:[\w~][\w.\-~]*\/)*[\w~][\w.\-~]*\.[A-Za-z0-9]{1,10})(?![\w/])/;

// Strips anything that would escape the zip root or break on another platform.
export function sanitizePath(name: string): string | null {
  const clean = name
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
  if (!clean || clean.length > 120 || !/\.[A-Za-z0-9]{1,10}$/.test(clean)) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|\/|$)/i.test(clean)) return null; // Windows device names
  return clean;
}

function nameIn(text: string): string | null {
  const m = text.replace(/[`*_#>]/g, " ").match(PATH);
  return m ? sanitizePath(m[1]) : null;
}

// Filenames agents give their blocks: in the fence info, in a first-line comment, or in the line above.
function nameFor(b: Block): string | null {
  // 1. Fence info: ```index.html  ·  ```html index.html  ·  ```html title="src/App.tsx"
  const title = b.info.match(/(?:title|file|filename)=["']?([^"'\s]+)["']?/i);
  if (title) {
    const n = sanitizePath(title[1]);
    if (n) return n;
  }
  for (const token of b.info.split(/\s+/).slice(1)) {
    const n = nameIn(token);
    if (n) return n;
  }
  const firstToken = b.info.split(/\s+/)[0] || "";
  if (firstToken.includes(".") || firstToken.includes("/")) {
    const n = nameIn(firstToken);
    if (n && !/^(js|ts|py|html|css|json|jsx|tsx)$/i.test(firstToken)) return n;
  }
  // 2. First line as a comment: // index.html · # app.py · <!-- index.html --> · /* main.c */
  const first = (b.code.split("\n").find((l) => l.trim()) || "").trim();
  if (/^(\/\/|#|<!--|\/\*|;|--)/.test(first)) {
    const n = nameIn(first.replace(/^(-->|<!--|\/\*|\*\/|\/\/|#|;|--)+/, ""));
    if (n) return n;
  }
  // 3. A heading / bold / `code` line right above the fence ("### src/App.tsx", "**app.py**").
  for (let k = b.before.length - 1; k >= 0; k--) {
    const n = nameIn(b.before[k]);
    if (n) return n;
  }
  return null;
}

const LANG_EXT: Record<string, string> = {
  html: "html",
  css: "css",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  py: "py",
  json: "json",
  yaml: "yaml",
  yml: "yml",
  java: "java",
  go: "go",
  rust: "rs",
  c: "c",
  cpp: "cpp",
  swift: "swift",
  kotlin: "kt",
  ruby: "rb",
  php: "php",
  sh: "sh",
  bash: "sh",
  sql: "sql",
  xml: "xml",
  md: "md",
  markdown: "md",
};

/** Code blocks that carry a file name, as files. Unnamed blocks ship only when they are the whole answer. */
export function extractCodeFiles(md: string): CodeFile[] {
  const blocks = fencedBlocks(md).filter((b) => b.code.trim());
  const named: CodeFile[] = [];
  for (const b of blocks) {
    const name = nameFor(b);
    if (name) named.push({ name, content: b.code.replace(/^\n+|\s+$/g, "") + "\n" });
  }
  if (!named.length && blocks.length === 1) {
    const lang = blocks[0].info.split(/\s+/)[0].toLowerCase();
    const ext = LANG_EXT[lang] || "txt";
    named.push({ name: `main.${ext}`, content: blocks[0].code.replace(/^\n+|\s+$/g, "") + "\n" });
  }
  // Two blocks for one file (a revision): the later one wins; same name twice in one answer gets a suffix.
  const byName = new Map<string, CodeFile>();
  for (const f of named) {
    if (byName.has(f.name)) byName.delete(f.name);
    byName.set(f.name, f);
  }
  return [...byName.values()];
}

/** The project as a .zip archive (UTF-8 names and contents), ready to save or share. */
export const ZIP_MAX_FILES = 200;
export const ZIP_MAX_BYTES = 10 * 1024 * 1024; // 10 MB of text — an answer should never need more
export function makeZip(files: CodeFile[]): Uint8Array {
  if (files.length > ZIP_MAX_FILES)
    throw new Error(`Too many files (${files.length}) — the limit is ${ZIP_MAX_FILES}. Split the project.`);
  const total = files.reduce((n, f) => n + f.content.length, 0);
  if (total > ZIP_MAX_BYTES)
    throw new Error(
      `The code is ${Math.round(total / 1e6)} MB of text — over the 10 MB limit. Download as Markdown instead, or split the project.`,
    );
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let k = 2;
      while (used.has(`${stem}-${k}${ext}`)) k++;
      name = `${stem}-${k}${ext}`;
    }
    used.add(name);
    entries[name] = strToU8(f.content);
  }
  return zipSync(entries, { level: 6 });
}
