// Renders what the agents write: headings, lists, bold/italic/code, quotes, code blocks and tables.
// Uses the same parser as the Word / PowerPoint export, plus table support for decision matrices.
import React from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { type Block, inlineRuns, parseMarkdown } from "../core/export";
import { F, T } from "./theme";

type Seg = { table: string[][] } | { blocks: Block[] };
export function segments(md: string): Seg[] {
  const lines = String(md || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const out: Seg[] = [];
  let buf: string[] = [];
  let tbl: string[] = [];
  const flushText = () => {
    if (buf.length) out.push({ blocks: parseMarkdown(buf.join("\n")) });
    buf = [];
  };
  const flushTable = () => {
    if (tbl.length) {
      const rows = tbl
        .map((l) =>
          l
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim()),
        )
        .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
      out.push({ table: rows });
    }
    tbl = [];
  };
  for (const l of lines) {
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flushText();
      tbl.push(l);
    } else {
      flushTable();
      buf.push(l);
    }
  }
  flushText();
  flushTable();
  return out;
}

function Inline({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={style} selectable>
      {inlineRuns(text).map((r, i) => (
        <Text
          key={i}
          style={[
            r.bold && { fontWeight: "500" },
            r.italic && { fontStyle: "italic" },
            r.code && {
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              backgroundColor: T.surface,
              fontSize: 14,
            },
          ]}
        >
          {r.text}
        </Text>
      ))}
    </Text>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.type === "h")
    return <Inline text={b.text} style={b.level === 1 ? [F.title, { marginTop: 6 }] : [F.head, { marginTop: 4 }]} />;
  if (b.type === "p") return <Inline text={b.text} style={F.body} />;
  if (b.type === "quote")
    return (
      <View style={{ borderLeftWidth: 3, borderLeftColor: T.purple, paddingLeft: 12 }}>
        <Inline text={b.text} style={[F.body, { color: T.sub }]} />
      </View>
    );
  if (b.type === "code")
    return (
      <ScrollView
        horizontal
        style={{ backgroundColor: T.surface, borderRadius: 12 }}
        contentContainerStyle={{ padding: 12 }}
      >
        <Text
          selectable
          style={{
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            fontSize: 13,
            lineHeight: 19,
            color: T.ink,
          }}
        >
          {b.text}
        </Text>
      </ScrollView>
    );
  if (b.type === "hr") return <View style={{ height: 1, backgroundColor: T.line, marginVertical: 4 }} />;
  return (
    <View style={{ gap: 6 }}>
      {b.items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={[F.body, { color: T.sub, minWidth: 18 }]}>{b.ordered ? `${i + 1}.` : "•"}</Text>
          <Inline text={it} style={[F.body, { flex: 1 }]} />
        </View>
      ))}
    </View>
  );
}

function Table({ rows }: { rows: string[][] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ borderRadius: 14, overflow: "hidden", backgroundColor: T.surface }}>
        {rows.map((r, i) => (
          <View
            key={i}
            style={{ flexDirection: "row", backgroundColor: i === 0 ? T.surface2 : i % 2 ? T.bg : T.surface }}
          >
            {r.map((c, j) => (
              <View key={j} style={{ width: j === 0 ? 180 : 86, padding: 10 }}>
                <Inline text={c} style={[F.small, { color: T.ink }, i === 0 && { fontWeight: "400" }]} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// `limit` shows only the first N blocks (the rest behind "Show more" in the caller).
export function Markdown({ text, limit }: { text: string; limit?: number }) {
  let n = 0;
  const out: React.ReactNode[] = [];
  for (const [i, seg] of segments(text).entries()) {
    if (limit && n >= limit) break;
    if ("table" in seg) {
      out.push(<Table key={`t${i}`} rows={seg.table} />);
      n++;
    } else
      for (const [j, b] of seg.blocks.entries()) {
        if (limit && n >= limit) break;
        out.push(<BlockView key={`${i}-${j}`} b={b} />);
        n++;
      }
  }
  return <View style={{ gap: 10 }}>{out}</View>;
}
export const blockCount = (text: string) =>
  segments(text).reduce((n, s) => n + ("table" in s ? 1 : s.blocks.length), 0);
