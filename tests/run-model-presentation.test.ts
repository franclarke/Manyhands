import { describe, expect, it } from "vitest";

import {
  bundledArtifactDeliveries,
  buildRelationViews,
  eventPresentation,
  relationLaneOffset,
  summarizeRunNodes
} from "@/lib/run-model/presentation";
import type { ConflictConstraint } from "@manyhands/task-graph";
import type { RunNodeView } from "@/lib/run-model/types";

describe("run graph presentation", () => {
  it("keeps the execution lens quiet until a node is selected", () => {
    const relations = buildRelationViews(graph(), "execution", null);

    expect(relations).toHaveLength(4);
    expect(relations.every((relation) => relation.kind === "hierarchy")).toBe(true);
  });

  it("reveals one independently routable edge per relation kind in the selected neighborhood", () => {
    const relations = buildRelationViews(graph(), "execution", "ui");
    const secondary = relations.filter((relation) => relation.kind !== "hierarchy");

    expect(secondary).toHaveLength(5);
    expect(secondary.map((relation) => ({
      nodes: [relation.source, relation.target].sort(),
      kind: relation.kind,
      count: relation.relationCount
    }))).toEqual([
      { nodes: ["domain", "ui"], kind: "artifact", count: 1 },
      { nodes: ["storage", "ui"], kind: "artifact", count: 1 },
      { nodes: ["domain", "ui"], kind: "contract", count: 1 },
      { nodes: ["storage", "ui"], kind: "contract", count: 1 },
      { nodes: ["storage", "ui"], kind: "conflict", count: 1 }
    ]);
  });

  it("bundles duplicates only when both their node pair and relation kind match", () => {
    const duplicated = graph();
    duplicated.conflictEdges.push({
      id: "conflict-storage-ui-2",
      leftNodeId: "storage",
      rightNodeId: "ui",
      reason: "Competing edits",
      risk: "high"
    });

    const relations = buildRelationViews(duplicated, "all", null);
    const storageUi = relations.filter((relation) => (
      relation.id.includes("storage") && relation.id.includes("ui")
    ));

    expect(storageUi.map((relation) => relation.kind)).toEqual(["artifact", "contract", "conflict"]);
    expect(storageUi.find((relation) => relation.kind === "conflict")?.relationCount).toBe(2);
  });

  it("preserves persisted relation detail for an accessible edge disclosure", () => {
    const relations = buildRelationViews(graph(), "all", null);
    const artifact = relations.find((relation) => relation.id === "relations:artifact:storage:ui");
    const contract = relations.find((relation) => relation.id === "relations:contract:storage:ui");
    const conflict = relations.find((relation) => relation.id === "relations:conflict:storage:ui");

    expect(artifact?.details).toEqual([{
      id: "artifact-storage-ui",
      kind: "artifact",
      contractId: "artifact-storage-ui-contract",
      contractRevision: "v1",
      requiredFor: "execution"
    }]);
    expect(contract?.details).toEqual([{
      id: "seam-storage-ui",
      kind: "contract",
      contractId: "seam-storage-ui-contract",
      contractRevision: "v1",
      producerRevision: "v1",
      consumerRevision: "v1"
    }]);
    expect(conflict?.details).toEqual([{
      id: "conflict-storage-ui",
      kind: "conflict",
      reason: "Shared files",
      risk: "medium"
    }]);
  });

  it("assigns a separate vertical lane to every secondary relation kind", () => {
    expect(relationLaneOffset("artifact")).toBe(18);
    expect(relationLaneOffset("contract")).toBe(36);
    expect(relationLaneOffset("conflict")).toBe(54);
    expect(relationLaneOffset("hierarchy")).toBe(0);
  });

  it("absorbs child deliverables into their ancestor instead of drawing return loops", () => {
    const artifactRelations = buildRelationViews(graph(), "artifact", null);

    expect(artifactRelations.some((relation) => relation.source === "foundation" && relation.target === "root")).toBe(false);
    expect(bundledArtifactDeliveries(graph(), "root")).toBe(1);
  });
});

describe("run summary presentation", () => {
  it("does not count the coordinating root as an active agent or executable result", () => {
    const summary = summarizeRunNodes([
      node("root", "root", "running"),
      node("domain", "leaf", "running"),
      node("ui", "leaf", "waiting"),
      node("storage", "leaf", "succeeded")
    ]);

    expect(summary).toEqual({
      executableCount: 3,
      completedExecutables: 1,
      activeAgents: 1,
      blockedAgents: 1,
      coordinatingNodes: 1
    });
  });
});

describe("activity presentation", () => {
  it("humanizes known internal event names and classifies diagnostics", () => {
    expect(eventPresentation("readiness.observed")).toEqual({
      label: "Disponibilidad recalculada",
      diagnostic: true
    });
    expect(eventPresentation("graph.revision.proposed")).toEqual({
      label: "Revisión del grafo propuesta",
      diagnostic: true
    });
    expect(eventPresentation("attempt.started")).toEqual({
      label: "Agente iniciado",
      diagnostic: false
    });
  });
});

function node(id: string, kind: RunNodeView["kind"], status: RunNodeView["status"]): RunNodeView {
  return {
    id,
    parentId: kind === "root" ? null : "root",
    kind,
    title: id,
    goal: id,
    status,
    artifactCount: 0,
    decisionCount: 0
  };
}

function graph() {
  return {
    // The workspace renders its own graph view, fed from either the canonical
    // revision or a historical one. These relations are the historical shape,
    // which is what keeps a legacy journal covered.
    source: "legacy" as const,
    graphId: "graph-1",
    revision: 1,
    rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, kind: "root" as const, title: "Root", goal: "Root" },
      foundation: { id: "foundation", parentId: "root", kind: "leaf" as const, title: "Foundation", goal: "Foundation" },
      domain: { id: "domain", parentId: "root", kind: "leaf" as const, title: "Domain", goal: "Domain" },
      ui: { id: "ui", parentId: "root", kind: "leaf" as const, title: "UI", goal: "UI" },
      storage: { id: "storage", parentId: "root", kind: "leaf" as const, title: "Storage", goal: "Storage" }
    },
    artifactEdges: [
      artifact("artifact-domain-ui", "domain", "ui"),
      artifact("artifact-storage-ui", "storage", "ui"),
      artifact("artifact-foundation-root", "foundation", "root")
    ],
    seamEdges: [
      seam("seam-domain-ui", "domain", "ui"),
      seam("seam-storage-ui", "storage", "ui")
    ],
    conflictEdges: [
      { id: "conflict-storage-ui", leftNodeId: "ui", rightNodeId: "storage", reason: "Shared files", risk: "medium" as ConflictConstraint["risk"] }
    ]
  };
}

function artifact(id: string, producerNodeId: string, consumerNodeId: string) {
  return {
    id,
    contractId: `${id}-contract`,
    contractRevision: "v1",
    producerNodeId,
    consumerNodeId,
    requiredFor: "execution" as const
  };
}

function seam(id: string, producerNodeId: string, consumerNodeId: string) {
  return {
    id,
    contractId: `${id}-contract`,
    contractRevision: "v1",
    producerNodeId,
    consumerNodeId,
    producerRevision: "v1",
    consumerRevision: "v1"
  };
}
