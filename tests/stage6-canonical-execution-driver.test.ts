import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compilePlan } from "@manyhands/decomposer";
import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";
import { RunCoordinator, RunEventSchema, type RunEvent, type RunEventInput } from "@manyhands/run-coordinator";

import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const at = "2026-08-13T12:00:00.000Z";

describe("Stage 6 canonical execution driver", () => {
  it("executes the direct GraphRevision without a legacy graph projection or pairwise constraints", async () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const harness = coordinator(compiled.graph.graphId);
    const executed: string[] = [];
    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        executed.push(input.node.id);
        const obligation = input.contract.validation.obligations[0]!;
        return {
          kind: "success",
          candidateCommit: oid(input.node.id),
          outputDigest: `sha256:${input.node.id}`,
          changedFiles: input.contract.scope.allowedPaths,
          artifactManifests: manifestsFor(input),
          evidenceMatrix: {
            matrixId: `matrix-${input.node.id}`,
            candidateCommit: oid(input.node.id),
            validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
            criteria: [{
              criterionId: obligation.criterionId,
              obligationId: obligation.id,
              status: "satisfied",
              justification: "Fake executor verified the exact candidate.",
              evidenceRefs: ["evidence:fake"]
            }],
            outcome: "verified",
            validationRecipeDigest: "sha256:fake",
            observations: [],
            evidenceBindings: []
          },
          ...(input.node.id === compiled.graph.rootId ? {
            integrationManifestId: "integration-root",
            finalManifestId: "final-root",
            finalManifest: {
              commitSha: oid(input.node.id),
              treeSha: "c".repeat(40),
              graphRevision: input.graph.revision,
              artifactIds: Object.keys(compiled.contracts.artifacts),
              evidenceMatrixId: `matrix-${input.node.id}`,
              validationRecipeDigest: "sha256:fake",
              deliveryTarget: "main"
            }
          } : {})
        };
      }
    });

    const state = await driver.run({
      runId: "run-stage6-canonical",
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 1 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    expect(executed).toEqual(expect.arrayContaining(Object.keys(compiled.graph.nodes)));
    expect(Object.values(state.adoptedArtifacts)).toHaveLength(Object.keys(compiled.contracts.artifacts).length);
    expect(Object.values(state.adoptedArtifacts)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "manifest",
        location: expect.stringMatching(/^sha256:/u),
        manifest: expect.objectContaining({ kind: "change_set" })
      })
    ]));
    expect(state.lifecycle).not.toBe("running");
  });

  it("records a failed physical attempt once and blocks only that node behind a decision", async () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const harness = coordinator(compiled.graph.graphId);
    const calls: string[] = [];
    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        calls.push(input.node.id);
        return { kind: "failure", reason: "fake executor failed safely" };
      }
    });

    const state = await driver.run({
      runId: "run-stage6-canonical",
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 1 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    expect(calls).toEqual(["unit:a"]);
    expect(Object.values(state.decisions).some((decision) =>
      decision.status === "pending" && decision.affectedNodeIds.includes("unit:a")
    )).toBe(true);
    expect(Object.values(state.adoptedArtifacts)).toHaveLength(0);
  });

  it("creates a causally distinct retry after an operator resolves a leaf failure", async () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: (kind, parts) => [kind, ...parts].join(":") });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const harness = coordinator(compiled.graph.graphId);
    const inputs: Array<{ attemptId: string; inputFingerprint: string; priorFailure?: unknown }> = [];
    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        inputs.push({ attemptId: input.attemptId, inputFingerprint: input.inputFingerprint, priorFailure: input.priorFailure });
        if (inputs.length === 1) return { kind: "failure", reason: "validation: focused check failed" };
        const obligation = input.contract.validation.obligations[0]!;
        return {
          kind: "success", candidateCommit: oid(input.node.id), outputDigest: `sha256:${input.node.id}`,
          changedFiles: input.contract.scope.allowedPaths, artifactManifests: manifestsFor(input),
          evidenceMatrix: { matrixId: `matrix-${input.node.id}`, candidateCommit: oid(input.node.id), validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision }, criteria: [{ criterionId: obligation.criterionId, obligationId: obligation.id, status: "satisfied", justification: "repaired", evidenceRefs: ["evidence:repair"] }], outcome: "verified", validationRecipeDigest: "sha256:repair", observations: [], evidenceBindings: [] },
          ...(input.node.id === compiled.graph.rootId ? { integrationManifestId: "integration-root", finalManifestId: "final-root", finalManifest: { commitSha: oid(input.node.id), treeSha: "c".repeat(40), graphRevision: input.graph.revision, artifactIds: Object.keys(compiled.contracts.artifacts), evidenceMatrixId: `matrix-${input.node.id}`, validationRecipeDigest: "sha256:repair", deliveryTarget: "main" } } : {})
        };
      }
    });
    const run = { runId: "run-stage6-canonical", graph: compiled.graph, contracts: compiled.contracts.taskBundles, repositoryContextDigest: fixture.repositoryView.digest, executorProfile: { id: "fake", revision: "1" }, effectiveConfig: { maxParallel: 1 }, availableExecutorNodeIds: Object.keys(compiled.graph.nodes), target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit } };
    const waiting = await driver.run(run);
    const decision = Object.values(waiting.decisions).find((item) => item.status === "pending");
    if (decision === undefined) throw new Error("Expected failed leaf decision.");
    await harness.coordinator.execute(run.runId, { type: "resolve_decision", decisionId: decision.id, optionId: "retry" });
    await driver.run(run);

    expect(inputs.slice(0, 2)).toEqual([
      expect.objectContaining({ attemptId: "run-stage6-canonical:attempt:unit:a:1", priorFailure: undefined }),
      expect.objectContaining({ attemptId: "run-stage6-canonical:attempt:unit:a:2", priorFailure: { attemptId: "run-stage6-canonical:attempt:unit:a:1", reason: "validation: focused check failed" } })
    ]);
    expect(inputs[0]!.inputFingerprint).not.toBe(inputs[1]!.inputFingerprint);
  });
});

