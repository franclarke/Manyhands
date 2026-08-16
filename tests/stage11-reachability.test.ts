import { describe, expect, it } from "vitest";

import { GOLDEN_FIXTURES } from "@/lib/run-model/fixtures";
import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunEvent, RunModel, RunSeed } from "@/lib/run-model/types";

import { compileStage9Graph } from "./helpers/stage9-driver-harness.js";

const at = "2026-08-16T00:00:00.000Z";

/**
 * Gate GObs: no rendered domain value lacks a journal fact behind it.
 *
 * The defect this exists to prevent was not a wrong value, it was an invented
 * one. A finished three-node run rendered a single node titled "Diseñando la
 * solución" — a sentence no event ever contained, standing for a unit that
 * never existed — while the lifecycle badge correctly read `Delivered`. Nothing
 * about the run was wrong; the workspace was showing a value it had made up
 * because it could not read the one the daemon recorded.
 *
 * The check below is mechanical over an arbitrary journal, which is the point:
 * "we looked and it seemed fine" is exactly what shipped the placeholder.
 *
 * What it covers: identity and prose — the ids that say a thing exists, and the
 * text a person reads. What it deliberately does not cover: derived values such
 * as a node's execution status or a lens's counts, which are computed from
 * events rather than copied out of them. Those are derivation, not invention,
 * and asserting they appear verbatim in the journal would only teach the guard
 * to accept anything.
 */
describe("Every value the workspace shows", () => {
  it("comes from the journal when the daemon compiled the graph", () => {
    const { compiled } = compileStage9Graph();
    const events = [created(1), compiledEvent(compiled)];
    const model = buildRunModel(seed("running"), events);

    const audited = audit(model, seed("running"), events);
    expect(model.graph?.source).toBe("canonical");
    expect(model.nodes.length).toBeGreaterThan(1);
    expect(audited.unreachable).toEqual([]);
    expect(audited.checked).toBeGreaterThanOrEqual(20);
  });

  it("comes from the journal on a historical run recorded before the canonical graph", () => {
    // The legacy revision is a different record with different relations. It
    // still has to be the source of everything drawn from it, or "read-only
    // history" would just mean the invented values are older.
    const fixture = GOLDEN_FIXTURES["golden-password-recovery"];
    const model = buildRunModel(fixture.seed, fixture.events);

    const audited = audit(model, fixture.seed, fixture.events);
    expect(model.graph?.source).toBe("legacy");
    expect(audited.unreachable).toEqual([]);
    expect(audited.checked).toBeGreaterThanOrEqual(20);
  });

  it("comes from the journal on a run that failed before compiling anything", () => {
    const events = [
      created(1),
      discovered(2, "unit:a", "Extraer el validador"),
      failed(3)
    ];
    const model = buildRunModel(seed("failed"), events);

    const audited = audit(model, seed("failed"), events);
    expect(model.nodes.map(({ id }) => id)).toEqual(["unit:a"]);
    expect(audited.unreachable).toEqual([]);
    expect(audited.checked).toBeGreaterThanOrEqual(3);
  });

  it("is the placeholder, and only the placeholder, while planning has named nothing", () => {
    // One node is drawn from no fact at all: the pre-planning placeholder,
    // which stands for work about to be named. It is admissible only because
    // the model marks the whole graph provisional, so it can never be mistaken
    // for a unit the run actually has — and it cannot outlive `graph.compiled`.
    const events = [created(1)];
    const model = buildRunModel(seed("planning"), events);

    expect(model.graph?.source).toBe("provisional");
    expect(model.graphPhase).toBe("provisional");
    expect(audit(model, seed("planning"), events).unreachable.length).toBeGreaterThan(0);
  });

  it("would be caught by this guard if a component invented one", () => {
    // A guard nobody has seen fail is a guard nobody knows works. This is the
    // exact defect: a node the journal never mentioned, titled with a sentence
    // the view wrote.
    const { compiled } = compileStage9Graph();
    const events = [created(1), compiledEvent(compiled)];
    const model = buildRunModel(seed("running"), events);
    const fabricated: RunModel = {
      ...model,
      nodes: [...model.nodes, {
        ...model.nodes[0]!,
        id: "planning-root:run-1",
        title: "Diseñando la solución",
        goal: "Diseñando la solución"
      }]
    };

    expect(audit(fabricated, seed("running"), events).unreachable).toEqual([
      "node.id=planning-root:run-1",
      "node.title=Diseñando la solución",
      "node.goal=Diseñando la solución"
    ]);
  });
});

