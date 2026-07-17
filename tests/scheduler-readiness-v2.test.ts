import { describe, expect, it } from "vitest";
import { explainReadiness, selectReadyWaveV2 } from "@manyhands/scheduler";
import { bookingSnapshot, bookingBreakdown, compilerDependencies } from "./helpers/target-planning-fixtures";
import { compileGraphRevision } from "@manyhands/decomposer";

function graph() { return compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies).graph; }
const base = { adoptedArtifacts: [], pendingDecisions: [], materializableNodeIds: ["node-domain", "node-api", "node-ui"], activeResourceNodeIds: [], budgetAvailable: true, availableExecutorNodeIds: ["node-domain", "node-api", "node-ui"], adoptedNodeIds: [], currentContractRevisions: {} };

describe("artifact-aware readiness V2", () => {
  it("does not serialize siblings merely because they share a compatible seam", () => {
    const revision = graph();
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base }).reasons).not.toContainEqual(expect.objectContaining({ code: "seam" }));
    expect(selectReadyWaveV2({ graph: revision, nodeIds: ["node-domain", "node-api", "node-ui"], state: base, effectiveConfig: { maxParallel: 3 }, conflictConstraints: [] }).nodeIds).toEqual(["node-domain", "node-api", "node-ui"]);
  });

  it("blocks only an artifact consumer until the exact artifact is adopted", () => {
    const revision = graph();
    revision.artifactRequirements.push({ id: "req", artifactContract: { id: "artifact-contract", revision: "r2" }, producerNodeId: "node-domain", consumerNodeId: "node-api", requiredFor: "execution" });
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base }).reasons).toContainEqual(expect.objectContaining({ code: "missing_artifact", artifactId: "artifact-contract" }));
    expect(explainReadiness({ graph: revision, nodeId: "node-ui", ...base }).ready).toBe(true);
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base, adoptedArtifacts: [{ artifactId: "artifact-contract", revision: "r2", digest: "sha256:x" }] }).ready).toBe(true);
  });

  it("scopes a decision to its affected node set and explains every other blocker", () => {
    const revision = graph();
    const decision = { decisionId: "decision-1", affectedNodeIds: ["node-api"] };
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base, pendingDecisions: [decision] }).reasons).toContainEqual(expect.objectContaining({ code: "unresolved_decision" }));
    expect(explainReadiness({ graph: revision, nodeId: "node-ui", ...base, pendingDecisions: [decision] }).ready).toBe(true);
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base, materializableNodeIds: [], budgetAvailable: false, availableExecutorNodeIds: [], activeResourceNodeIds: ["node-api"] }).reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["unmaterializable_base", "active_resource_constraint", "budget_exhausted", "executor_unavailable"]));
    expect(explainReadiness({ graph: revision, nodeId: "node-api", ...base, adoptedNodeIds: ["node-api"], requiredContractRevisions: { "node-api": [{ id: "task", revision: "r2" }] }, currentContractRevisions: { task: "r1" } }).reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["stale_contract", "already_adopted"]));
  });

  it("requires maxParallel in the persisted effective config", () => {
    expect(() => selectReadyWaveV2({ graph: graph(), nodeIds: [], state: base, effectiveConfig: {} as { maxParallel: number }, conflictConstraints: [] })).toThrow(/maxParallel/i);
  });
});