function coordinator(graphId: string): { coordinator: RunCoordinator } {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-stage6-canonical", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Stage 6 fake run" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-stage6-canonical", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-stage6-canonical", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  return {
    coordinator: new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events = [...events, ...appended];
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    })
  };
}

function manifestsFor(input: {
  graph: { contractRefs: Array<{ id: string; revision: number; digest: string }> };
  node: { id: string };
  attemptId: string;
  inputFingerprint: string;
  contract: { artifacts: Array<{ id: string; revision: string; producerNodeId: string }> };
}) {
  return Object.fromEntries(input.contract.artifacts
    .filter((artifact) => artifact.producerNodeId === input.node.id)
    .map((artifact) => {
      const contract = input.graph.contractRefs.find((ref) =>
        ref.id === artifact.id && ref.revision === Number(artifact.revision)
      );
      if (contract === undefined) throw new Error(`Missing canonical ref for ${artifact.id}.`);
      const candidate = oid(input.node.id);
      const tree = oid(`${input.node.id}:tree`);
      return [artifact.id, {
        id: artifact.id,
        contract,
        producerNodeId: input.node.id,
        producerAttemptId: input.attemptId,
        inputFingerprint: input.inputFingerprint,
        repositoryObjectStoreId: "object-store:fake",
        objectFormat: "sha1" as const,
        sourceCandidate: { commitOid: candidate, treeOid: tree },
        retainedByRef: `refs/manyhands/test/${artifact.id}`,
        kind: "change_set" as const,
        baseTreeSha: oid("base"),
        resultTreeSha: tree,
        entries: [],
        manifestDigest: `sha256:${oid(`${artifact.id}:manifest`)}${oid(`${artifact.id}:manifest:tail`).slice(0, 24)}`
      }];
    }));
}

function oid(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
