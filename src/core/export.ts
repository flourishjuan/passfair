// Ported from the desktop edition. Turns a finished deliverable (Markdown) into files people actually send:
// Word, PowerPoint, print-ready HTML (→ PDF). Pure functions, no dependencies, no Node APIs: .docx and .pptx
// are zip archives of XML, written here by hand. The AI agents never call this; the app does, locally.

/* ---------- 1. Markdown-lite parser ---------- */
// Supported: # headings (1–3), -/* bullets, 1. numbered, ``` code fences, > quotes, blank-line paragraphs,
// **bold**, *italic*, `code`. Everything else is plain text. Good enough for what the Worker writes.
export type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] };

export function parseMarkdown(md: string): Block[] {
  const lines = String(md || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "list"; ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ").trim() });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw)) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else code.push(raw);
      continue;
    }
    const line = raw.replace(/\s+$/, "");
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: Math.min(3, h[1].length), text: h[2].replace(/#+\s*$/, "").trim() });
      continue;
    }
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const n = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (b || n) {
      flushPara();
      const ordered = !b && !!n;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push((b ? b[1] : n![2]).trim());
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      blocks.push({ type: "quote", text: q[1].trim() });
      continue;
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code) blocks.push({ type: "code", text: (code as string[]).join("\n") });
  flushPara();
  flushList();
  return blocks;
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}
export function inlineRuns(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1), code: true });
    else out.push({ text: t.slice(1, -1), italic: true });
    last = m.index + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: "" }];
}
const plain = (text: string) =>
  inlineRuns(text)
    .map((r) => r.text)
    .join("");

