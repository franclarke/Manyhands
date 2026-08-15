import { describe, expect, it } from "vitest";

import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";

import { compileStage9Graph } from "./helpers/stage9-driver-harness.js";

const at = "2026-08-15T00:00:00.000Z";

/**
 * A finished three-node run rendered as one node reading "Diseñando la
 * solución" — the placeholder from before planning — while the lifecycle badge
 * correctly said `Delivered`.
 *
 * `graph.compiled` carries the canonical `GraphRevision`; the reducer parsed it
 * with `LegacyGraphRevisionV2Schema`, the parse failed silently, and the model
 * fell back to the provisional graph. Nothing was wrong with the run and
 * nothing was wrong with the renderer: the workspace was showing a value it
 * invented because it could not read the one the daemon recorded.
 */
describe("The run model reads the canonical graph", () => {
  it("renders every node the daemon compiled", () => {
    const { compiled } = compileStage9Graph();
    const model = buildRunModel(seed(), [created(1), compiledEvent(compiled)]);

    expect(model.graphPhase).toBe("compiled");
    expect(model.graph?.source).toBe("canonical");
    expect(Object.keys(model.graph?.nodes ?? {}).sort())
      .toEqual(Object.keys(compiled.graph.nodes).sort());
    expect(model.nodes).toHaveLength(Object.keys(compiled.graph.nodes).length);
  });

  it("preserves the role and parentage of each node", () => {
    const { compiled } = compileStage9Graph();
    const model = buildRunModel(seed(), [created(1), compiledEvent(compiled)]);

    for (const [id, node] of Object.entries(compiled.graph.nodes)) {
      const view = model.graph?.nodes[id];
      expect(view, `node ${id} is missing from the view`).toBeDefined();
      expect(view?.kind).toBe(node.kind);
      expect(view?.parentId ?? null).toBe(node.parentId ?? null);
      expect(view?.title).toBe(node.title);
    }
    expect(model.graph?.rootId).toBe(compiled.graph.rootId);
  });

  it("carries the artifact and seam relations the graph declares", () => {
    const { compiled } = compileStage9Graph();
    const model = buildRunModel(seed(), [created(1), compiledEvent(compiled)]);

    expect(model.graph?.artifactEdges.map(({ id }) => id).sort())
      .toEqual(compiled.graph.artifactRequirements.map(({ id }) => id).sort());
    expect(model.graph?.seamEdges.map(({ id }) => id).sort())
      .toEqual(compiled.graph.seamBindings.map(({ id }) => id).sort());
  });

  it("marks a pre-planning graph as provisional rather than compiled", () => {
    const model = buildRunModel(seed(), [
      created(1)
    ]);

    expect(model.graphPhase).toBe("provisional");
    expect(model.graph?.source).toBe("provisional");
  });

  it("never leaves a provisional placeholder standing once a graph is compiled", () => {
    // The exact defect: the placeholder outlived planning, execution,
    // integration and delivery.
    const { compiled } = compileStage9Graph();
    const model = buildRunModel(seed(), [
      created(1),
      compiledEvent(compiled)
    ]);

    expect(model.graph?.source).toBe("canonical");
    expect(Object.values(model.graph?.nodes ?? {}).map(({ title }) => title))
      .not.toContain("Diseñando la solución");
  });
});

function created(seq: number): RunEvent {
  return {
    eventId: `created-${seq}`,
    seq,
    at,
    runId: "run-1",
    actor: "system",
    type: "run.created",
    payload: { goal: "Render what the daemon compiled" }
  };
}

function seed(): RunSeed {
  return {
    id: "run-1",
    title: "Stage 11 canonical graph",
    goal: "Render what the daemon compiled",
    lifecycle: "running",
    eventSequence: 0
  };
}

function compiledEvent(compiled: ReturnType<typeof compileStage9Graph>["compiled"]): RunEvent {
  return {
    eventId: "graph-compiled",
    seq: 2,
    at,
    runId: "run-1",
    actor: "system",
    type: "graph.compiled",
    payload: {
      graphId: compiled.graph.graphId,
      revision: compiled.graph.revision,
      graph: compiled.graph,
      contracts: Object.values(compiled.contracts.taskBundles),
      review: {},
      trace: {}
    }
  };
}
