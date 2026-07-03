import type { VitalStatus } from "./workspace-view";

/**
 * The glyph that encodes a DAG node's status by SHAPE first, colour second
 * ("Glyph dial", C1). `dot` variants map 1:1 to the `.mh-min-node-dot--*` CSS
 * classes; `hand` renders a Lucide Hand icon in the same slot (gated waits on a
 * person, so it gets an affordance instead of a coloured dot — gated and blocked
 * share the same ochre token, so shape is what separates them).
 */
export type NodeGlyph =
  | { kind: "dot"; variant: "pending" | "active" | "done" | "failed" | "blocked" }
  | { kind: "hand" };

export function nodeGlyph(status: VitalStatus): NodeGlyph {
  switch (status) {
    case "idle":
      return { kind: "dot", variant: "pending" };
    case "planning":
    case "running":
    case "verifying":
    case "repairing":
      return { kind: "dot", variant: "active" };
    case "done":
      return { kind: "dot", variant: "done" };
    case "failed":
      return { kind: "dot", variant: "failed" };
    case "gated":
      return { kind: "hand" };
    case "blocked":
    case "obsolete":
      return { kind: "dot", variant: "blocked" };
  }
}
