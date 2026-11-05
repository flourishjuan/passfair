// Team notebook (after Karpathy's "LLM Wiki"): instead of every brief starting from zero, approved work is
// compiled into a small set of pages — decisions, facts with sources, the people/products/customers that
// keep coming up, open questions — kept on the phone. A new brief starts with the few pages that matter for
// it, so the agents build on what the team already settled instead of re-arguing it.
//   ingest — after the user approves a result, a "librarian" turns it into page updates (in the background).
//   query  — before a brief, the most relevant pages are picked locally (no extra AI call) within a budget.
//   lint   — the librarian flags where the new result contradicts a page, and the user decides.
// Only results the user approved go in; every page says which brief and date it came from; the user can
// read, delete and export everything.

export type NoteKind = "decision" | "fact" | "entity" | "question";
export interface NoteSource {
  jobId: string;
  date: string;
  brief: string;
}
export interface NotePage {
  id: string;
  kind: NoteKind;
  title: string;
  body: string;
  tags: string[];
  sources: NoteSource[];
  updated: string;
}
export interface NoteLog {
  date: string;
  jobId: string;
  op: "ingest" | "conflict";
  text: string;
}
export interface Notebook {
  pages: NotePage[];
  log: NoteLog[];
}

export const emptyNotebook = (): Notebook => ({ pages: [], log: [] });
export const MAX_PAGES = 200;
const MAX_BODY = 700;
const KINDS: NoteKind[] = ["decision", "fact", "entity", "question"];

// Words for matching: Latin words of 3+ letters, and CJK as overlapping pairs of characters.
export function terms(text: string): Set<string> {
  const t = String(text || "").toLowerCase();
  const out = new Set<string>();
  for (const w of t.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) || []) if (!/[぀-ヿ一-鿿가-힯]/.test(w)) out.add(w);
  for (const run of t.match(/[぀-ヿ一-鿿가-힯]+/g) || [])
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  return out;
}
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "how",
  "our",
  "you",
  "your",
  "are",
  "from",
  "should",
  "will",
  "can",
  "about",
  "into",
]);

/** The pages worth giving the team for this brief: most relevant first, within a character budget. */
export function selectPages(nb: Notebook, brief: string, budget = 5000): NotePage[] {
  const q = [...terms(brief)].filter((w) => !STOP.has(w));
  if (!nb.pages.length || !q.length) return [];
  const scored = nb.pages
    .map((p) => {
      const hay = terms(`${p.title} ${p.tags.join(" ")} ${p.body}`);
      const title = terms(`${p.title} ${p.tags.join(" ")}`);
      let s = 0;
      for (const w of q) s += (hay.has(w) ? 1 : 0) + (title.has(w) ? 2 : 0);
      if (s && p.kind === "decision") s += 1; // settled decisions matter most
      return { p, s };
    })
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || b.p.updated.localeCompare(a.p.updated));
  const out: NotePage[] = [];
  let used = 0;
  for (const { p } of scored) {
    const size = p.title.length + p.body.length + 40;
    if (used + size > budget) continue;
    out.push(p);
    used += size;
    if (out.length >= 8) break;
  }
  return out;
}

/** What the agents are told the team already knows. */
export function knowledgeBlock(pages: NotePage[]): string {
  if (!pages.length) return "";
  const lines = pages.map(
    (p) =>
      `### ${p.title} (${p.kind}; from "${p.sources[p.sources.length - 1]?.brief.slice(0, 60) || "earlier work"}", ${p.updated.slice(0, 10)})\n${p.body}`,
  );
  return `WHAT THE TEAM ALREADY KNOWS (the user's notebook: earlier work the user approved). Build on it instead of re-deciding it; if the brief says otherwise, the brief wins and you say what changed. It may be out of date.\n\n${lines.join("\n\n")}`;
}

