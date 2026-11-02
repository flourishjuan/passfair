import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, parseMarkdown, slidesFrom, toDocx, toHtml, toPptx, zipStore } from "../src/core/export";

const MD = `# 路演稿 Pitch

## Problem
You are the **copy-paste** between your AIs.

- Claude drafts
- GPT polishes
1. One
2. Two

> Quote here

\`\`\`
const x = 1 < 2;
\`\`\`

## Ask
$500K pre-seed & "SAFE".`;

const dec = new TextDecoder();
function unzip(z: Uint8Array): Record<string, string> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const out: Record<string, string> = {};
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true),
      nlen = v.getUint16(p + 26, true),
      crc = v.getUint32(p + 14, true);
    const name = dec.decode(z.subarray(p + 30, p + 30 + nlen));
    const data = z.subarray(p + 30 + nlen, p + 30 + nlen + size);
    assert.equal(crc32(data), crc, `crc ${name}`);
    out[name] = dec.decode(data);
    p += 30 + nlen + size;
  }
  assert.equal(v.getUint32(z.length - 22, true), 0x06054b50, "end of central directory");
  return out;
}

test("export: markdown parser covers headings, lists, quotes, code", () => {
  const types = parseMarkdown(MD).map((b) => b.type);
  assert.deepEqual(types, ["h", "h", "p", "list", "list", "quote", "code", "h", "p"]);
});

test("export: zip writer matches a known CRC and round-trips", () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
  const files = unzip(
    zipStore([
      ["a.txt", "hi"],
      ["中文.txt", "你好"],
    ]),
  );
  assert.deepEqual(files, { "a.txt": "hi", "中文.txt": "你好" });
});

test("export: Word file is a valid package with escaped text and Chinese", () => {
  const f = unzip(toDocx(MD, { title: "T", footer: "Made with Passfair" }));
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/_rels/document.xml.rels",
  ])
    assert.ok(f[part], part);
  const doc = f["word/document.xml"];
  assert.match(doc, /路演稿 Pitch/);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">copy-paste/);
  assert.match(doc, /1 &lt; 2/);
  assert.match(doc, /&amp; &quot;SAFE&quot;/);
  assert.match(doc, /Made with Passfair/);
});

test("export: PowerPoint makes one slide per heading, numbered footers", () => {
  const slides = slidesFrom(MD);
  assert.deepEqual(
    slides.map((s) => s.title),
    ["路演稿 Pitch", "Problem", "Ask"],
  );
  const f = unzip(toPptx(MD, { footer: "F" }));
  assert.ok(f["ppt/slides/slide3.xml"] && !f["ppt/slides/slide4.xml"]);
  assert.match(f["ppt/slides/slide2.xml"], /• Claude drafts/);
  assert.match(f["ppt/slides/slide3.xml"], /F · 3\/3/);
  assert.match(f["ppt/_rels/presentation.xml.rels"], /Id="rId5"[^>]*theme/);
});

test("export: long sections split across slides; print HTML can drop the save bar", () => {
  const md = "## Many\n" + Array.from({ length: 20 }, (_, i) => `- item ${i}`).join("\n");
  assert.deepEqual(
    slidesFrom(md).map((s) => s.title),
    ["Many", "Many (cont.)", "Many (cont.)"],
  );
  assert.match(toHtml(MD), /Save as PDF/);
  assert.doesNotMatch(toHtml(MD, { bare: true }), /class="bar"/);
});