/**
 * Every identity and every sentence the model exposes that the journal does not
 * contain, named by where it came from — plus how many were examined.
 *
 * The count is asserted by the callers on purpose. A reachability guard that
 * silently starts checking nothing still reports zero violations, which is the
 * one way a test like this fails without anyone noticing.
 */
function audit(model: RunModel, seed: RunSeed, events: readonly RunEvent[]): {
  checked: number;
  unreachable: string[];
} {
  const journal = JSON.stringify({ seed, events });
  const claims: Array<[string, string | null | undefined]> = [];

  for (const node of model.nodes) {
    claims.push(["node.id", node.id], ["node.title", node.title], ["node.goal", node.goal]);
    if (node.parentId !== null) claims.push(["node.parentId", node.parentId]);
  }
  const graph = model.graph;
  if (graph !== null && graph.source !== "provisional") {
    claims.push(["graph.graphId", graph.graphId], ["graph.rootId", graph.rootId]);
    for (const edge of graph.artifactEdges) {
      claims.push(
        ["artifactEdge.id", edge.id],
        ["artifactEdge.producerNodeId", edge.producerNodeId],
        ["artifactEdge.consumerNodeId", edge.consumerNodeId],
        ["artifactEdge.contractId", edge.contractId]
      );
    }
    for (const edge of graph.seamEdges) {
      claims.push(
        ["seamEdge.id", edge.id],
        ["seamEdge.producerNodeId", edge.producerNodeId],
        ["seamEdge.consumerNodeId", edge.consumerNodeId],
        ["seamEdge.contractId", edge.contractId]
      );
    }
    for (const edge of graph.conflictEdges) {
      claims.push(["conflictEdge.id", edge.id], ["conflictEdge.reason", edge.reason]);
    }
  }
  for (const contract of model.contracts) {
    claims.push(["contract.taskId", contract.taskId]);
  }

  const named = claims.filter((claim): claim is [string, string] =>
    typeof claim[1] === "string" && claim[1].length > 0);
  return {
    checked: named.length,
    unreachable: named
      .filter(([, value]) => !journal.includes(JSON.stringify(value).slice(1, -1)))
      .map(([source, value]) => `${source}=${value}`)
  };
}

function seed(lifecycle: RunSeed["lifecycle"]): RunSeed {
  return {
    id: "run-1",
    title: "Reachability",
    goal: "Render only what the journal records",
    lifecycle,
    eventSequence: 0
  };
}

function event(seq: number, type: string, payload: Record<string, unknown>): RunEvent {
  return { eventId: `e${seq}`, seq, at, runId: "run-1", actor: "system", type, payload };
}

function created(seq: number): RunEvent {
  return event(seq, "run.created", { goal: "Render only what the journal records" });
}

function discovered(seq: number, nodeId: string, title: string): RunEvent {
  return event(seq, "planning.node_discovered", {
    attempt: 1,
    node: {
      nodeId,
      parentNodeId: null,
      key: "a",
      parentKey: null,
      kind: "composite",
      title,
      objective: title,
      siblingIndex: 0,
      siblingCount: 1
    }
  });
}

function failed(seq: number): RunEvent {
  return event(seq, "planning.failed", { reason: "schema_invalid: units" });
}

function compiledEvent(compiled: ReturnType<typeof compileStage9Graph>["compiled"]): RunEvent {
  return event(2, "graph.compiled", {
    graphId: compiled.graph.graphId,
    revision: compiled.graph.revision,
    graph: compiled.graph,
    contracts: Object.values(compiled.contracts.taskBundles),
    review: {},
    trace: {}
  });
}
