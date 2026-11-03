// Design tokens. Calm, white, borderless, big readable type — modelled on Muse's chat-first layout.
// Brand purple and lime stay as accents only.
import { getProvider } from "../core/providers";

export const T = {
  bg: "#FFFFFF",
  surface: "#F3F3F6",
  surface2: "#E9E8EF",
  ink: "#0B0A12",
  sub: "#5F5D6B",
  faint: "#A3A1AD",
  line: "#EEEDF2",
  purple: "#7149F2",
  purpleSoft: "#EFEAFE",
  lime: "#DCF958",
  limeSoft: "#F5FDD6",
  pass: "#E8F7EE",
  passInk: "#0F6E3B",
  revise: "#FFF4E0",
  reviseInk: "#8A5700",
  danger: "#C0392B",
  dangerSoft: "#FDECEC",
  white: "#FFFFFF",
  muse: "#0866FF",
  radius: 22,
};
// System type (SF Pro / Roboto), weights and tracking close to Muse.
export const F = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.8, color: T.ink },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const, letterSpacing: -0.4, color: T.ink },
  head: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const, letterSpacing: -0.2, color: T.ink },
  body: { fontSize: 16, lineHeight: 24, color: T.ink },
  small: { fontSize: 13, lineHeight: 18, color: T.sub },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 0.3, color: T.sub },
};
export const vendorColor = (id: string): string =>
  getProvider(id)?.color ||
  ({ demo: T.purple, muse: T.muse, relay: T.muse, you: T.ink, passfair: T.purple } as Record<string, string>)[id] ||
  T.purple;
