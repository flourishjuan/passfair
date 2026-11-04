// Free vs Pro. Every Pro feature is visible in the free app (greyed, with a lock) and unlocks the moment
// the App Store confirms a Pro subscription. Change limits here only.
export type Tier = "free" | "pro";
export interface Limits {
  agents: number; // agents on the brainstorm panel
  debateRounds: number;
  maxBuildRounds: number;
  research: boolean; // live web research stage
  customAgents: boolean;
  images: number; // images per brief
  pdf: boolean;
  office: boolean; // Word / Excel / PowerPoint uploads
  video: boolean;
  exports: ("md" | "pdf" | "docx" | "pptx" | "record")[];
}
export const LIMITS: Record<Tier, Limits> = {
  free: {
    agents: 2,
    debateRounds: 2,
    maxBuildRounds: 4,
    research: false,
    customAgents: false,
    images: 2,
    pdf: false,
    office: false,
    video: false,
    exports: ["md", "pdf"],
  },
  pro: {
    agents: 6,
    debateRounds: 4,
    maxBuildRounds: 8,
    research: true,
    customAgents: true,
    images: 10,
    pdf: true,
    office: true,
    video: true,
    exports: ["md", "pdf", "docx", "pptx", "record"],
  },
};
export const PRO_PRODUCTS = {
  monthly: "ai.agentsfair.passfair.pro.monthly",
  yearly: "ai.agentsfair.passfair.pro.yearly",
};
export const PRO_PITCH = [
  "Up to 6 agents on one brainstorm",
  "Up to 4 debate rounds and 8 review rounds",
  "Live web research before the team starts",
  "Your own custom agents (any OpenAI- or Anthropic-compatible API)",
  "PDF, Word, Excel, PowerPoint and video uploads",
  "Export to Word, PowerPoint and the full record",
];
export const clamp = (tier: Tier, key: "agents" | "debateRounds" | "maxBuildRounds" | "images", v: number) =>
  Math.max(1, Math.min(v, LIMITS[tier][key]));

// How deep the team goes. Standard is the default: one debate round, revisions send only what changes,
// the second reviewer only checks drafts the first one passed, and no full-text polish pass.
export type Depth = "quick" | "standard" | "deep";
export const DEPTH: Record<
  Depth,
  {
    label: string;
    note: string;
    debateRounds: number;
    minRounds: number;
    maxRounds: number;
    polish: boolean;
    saver: { crossOnPassOnly?: boolean; sectionEdits?: boolean };
  }
> = {
  quick: {
    label: "Quick",
    note: "Fastest and cheapest: ideas → decision → one draft, reviewed.",
    debateRounds: 0,
    minRounds: 1,
    maxRounds: 2,
    polish: false,
    saver: { sectionEdits: true },
  },
  standard: {
    label: "Standard",
    note: "Recommended: one debate round; both reviewers check at the same time; up to two drafts.",
    debateRounds: 1,
    minRounds: 1,
    maxRounds: 2,
    polish: false,
    saver: { sectionEdits: true },
  },
  deep: {
    label: "Deep",
    note: "Most thorough: two debate rounds, a polish pass, both reviewers every round, full rewrites.",
    debateRounds: 2,
    minRounds: 2,
    maxRounds: 4,
    polish: true,
    saver: {},
  },
};