/* ---------- 2. Zip writer (STORE, UTF-8 names) ---------- */
const enc = new TextEncoder();
const table = new Uint32Array(256).map((_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipStore(entries: [string, string | Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const path = enc.encode(name);
    const crc = crc32(data);
    const h = new Uint8Array(30);
    const hv = new DataView(h.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0x800, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, data.length, true);
    hv.setUint32(22, data.length, true);
    hv.setUint16(26, path.length, true);
    const c = new Uint8Array(46);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, path.length, true);
    cv.setUint32(42, offset, true);
    parts.push(h, path, data);
    central.push(c, path);
    offset += h.length + path.length + data.length;
  }
  const centralSize = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ExportOptions {
  title?: string;
  creator?: string;
  footer?: string;
  /** Print view only: hide the "Save as PDF" bar (used when the phone prints straight to a PDF file). */
  bare?: boolean;
}

/* ---------- 3. HTML (print-ready → PDF) ---------- */
export function toHtml(md: string, { title = "Passfair deliverable", footer = "", bare = false }: ExportOptions = {}) {
  const blocks = parseMarkdown(md);
  const runs = (t: string) =>
    inlineRuns(t)
      .map((r) =>
        r.code
          ? `<code>${esc(r.text)}</code>`
          : r.bold
            ? `<b>${esc(r.text)}</b>`
            : r.italic
              ? `<i>${esc(r.text)}</i>`
              : esc(r.text),
      )
      .join("");
  const body = blocks
    .map((b) => {
      if (b.type === "h") return `<h${b.level}>${runs(b.text)}</h${b.level}>`;
      if (b.type === "p") return `<p>${runs(b.text)}</p>`;
      if (b.type === "quote") return `<blockquote>${runs(b.text)}</blockquote>`;
      if (b.type === "code") return `<pre>${esc(b.text)}</pre>`;
      if (b.type === "hr") return "<hr />";
      if (b.type === "list") {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${b.items.map((i) => `<li>${runs(i)}</li>`).join("")}</${tag}>`;
      }
      return "";
    })
    .join("\n");
  const bar = bare
    ? ""
    : `<div class="bar"><span>Press <b>Save as PDF</b> (the print dialog opens; choose “Save as PDF”).</span><button onclick="window.print()">Save as PDF</button></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  body{font:15px/1.6 -apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Helvetica,Arial,sans-serif;color:#17132e;max-width:760px;margin:${bare ? "0 auto" : "56px auto 40px"};padding:0 24px}
  h1{font-size:30px;line-height:1.2;margin:0 0 16px}h2{font-size:22px;margin:28px 0 8px}h3{font-size:17px;margin:20px 0 6px}
  pre{background:#f3f1fb;padding:12px;border-radius:8px;white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
  code{background:#f3f1fb;padding:1px 5px;border-radius:4px}blockquote{border-left:3px solid #7149f2;margin:0;padding:4px 14px;color:#544f6e}
  hr{border:0;border-top:1px solid #ded9ef;margin:24px 0}.foot{margin-top:40px;font-size:12px;color:#544f6e}
  .bar{position:fixed;top:0;left:0;right:0;background:#dcf958;padding:8px 16px;font-size:13px;display:flex;gap:12px;align-items:center}
  .bar button{border:1.5px solid #17132e;background:#fff;border-radius:999px;padding:6px 14px;font-weight:700;cursor:pointer}
  @media print{.bar{display:none}body{margin:0}}
</style></head>
<body>
${bar}
${body}
${footer ? `<p class="foot">${esc(footer)}</p>` : ""}
</body></html>`;
}

/* ---------- 4. Word (.docx) ---------- */
const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
const core = (title: string, creator: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;
const app = (name: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(name)}</Application></Properties>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="17132E"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="7149F2"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="544F6E"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F1FB"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;

function wRuns(text: string) {
  return inlineRuns(text)
    .map((r) => {
      const pr = [
        r.bold ? "<w:b/>" : "",
        r.italic ? "<w:i/>" : "",
        r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "",
      ].join("");
      return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    })
    .join("");
}
export function toDocx(
  md: string,
  { title = "Passfair deliverable", creator = "Passfair", footer = "" }: ExportOptions = {},
): Uint8Array {
  const blocks = parseMarkdown(md);
  const paras: string[] = [];
  const p = (style: string, runs: string, extra = "") =>
    paras.push(`<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${runs}</w:p>`);
  for (const b of blocks) {
    if (b.type === "h") p(`Heading${b.level}`, wRuns(b.text));
    else if (b.type === "p") p("", wRuns(b.text));
    else if (b.type === "quote") p("Quote", wRuns(b.text));
    else if (b.type === "code")
      for (const line of b.text.split("\n")) p("Code", `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`);
    else if (b.type === "hr")
      p("", "", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DED9EF"/></w:pBdr>');
    else if (b.type === "list")
      b.items.forEach((it, i) =>
        p(
          "",
          `<w:r><w:t xml:space="preserve">${b.ordered ? `${i + 1}. ` : "• "}</w:t></w:r>${wRuns(it)}`,
          '<w:ind w:left="567" w:hanging="283"/>',
        ),
      );
  }
  if (footer)
    p(
      "",
      `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="544F6E"/></w:rPr><w:t xml:space="preserve">${esc(footer)}</w:t></w:r>`,
    );
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${paras.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    ["[Content_Types].xml", CT],
    ["_rels/.rels", RELS],
    ["word/document.xml", doc],
    ["word/styles.xml", STYLES],
    [
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    ],
    ["docProps/core.xml", core(title, creator)],
    ["docProps/app.xml", app(creator)],
  ]);
}

/* ---------- 5. PowerPoint (.pptx) ---------- */
// One slide per level-1/2 heading; bullets and paragraphs under it become the slide body.
// A deliverable with no headings becomes body slides of ~9 lines each.
export interface Slide {
  title: string;
  lines: { text: string; bold?: boolean; mono?: boolean; bullet?: boolean; num?: number }[];
}
export function slidesFrom(md: string, { title = "Passfair deliverable" }: ExportOptions = {}): Slide[] {
  const blocks = parseMarkdown(md);
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  const push = (t: string): Slide => {
    cur = { title: plain(t).slice(0, 120), lines: [] };
    slides.push(cur);
    return cur;
  };
  for (const b of blocks) {
    if (b.type === "h" && b.level <= 2) {
      push(b.text);
      continue;
    }
    const c: Slide = cur ?? push(title);
    if (b.type === "h") c.lines.push({ text: plain(b.text), bold: true });
    else if (b.type === "p" || b.type === "quote") c.lines.push({ text: plain(b.text) });
    else if (b.type === "code") for (const l of b.text.split("\n").slice(0, 12)) c.lines.push({ text: l, mono: true });
    else if (b.type === "list")
      b.items.forEach((it, i) => c.lines.push({ text: plain(it), bullet: true, num: b.ordered ? i + 1 : 0 }));
  }
  const out: Slide[] = [];
  for (const s of slides) {
    if (s.lines.length <= 9) out.push(s);
    else
      for (let i = 0; i < s.lines.length; i += 9)
        out.push({ title: s.title + (i ? " (cont.)" : ""), lines: s.lines.slice(i, i + 9) });
  }
  return out.length ? out : [{ title, lines: [] }];
}
const P_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GRP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
function slideXml(s: Slide, n: number, total: number, footer: string) {
  const para = (l: Slide["lines"][number]) => {
    const size = l.bold ? 2000 : 1800;
    const txt = l.bullet ? (l.num ? `${l.num}. ` : "• ") + l.text : l.text;
    return `<a:p><a:pPr marL="${l.bullet ? 342900 : 0}" indent="${l.bullet ? -285750 : 0}"><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" ${l.bold ? 'b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="17132E"/></a:solidFill>${l.mono ? '<a:latin typeface="Consolas"/>' : ""}</a:rPr><a:t>${esc(txt)}</a:t></a:r></a:p>`;
  };
  const isTitle = n === 1 && !s.lines.length;
  const body = s.lines.length
    ? `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="10820400" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${s.lines.map(para).join("")}</p:txBody></p:sp>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${P_NS}><p:cSld><p:spTree>${GRP}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="${isTitle ? 6858000 : 228600}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="7149F2"/></a:solidFill></p:spPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${isTitle ? 2286000 : 457200}"/><a:ext cx="10820400" cy="${isTitle ? 1600000 : 914400}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${isTitle ? "ctr" : "b"}"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${isTitle ? 4400 : 3200}" b="1"><a:solidFill><a:srgbClr val="${isTitle ? "FFFFFF" : "17132E"}"/></a:solidFill></a:rPr><a:t>${esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>
${body}
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="6324600"/><a:ext cx="10820400" cy="320040"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1000"><a:solidFill><a:srgbClr val="${isTitle ? "FFFFFF" : "544F6E"}"/></a:solidFill></a:rPr><a:t>${esc(footer)} · ${n}/${total}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const REL = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`;
const RELS_OPEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Passfair"><a:themeElements>
<a:clrScheme name="Passfair"><a:dk1><a:srgbClr val="17132E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="544F6E"/></a:dk2><a:lt2><a:srgbClr val="F3F1FB"/></a:lt2><a:accent1><a:srgbClr val="7149F2"/></a:accent1><a:accent2><a:srgbClr val="DCF958"/></a:accent2><a:accent3><a:srgbClr val="7149F2"/></a:accent3><a:accent4><a:srgbClr val="DCF958"/></a:accent4><a:accent5><a:srgbClr val="7149F2"/></a:accent5><a:accent6><a:srgbClr val="DCF958"/></a:accent6><a:hlink><a:srgbClr val="7149F2"/></a:hlink><a:folHlink><a:srgbClr val="544F6E"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Passfair"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
export function toPptx(
  md: string,
  { title = "Passfair deliverable", creator = "Passfair", footer = "Made with Passfair" }: ExportOptions = {},
): Uint8Array {
  const slides = slidesFrom(md, { title });
  const n = slides.length;
  const OD = "officeDocument/2006/relationships";
  const entries: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    ],
    [
      "_rels/.rels",
      `${RELS_OPEN}
${REL("rId1", `${OD}/officeDocument`, "ppt/presentation.xml")}
${REL("rId2", "package/2006/relationships/metadata/core-properties", "docProps/core.xml")}
${REL("rId3", `${OD}/extended-properties`, "docProps/app.xml")}
</Relationships>`,
    ],
    [
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    ],
    [
      "ppt/_rels/presentation.xml.rels",
      `${RELS_OPEN}
${REL("rId1", `${OD}/slideMaster`, "slideMasters/slideMaster1.xml")}
${slides.map((_, i) => REL(`rId${i + 2}`, `${OD}/slide`, `slides/slide${i + 1}.xml`)).join("\n")}
${REL(`rId${n + 2}`, `${OD}/theme`, "theme/theme1.xml")}
</Relationships>`,
    ],
    [
      "ppt/slideMasters/slideMaster1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    ],
    [
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      `${RELS_OPEN}
${REL("rId1", `${OD}/slideLayout`, "../slideLayouts/slideLayout1.xml")}
${REL("rId2", `${OD}/theme`, "../theme/theme1.xml")}
</Relationships>`,
    ],
    [
      "ppt/slideLayouts/slideLayout1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    ],
    [
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `${RELS_OPEN}
${REL("rId1", `${OD}/slideMaster`, "../slideMasters/slideMaster1.xml")}
</Relationships>`,
    ],
    ["ppt/theme/theme1.xml", THEME],
    ["docProps/core.xml", core(title, creator)],
    ["docProps/app.xml", app(creator)],
  ];
  slides.forEach((s, i) => {
    entries.push([`ppt/slides/slide${i + 1}.xml`, slideXml(s, i + 1, n, footer)]);
    entries.push([
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `${RELS_OPEN}
${REL("rId1", `${OD}/slideLayout`, "../slideLayouts/slideLayout1.xml")}
</Relationships>`,
    ]);
  });
  return zipStore(entries);
}

export type ExportFormat = "pdf" | "docx" | "pptx" | "md";
export const formats: Record<ExportFormat, { mime: string; ext: string; label: string; uti: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF", uti: "com.adobe.pdf" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
    label: "Word",
    uti: "org.openxmlformats.wordprocessingml.document",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
    label: "PowerPoint",
    uti: "org.openxmlformats.presentationml.presentation",
  },
  md: { mime: "text/markdown", ext: "md", label: "Markdown", uti: "net.daringfireball.markdown" },
};
