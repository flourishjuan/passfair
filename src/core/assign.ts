import { type Assignments, type PresetId, presets } from "./orchestrator";
import type { ProviderId } from "./providers";

const isLogic = (p: string) => p === "anthropic" || /claude/i.test(p);
const isStyle = (p: string) => p === "openai" || /gpt/i.test(p);

// Preset-driven seat assignment: Claude for logic, GPT for polish, whatever is connected otherwise.
// Cross-check: when two or more agents are connected, a second reviewer ("verifier") from a different
// vendor than the main reviewer checks every round, so Claude and GPT audit each other.
export function autoAssign(preset: PresetId, connected: ProviderId[]): Assignments {
  if (!connected.length)
    return {
      planner: "demo",
      worker: "demo",
      polisher: presets[preset].roles.polisher ? "demo" : undefined,
      reviewer: "demo",
      verifier: "demo",
    };
  const first = connected[0];
  const logic = connected.find(isLogic) || first;
  const style = connected.find(isStyle) || connected.find((p) => p !== logic) || first;
  const other = connected.find((p) => p !== logic) || first;
  const a: Assignments = { planner: logic, worker: logic, reviewer: preset === "balanced" ? other : logic };
  if (preset === "copy_first") {
    a.worker = style;
    a.polisher = style;
    a.reviewer = logic;
  }
  if (preset === "make_and_ship") {
    a.worker = logic;
    a.polisher = style;
    a.reviewer = logic;
  }
  const cross = connected.find((p) => p !== a.reviewer);
  if (cross) a.verifier = cross;
  return a;
}

// Seat order for a brainstorm panel: logic first (it frames and decides), then style, then the rest.
export function panelOrder(ids: ProviderId[]): ProviderId[] {
  const logic = ids.find(isLogic);
  const style = ids.find((p) => isStyle(p) && p !== logic);
  return [...(logic ? [logic] : []), ...(style ? [style] : []), ...ids.filter((p) => p !== logic && p !== style)];
}
