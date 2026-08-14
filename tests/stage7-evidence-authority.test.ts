import { describe, expect, it } from "vitest";
import { buildCandidateTreeManifest, buildEvidenceBinding } from "@manyhands/contracts";
import { compilePlan } from "@manyhands/decomposer";
import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";
import { RunCoordinator, RunEventSchema, type RunEvent, type RunEventInput } from "@manyhands/run-coordinator";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const at = "2026-08-14T12:00:00.000Z";

describe("Stage 7 evidence authority", () => {
  it("journals needs_input rather than executing an obligation without a materializable oracle", async () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const executed: string[] = [];
    const driver = new CanonicalExecutionDriver({
      coordinator: coordinator(compiled.graph.graphId),
      now: () => at,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        executed.push(input.node.id);
        return {
          kind: "needs_input" as const,
          reason: "Required validation obligations cannot be materialized: validation-api.",
          unmaterializedObligationIds: ["validation-api"]
        };
      }
    });

    const state = await driver.run({
      runId: "run-stage7-evidence",
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 1 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    expect(executed).toEqual(["unit:a"]);
    expect(state.lifecycle).toBe("waiting_for_input");
    expect(Object.values(state.attempts)).toEqual([
      expect.objectContaining({ nodeId: "unit:a", status: "failed" })
    ]);
    expect(Object.values(state.decisions)).toEqual([
      expect.objectContaining({ status: "pending", affectedNodeIds: ["unit:a"] })
    ]);
    expect(state.adoptedArtifacts).toEqual({});
  });

  it("rejects a seemingly verified product outcome when its evidence names a different retained candidate", async () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const driver = new CanonicalExecutionDriver({
      coordinator: coordinator(compiled.graph.graphId),
      now: () => at,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        const obligation = input.contract.validation.obligations[0];
        if (obligation === undefined) throw new Error("Test fixture supplied no validation obligation.");
        const canonicalObligation = compiled.contracts.validationObligations[obligation.id];
        if (canonicalObligation === undefined) throw new Error(`Test fixture supplied no canonical obligation for ${obligation.id}.`);
        const strategy = fixture.proofStrategies.find((proof) => proof.id === canonicalObligation.proofStrategy.id);
        if (strategy === undefined) throw new Error(`Test fixture supplied no proof strategy for ${canonicalObligation.proofStrategy.id}.`);
        const task = {
          id: input.contract.task.id,
          revision: Number(input.contract.task.revision),
          digest: "sha256:task"
        };
        const candidate = candidateManifest(`candidate:${input.attemptId}`, task, "c", "d");
        const staleCandidate = candidateManifest(`candidate:stale:${input.attemptId}`, task, "e", "f");
        const binding = buildEvidenceBinding({
          id: `evidence:${input.attemptId}`, revision: 1, goalContractDigest: fixture.goal.digest,
          criterionId: canonicalObligation.criterionId, obligationId: obligation.id,
          candidate: {
            manifestDigest: staleCandidate.manifestDigest,
            commitOid: staleCandidate.commitOid,
            treeOid: staleCandidate.treeOid
          },
          baseline: { commitOid: fixture.repositoryView.model.baseCommit, treeOid: fixture.repositoryView.treeSha },
          proofStrategyDigest: strategy.digest, mode: strategy.mode, authority: strategy.authority,
          recipeDigest: "sha256:recipe", environmentDigest: strategy.environmentPolicyDigest,
          selectorDigest: strategy.selectorDigest!, outputDigest: "sha256:output", outcome: "satisfied"
        }, stage5Sha256);
        return {
          kind: "success" as const,
          candidateCommit: candidate.commitOid,
          outputDigest: "sha256:output",
          changedFiles: input.contract.scope.allowedPaths,
          candidateManifest: candidate,
          evidenceMatrix: {
            matrixId: `matrix:${input.node.id}`,
            candidateCommit: candidate.commitOid,
            validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
            criteria: [{
              criterionId: obligation.criterionId, obligationId: obligation.id, status: "satisfied" as const,
              justification: "A fabricated candidate must not pass.", evidenceRefs: [binding.id]
            }],
            outcome: "verified" as const,
            validationRecipeDigest: "sha256:recipe",
            evidenceBindings: [binding],
            observations: []
          }
        };
      }
    });

    await expect(driver.run({
      runId: "run-stage7-evidence",
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 1 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit },
      evidenceAuthority: {
        goal: fixture.goal,
        baseline: { commitOid: fixture.repositoryView.model.baseCommit, treeOid: fixture.repositoryView.treeSha },
        validationObligations: compiled.contracts.validationObligations,
        proofStrategies: compiled.contracts.proofStrategies
      }
    })).rejects.toThrow(/stale_candidate_tree/i);
  });
});

function candidateManifest(id: string, contract: { id: string; revision: number; digest: string }, commit: string, tree: string) {
  return buildCandidateTreeManifest({
    id,
    contract,
    producerNodeId: "unit:a",
    producerAttemptId: "attempt:stage7",
    inputFingerprint: "sha256:fingerprint",
    repositoryObjectStoreId: "object-store:fixture",
    objectFormat: "sha1",
    sourceCandidate: { commitOid: commit.repeat(40), treeOid: tree.repeat(40) },
    retainedByRef: `refs/manyhands/tests/${id.replaceAll(":", "-")}`,
    kind: "candidate_tree",
    baseCommitOid: "a".repeat(40),
    commitOid: commit.repeat(40),
    treeOid: tree.repeat(40)
  }, stage5Sha256);
}

function coordinator(graphId: string): RunCoordinator {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-stage7-evidence", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Stage 7 evidence authority" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-stage7-evidence", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-stage7-evidence", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  return new RunCoordinator({
    events: {
      load: async () => structuredClone(events),
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
        const appended = inputs.map((input, index) => RunEventSchema.parse({ ...input, runId, sequence: expectedSequence + index + 1 }));
        events = [...events, ...appended];
        return appended;
      }
    },
    delivery: { publish: async () => { throw new Error("unused"); } },
    clock: () => at,
    eventId: (type, sequence) => `${type}:${sequence}`
  });
}