/** The librarian's instructions: turn an approved result into notebook updates. */
export function librarianPrompt(
  nb: Notebook,
  job: { goal: string; lang?: string },
  result: string,
): { system: string; prompt: string } {
  const index = nb.pages
    .slice(0, MAX_PAGES)
    .map((p) => `- [${p.id}] (${p.kind}) ${p.title} — ${p.body.replace(/\s+/g, " ").slice(0, 90)}`)
    .join("\n");
  const system = `You maintain the user's team notebook: short pages the AI team reads before future briefs. Record only what will still matter later: decisions with their reason, facts with their source (or marked as an estimate), the user's company / products / customers / competitors, and open questions. No chit-chat, no restating the whole result, no advice. Each page body is at most 5 short lines. Prefer updating an existing page (use its id) over creating a near-duplicate. When the new result contradicts an existing page, update that page to the new state AND list it in "conflicts". Write titles and bodies in ${job.lang || "the language of the result"}.
Reply with JSON only: {"pages":[{"id":"<existing id or omit for new>","kind":"decision|fact|entity|question","title":"...","body":"...","tags":["keyword",...]}],"conflicts":[{"id":"<page id>","was":"<old claim>","now":"<new claim>"}],"summary":"<one line: what was filed>"}`;
  const prompt = `NOTEBOOK INDEX (${nb.pages.length} pages):\n${index || "(empty)"}\n\nBRIEF:\n${job.goal.slice(0, 1500)}\n\nAPPROVED RESULT:\n${result.slice(0, 9000)}`;
  return { system, prompt };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "page";

/** Apply the librarian's reply. Returns what changed; a reply that isn't usable changes nothing. */
export function applyIngest(
  nb: Notebook,
  reply: string,
  src: NoteSource,
  now = new Date().toISOString(),
): { notebook: Notebook; added: number; updated: number; conflicts: { title: string; was: string; now: string }[] } {
  const none = { notebook: nb, added: 0, updated: 0, conflicts: [] };
  let data: any;
  try {
    const m = String(reply).match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : reply);
  } catch {
    return none;
  }
  if (!Array.isArray(data?.pages)) return none;
  const pages = nb.pages.map((p) => ({ ...p }));
  let added = 0;
  let updated = 0;
  for (const raw of data.pages.slice(0, 20)) {
    const title = String(raw?.title || "")
      .trim()
      .slice(0, 120);
    const body = String(raw?.body || "")
      .trim()
      .slice(0, MAX_BODY);
    if (!title || !body) continue;
    const kind: NoteKind = KINDS.includes(raw.kind) ? raw.kind : "fact";
    const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((t: any) => String(t).slice(0, 30)).slice(0, 8);
    const existing =
      pages.find((p) => raw.id && p.id === raw.id) || pages.find((p) => p.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      Object.assign(existing, { kind, title, body, tags: tags.length ? tags : existing.tags, updated: now });
      if (!existing.sources.some((s) => s.jobId === src.jobId)) existing.sources = [...existing.sources, src].slice(-5);
      updated++;
    } else {
      let id = slug(title);
      while (pages.some((p) => p.id === id)) id += "-2";
      pages.push({ id, kind, title, body, tags, sources: [src], updated: now });
      added++;
    }
  }
  const conflicts = (Array.isArray(data.conflicts) ? data.conflicts : [])
    .slice(0, 5)
    .map((c: any) => ({
      title: pages.find((p) => p.id === c?.id)?.title || String(c?.id || ""),
      was: String(c?.was || "").slice(0, 200),
      now: String(c?.now || "").slice(0, 200),
    }))
    .filter((c: any) => c.title && (c.was || c.now));
  // Oldest pages make room when the notebook is full.
  pages.sort((a, b) => b.updated.localeCompare(a.updated));
  const log: NoteLog[] = [
    ...nb.log,
    {
      date: now,
      jobId: src.jobId,
      op: "ingest" as const,
      text: String(data.summary || `${added} new, ${updated} updated`).slice(0, 200),
    },
    ...conflicts.map((c: any) => ({
      date: now,
      jobId: src.jobId,
      op: "conflict" as const,
      text: `${c.title}: ${c.was} → ${c.now}`,
    })),
  ].slice(-300);
  return { notebook: { pages: pages.slice(0, MAX_PAGES), log }, added, updated, conflicts };
}

export function removePage(nb: Notebook, id: string): Notebook {
  return { ...nb, pages: nb.pages.filter((p) => p.id !== id) };
}

/** The whole notebook as Markdown (index + pages + log), e.g. for Obsidian or Muse. */
export function notebookMarkdown(nb: Notebook): string {
  const by = (k: NoteKind) => nb.pages.filter((p) => p.kind === k);
  const head: Record<NoteKind, string> = {
    decision: "Decisions",
    fact: "Facts",
    entity: "People, products & companies",
    question: "Open questions",
  };
  const parts = ["# Passfair team notebook", ""];
  for (const k of KINDS) {
    const ps = by(k);
    if (!ps.length) continue;
    parts.push(`## ${head[k]}`, "");
    for (const p of ps)
      parts.push(
        `### ${p.title}`,
        p.body,
        `_Updated ${p.updated.slice(0, 10)} · from: ${p.sources.map((s) => `"${s.brief.slice(0, 50)}" (${s.date.slice(0, 10)})`).join("; ")}_`,
        "",
      );
  }
  if (nb.log.length) {
    parts.push("## Log", "");
    for (const l of nb.log.slice(-50)) parts.push(`- ${l.date.slice(0, 10)} ${l.op} | ${l.text}`);
  }
  return parts.join("\n");
}
