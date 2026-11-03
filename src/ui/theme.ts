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
// System type (SF Pro / Roboto), one regular weight everywhere — hierarchy comes from size and grey, like Gmail.
export const F = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: "400" as const, letterSpacing: -0.2, color: T.ink },
  title: { fontSize: 21, lineHeight: 28, fontWeight: "400" as const, color: T.ink },
  head: { fontSize: 17, lineHeight: 23, fontWeight: "400" as const, color: T.ink },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const, letterSpacing: 0.1, color: T.ink },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const, letterSpacing: 0.1, color: T.sub },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const, letterSpacing: 0.6, color: T.sub },
};
export const vendorColor = (id: string): string =>
  getProvider(id)?.color ||
  ({ demo: T.purple, muse: T.muse, relay: T.muse, you: T.ink, passfair: T.purple } as Record<string, string>)[id] ||
  T.purple;
