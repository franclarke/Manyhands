/**
 * Operating the graph without a mouse.
 *
 * React Flow puts every node in the tab order and gives it `role="group"`, but
 * it does not activate one: selection was wired to `onNodeClick` alone, so a
 * keyboard user could reach all three nodes of a finished run and find that
 * Enter did nothing.
 *
 * The DOM contract used here is the one React Flow publishes — a
 * `.react-flow__node` wrapper carrying `data-id` — which is why this can be a
 * pure function over a target rather than a component that has to be mounted to
 * be believed.
 */

/** The minimum of an element this needs; anything DOM-shaped satisfies it. */
export interface ActivationTarget {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/**
 * The node an activation landed on, or nothing.
 *
 * Only Enter and Space count. Arrow keys pan the canvas and Tab moves on;
 * claiming those would take navigation away from the user to do something they
 * did not ask for.
 */
export function activatedNodeId(input: {
  key: string;
  target: ActivationTarget | null;
}): string | null {
  if (input.key !== "Enter" && input.key !== " ") return null;
  const wrapper = input.target?.closest(".react-flow__node");
  if (wrapper === null || wrapper === undefined) return null;
  const id = wrapper.getAttribute("data-id");
  return id === null || id.length === 0 ? null : id;
}

const KIND_NAME: Record<"root" | "composite" | "leaf" | "integrator", string> = {
  root: "Objetivo",
  composite: "Coordina",
  leaf: "Ejecuta",
  integrator: "Integra"
};

/**
 * What a focused node announces.
 *
 * The card's own text is laid out for the eye — a kind badge, a title, a
 * truncated goal, a status pill — and read in source order it arrives as
 * fragments. This is the sentence, and it says only what it was given.
 */
export function graphNodeAccessibleName(node: {
  title: string;
  kind: "root" | "composite" | "leaf" | "integrator";
  status?: string | undefined;
  /** Only the flow arrangement has levels; the band rail behind them is `aria-hidden`. */
  bandLevel?: number | undefined;
}): string {
  return [node.title, KIND_NAME[node.kind], node.status, bandPosition(node.bandLevel)]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(". ");
}

function bandPosition(level: number | undefined): string | undefined {
  if (level === undefined) return undefined;
  if (level === 0) return "Nivel 0, sin dependencias";
  return `Nivel ${level}, tras ${level === 1 ? "1 dependencia" : `${level} dependencias`}`;
}
