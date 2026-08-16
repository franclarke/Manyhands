import { describe, expect, it } from "vitest";

import { activatedNodeId, graphNodeAccessibleName } from "@/lib/run-model/graph-keyboard";

/**
 * The graph is the workspace's central object and it could not be operated
 * without a mouse.
 *
 * React Flow puts every node in the tab order — `tabindex="0"`, `role="group"`
 * — so a keyboard user reaches all three nodes of a finished run and then finds
 * that Enter does nothing: selection was wired to `onNodeClick` alone. And the
 * focused element carried no accessible name, so what the user reached was
 * three unnamed groups.
 */
describe("Operating the graph from the keyboard", () => {
  it("selects the node the key was pressed on", () => {
    expect(activatedNodeId({ key: "Enter", target: nodeWrapper("unit:tokenizer") })).toBe("unit:tokenizer");
    expect(activatedNodeId({ key: " ", target: nodeWrapper("unit:root") })).toBe("unit:root");
  });

  it("ignores keys that are not an activation", () => {
    // Arrow keys pan the canvas and Tab moves on. Claiming those would take
    // navigation away from the user to do something they did not ask for.
    for (const key of ["ArrowRight", "Tab", "Escape", "a"]) {
      expect(activatedNodeId({ key, target: nodeWrapper("unit:root") })).toBeNull();
    }
  });

  it("ignores an activation that did not land on a node", () => {
    expect(activatedNodeId({ key: "Enter", target: null })).toBeNull();
    expect(activatedNodeId({ key: "Enter", target: { closest: () => null } })).toBeNull();
  });

  it("ignores a node the canvas rendered without an identity", () => {
    expect(activatedNodeId({ key: "Enter", target: { closest: () => ({ getAttribute: () => null }) } })).toBeNull();
  });
});

describe("What a focused node announces", () => {
  it("names the unit, its role and where it stands", () => {
    expect(graphNodeAccessibleName({
      title: "Tokenizer module",
      kind: "leaf",
      status: "Entregado"
    })).toBe("Tokenizer module. Ejecuta. Entregado");
  });

  it("says where the node sits when the arrangement has levels", () => {
    // The band rail is `aria-hidden`, so this is the only place the level
    // reaches assistive tech — attached to the node it describes rather than
    // announced between every pair of nodes.
    expect(graphNodeAccessibleName({ title: "Root", kind: "root", bandLevel: 0 }))
      .toBe("Root. Objetivo. Nivel 0, sin dependencias");
    expect(graphNodeAccessibleName({ title: "A", kind: "leaf", bandLevel: 1 }))
      .toBe("A. Ejecuta. Nivel 1, tras 1 dependencia");
    expect(graphNodeAccessibleName({ title: "B", kind: "leaf", bandLevel: 2 }))
      .toBe("B. Ejecuta. Nivel 2, tras 2 dependencias");
  });

  it("says nothing it was not given", () => {
    expect(graphNodeAccessibleName({ title: "Tokenizer module", kind: "root" }))
      .toBe("Tokenizer module. Objetivo");
  });
});

function nodeWrapper(id: string) {
  return { closest: (selector: string) => selector === ".react-flow__node" ? { getAttribute: () => id } : null };
}
