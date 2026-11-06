// Which language the user is writing in, so every agent — ideas, debate, reviews, the final answer —
// answers in it. The user's latest message decides; when it says too little to tell (a short "ok", a link,
// a code snippet), the language of the conversation so far is kept.

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

// Characters that differ between Simplified and Traditional Chinese, and are common.
const SIMP = /[这们为说国会个来时对学关与从实经发点开体还过现们问题应该么让给后动产业务]/g;
const TRAD = /[這們為說國會個來時對學關與從實經發點開體還過現問題應該麼讓給後動產業務]/g;

const LATIN: [string, RegExp][] = [
  ["Spanish", /(?<!\p{L})(el|la|los|las|que|de|para|con|una|por|cómo|qué|está|necesito|quiero)(?!\p{L})/giu],
  ["Portuguese", /(?<!\p{L})(o|os|as|que|de|para|com|uma|não|você|está|preciso|quero|é)(?!\p{L})/giu],
  [
    "French",
    /(?<!\p{L})(le|la|les|des|que|pour|avec|une|est|c'est|je|vous|nous|pas|comment|moi|un|du|au|aux|dans|sur|mon|mes)(?!\p{L})/giu,
  ],
  ["German", /(?<!\p{L})(der|die|das|und|ist|nicht|mit|für|ich|wir|sie|ein|eine|wie|bitte)(?!\p{L})/giu],
  ["Italian", /(?<!\p{L})(il|lo|gli|che|di|per|con|una|non|sono|come|voglio|questo)(?!\p{L})/giu],
  ["English", /(?<!\p{L})(the|and|is|are|to|of|for|with|what|how|should|we|i|you|our|my|this|that|it)(?!\p{L})/giu],
];

/** The language a piece of text is written in, or null when it is too short or unclear to tell. */
export function detectLanguage(text: string | null | undefined): string | null {
  const t = String(text || "")
    .replace(/```[\s\S]*?```/g, " ") // code blocks say nothing about the user's language
    .replace(/https?:\/\/\S+/g, " ");
  const han = count(t, /[一-鿿]/g);
  const kana = count(t, /[぀-ヿ]/g);
  const hangul = count(t, /[가-힯]/g);
  const scripts: [string, number][] = [
    ["Japanese", kana ? kana + han : 0],
    ["Korean", hangul],
    ["Arabic", count(t, /[؀-ۿ]/g)],
    ["Russian", count(t, /[Ѐ-ӿ]/g)],
    ["Thai", count(t, /[฀-๿]/g)],
    ["Hebrew", count(t, /[֐-׿]/g)],
    ["Hindi", count(t, /[ऀ-ॿ]/g)],
    ["Greek", count(t, /[Ͱ-Ͽ]/g)],
  ];
  if (han >= 2 && !kana) {
    return count(t, TRAD) > count(t, SIMP) ? "Traditional Chinese (繁體中文)" : "Simplified Chinese (简体中文)";
  }
  const [name, n] = scripts.sort((a, b) => b[1] - a[1])[0];
  if (n >= 2) return name;
  const words = t.match(/\p{L}+/gu) || [];
  if (words.length < 3) return null;
  // Letters only some languages use count extra.
  const hint: Record<string, number> = {
    Spanish: count(t, /[¿¡ñ]/g) * 3,
    Portuguese: count(t, /[ãõ]/g) * 3,
    French: count(t, /[èêëœàçù]/g) * 2,
    German: count(t, /[äöüß]/g) * 3,
  };
  const scored = LATIN.map(([l, re]) => [l, count(t, re) + (hint[l] || 0)] as [string, number]).sort(
    (a, b) => b[1] - a[1],
  );
  if (!scored[0][1]) return null;
  // Spanish/Portuguese/Italian share many short words: accents and a clear lead decide.
  if (scored[0][1] === scored[1]?.[1] && scored[0][0] !== "English") return null;
  return scored[0][0];
}

/** Language for the next step: the latest message if it is clear, otherwise the conversation's so far. */
export function languageFor(latest: string | null | undefined, previous?: string | null): string | null {
  return detectLanguage(latest) || previous || null;
}

export const languageRule = (lang: string | null | undefined) =>
  lang
    ? `OUTPUT LANGUAGE: ${lang}. The user writes in ${lang}, and the user reads every step, so write ALL of your output in ${lang} — ideas, debate, plans, reviews (JSON keys stay in English, every value in ${lang}), notes and the deliverable — even when the material or other agents use another language. Keep code, product names, URLs and direct quotes as they are.`
    : `OUTPUT LANGUAGE: the language of the user's latest message. Write ALL of your output in it — ideas, debate, plans, reviews (JSON keys stay in English) and the deliverable.`;
