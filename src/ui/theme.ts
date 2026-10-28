// Brand tokens, same as the website and the desktop app.
export const T = {
  ink: "#17132E",
  purple: "#7149F2",
  lime: "#DCF958",
  lilac: "#F3F1FB",
  line: "#DED9EF",
  muted: "#544F6E",
  white: "#FFFFFF",
  danger: "#C0392B",
  claude: "#D97757",
  gpt: "#10A37F",
  gemini: "#4285F4",
  muse: "#0866FF",
  radius: 16,
};
export const vendorColor: Record<string, string> = {
  anthropic: T.claude,
  openai: T.gpt,
  google: T.gemini,
  muse: T.muse,
  demo: T.purple,
  you: T.ink,
  relay: T.muse,
};
