import { describe, expect, it } from "vitest";

import { compilePlan } from "@manyhands/decomposer";
import {
  evaluateReadiness,
  selectFrontier,
  type CanonicalReadinessSnapshot
} from "@manyhands/scheduler";

import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture";

function compiledFixture() {
  const fixture = stage5Fixture();
  const compilation = compilePlan({
    ...fixture,
    hasher: stage5Sha256,
    idFactory: (kind, parts) => [kind, ...parts].join(":")
  });
  if (!compilation.ok) throw new Error(compilation.findings.map(({ message }) => message).join("; "));
  return compilation;
}

function snapshot(overrides: Partial<CanonicalReadinessSnapshot> = {}): CanonicalReadinessSnapshot {
  const compiled = compiledFixture();
  return {
    graph: compiled.graph,
    contracts: compiled.contracts,
    adoptedArtifacts: [],
    pendingDecisions: [],
    activeNodeIds: [],
    activeRuntimeLeases: [],
    availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
    adoptedNodeIds: [],
    budgetAvailable: true,
    ...overrides
  };
}

describe("Stage 6 canonical frontier", () => {
  it("explains hard readiness from exact artifacts and scoped decisions", () => {
    const first = evaluateReadiness(snapshot());
    expect(first.ready.map(({ nodeId }) => nodeId)).toContain("unit:a");
    expect(first.blocked).toContainEqual(expect.objectContaining({
      nodeId: "unit:b",
      reasons: expect.arrayContaining([expect.objectContaining({ code: "missing_artifact" })])
    }));

    const second = evaluateReadiness(snapshot({
      adoptedArtifacts: [{
        artifactId: "artifact:a",
        revision: 1,
        digest: "sha256:artifact-a"
      }],
      pendingDecisions: [{ decisionId: "decision:a", affectedNodeIds: ["unit:a"] }]
    }));
    expect(second.ready.map(({ nodeId }) => nodeId)).toContain("unit:b");
    expect(second.blocked).toContainEqual(expect.objectContaining({
      nodeId: "unit:a",
      reasons: expect.arrayContaining([expect.objectContaining({ code: "unresolved_decision" })])
    }));
  });

  it("blocks a modification whose overlap with active work is unknown instead of serializing it", () => {
    const compiled = compiledFixture();
    const claim = compiled.graph.resourceClaims.find(({ nodeId }) => nodeId === "unit:a");
    if (claim === undefined) throw new Error("fixture must compile a resource claim for unit:a");
    const evaluation = evaluateReadiness(snapshot({
      activeNodeIds: ["unit:active"],
      activeResourceClaims: [{ ...claim, nodeId: "unit:active", resourceId: "resource:unresolved" }]
    }));
    expect(evaluation.blocked).toContainEqual(expect.objectContaining({
      nodeId: "unit:a",
      reasons: expect.arrayContaining([expect.objectContaining({ code: "resource_overlap_unknown" })])
    }));
  });

  it("uses integration risk only after hard readiness, changing selection rather than readiness", () => {
    const readiness = evaluateReadiness(snapshot({
      adoptedArtifacts: [{ artifactId: "artifact:a", revision: 1, digest: "sha256:artifact-a" }]
    }));
    const eligible = readiness.ready.filter(({ nodeId }) => ["unit:a", "unit:b"].includes(nodeId));
    expect(eligible.map(({ nodeId }) => nodeId)).toEqual(["unit:a", "unit:b"]);

    const low = selectFrontier({
      ready: eligible,
      policy: { maxParallel: 2 },
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] })
    });
    const high = selectFrontier({
      ready: eligible,
      policy: { maxParallel: 2 },
      estimateIntegrationRisk: ({ nodeId }) => ({ score: nodeId === "unit:b" ? 100 : 0, evidenceRefs: ["evidence:risk"] })
    });

    expect(low.selected.map(({ nodeId }) => nodeId)).toEqual(["unit:a", "unit:b"]);
    expect(high.selected.map(({ nodeId }) => nodeId)).toEqual(["unit:a"]);
    expect(high.deferred).toContainEqual(expect.objectContaining({ nodeId: "unit:b", reason: "integration_risk_concurrency" }));
  });

  it("blocks an incompatible runtime lease as a hard prerequisite", () => {
    const input = snapshot();
    input.graph.runtimeLeaseClaims = [{
      id: "lease:a",
      nodeId: "unit:a",
      provider: "filesystem",
      resourceKey: "worktree:shared",
      mode: "exclusive",
      phase: "implementation"
    }];
    input.activeRuntimeLeases = [{
      id: "lease:active",
      nodeId: "unit:b",
      provider: "filesystem",
      resourceKey: "worktree:shared",
      mode: "exclusive",
      phase: "implementation"
    }];

    const blocked = evaluateReadiness(input).blocked.find(({ nodeId }) => nodeId === "unit:a");
    expect(blocked?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "runtime_lease_conflict", activeNodeId: "unit:b" })
    ]));
  });

  it("does not turn a same-resource writer collision into a risk score", () => {
    const input = snapshot({
      adoptedArtifacts: [{ artifactId: "artifact:a", revision: 1, digest: "sha256:artifact-a" }]
    });
    input.graph.resourceClaims = input.graph.resourceClaims.map((claim) =>
      claim.nodeId === "unit:b" ? { ...claim, resourceId: "resource:a" } : claim
    );
    const ready = evaluateReadiness(input).ready.filter(({ nodeId }) => ["unit:a", "unit:b"].includes(nodeId));
    const selection = selectFrontier({
      ready,
      graph: input.graph,
      policy: { maxParallel: 2 },
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] })
    });

    expect(selection.selected.map(({ nodeId }) => nodeId)).toEqual(["unit:a"]);
    expect(selection.deferred).toContainEqual(expect.objectContaining({
      nodeId: "unit:b",
      reason: "resource_claim_conflict"
    }));
  });
});
