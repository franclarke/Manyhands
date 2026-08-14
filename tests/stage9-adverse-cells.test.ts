import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compilePlan } from "@manyhands/decomposer";
import {
  IntegrationManifestExecutor,
  JsonIntegrationOperationJournal,
  createIntegrationRequestManifest
} from "@manyhands/execution-core";
import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";

import { FakeGitRunner } from "./helpers/fake-git-runner";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";
import {
  compileStage9Graph,
  stage9At,
  stage9Coordinator,
  stage9SuccessOutcome,
  type Stage9ExecuteInput
} from "./helpers/stage9-driver-harness.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage9-adverse-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Stage 9 required adverse cells", () => {
  it("R1: a composite's evidence names both children across a typed seam", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-r1";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    const integrationInputs: Array<{ nodeId: string; consumed: string[] }> = [];

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        if (input.node.kind !== "leaf") {
          integrationInputs.push({
            nodeId: input.node.id,
            consumed: input.consumedArtifacts.map((artifact) => artifact.contract.id).sort()
          });
        }
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    expect(integrationInputs).toEqual([{ nodeId: "unit:root", consumed: ["artifact:a", "artifact:b"] }]);
    // Both seams are typed and bound to the composite that consumes them.
    expect(compiled.graph.seamBindings.map((binding) => [binding.producerNodeId, binding.consumerNodeId]).sort())
      .toEqual([["unit:a", "unit:root"], ["unit:b", "unit:root"]]);
    expect(state.lifecycle).not.toBe("running");
  });

  it("R2: independent leaves run together without sharing a resource", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-r2";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    let inFlight = 0;
    let peak = 0;

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    expect(peak).toBe(2);
    const leafResources = compiled.graph.resourceClaims
      .filter((claim) => claim.nodeId === "unit:a" || claim.nodeId === "unit:b")
      .map((claim) => claim.resourceId);
    expect(new Set(leafResources).size).toBe(leafResources.length);
    // The root's own output travels as the final manifest, not as an adopted
    // artifact, so both leaf artifacts are what adoption should show here.
    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.contract.id).sort())
      .toEqual(["artifact:a", "artifact:b"]);
  });

  it("R3: a sequential rewrite carries an explicit artifact and version chain", async () => {
    // The Stage 5 fixture chains unit:b onto artifact:a, which is exactly the
    // ordering this cell is about.
    const fixture = stage5Fixture();
    const compiled = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    const runId = "run-stage9-r3";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    const fingerprints = new Map<string, string>();
    const consumedByNode = new Map<string, string[]>();

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        fingerprints.set(input.node.id, input.inputFingerprint);
        consumedByNode.set(input.node.id, input.consumedArtifacts.map((artifact) => artifact.contract.id).sort());
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 4 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    // The chain is explicit: b consumes a's artifact, so b's eligibility is
    // bound to a's exact output rather than to execution order.
    expect(consumedByNode.get("unit:b")).toEqual(["artifact:a"]);
    expect(consumedByNode.get("unit:a")).toEqual([]);
    expect(fingerprints.get("unit:a")).not.toBe(fingerprints.get("unit:b"));
    const requirement = compiled.graph.artifactRequirements
      .find((item) => item.consumerNodeId === "unit:b" && item.artifactContract.id === "artifact:a");
    expect(requirement?.artifactContract.revision).toBe(1);
  });

  it("R11: an integration defect is repaired at the lowest authority", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-r11";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        if (input.node.id === compiled.graph.rootId) {
          return { kind: "failure" as const, reason: "child_defect: artifact:b breaks seam:b-root." };
        }
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    const pending = Object.values(state.decisions).filter((decision) => decision.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.repairTargetNodeId).toBe("unit:b");
    // The composite attempt stays immutably failed; nothing rewrites it.
    const rootAttempts = Object.values(state.attempts).filter((attempt) => attempt.nodeId === compiled.graph.rootId);
    expect(rootAttempts).toHaveLength(1);
    expect(rootAttempts[0]!.status).toBe("failed");
    // The composite produced nothing, so no stale parent artifact survives.
    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.contract.id)).not.toContain("artifact:root");
  });

  it("R16: a crash during composite integration reconciles to one applied child", async () => {
    const directory = await temporaryDirectory();
    const journal = new JsonIntegrationOperationJournal(path.join(directory, "integration-operations"));
    const BASE = "b".repeat(40);
    const request = createIntegrationRequestManifest({
      runId: "run:stage9:r16",
      integrationAttemptId: "run:stage9:r16:attempt:parent:1",
      compositeNode: { id: "parent", graphRevision: 1 },
      base: { manifestId: "base", resultingCommit: BASE, inputFingerprint: `sha256:${"a".repeat(64)}` },
      availableArtifacts: [{
        schemaVersion: 1, artifactId: "a", runId: "run:stage9:r16", nodeId: "node-a", digest: "digest-a",
        producerAttemptId: "attempt-a", contract: { id: "contract-a", revision: "rev-1" },
        kind: "commit", location: "SHA_A", adoptedAt: "2026-08-14T00:00:00.000Z"
      }, {
        schemaVersion: 1, artifactId: "b", runId: "run:stage9:r16", nodeId: "node-b", digest: "digest-b",
        producerAttemptId: "attempt-b", contract: { id: "contract-b", revision: "rev-1" },
        kind: "commit", location: "SHA_B", adoptedAt: "2026-08-14T00:00:00.000Z"
      }] as never,
      requiredArtifactIds: ["a", "b"],
      seamRevisions: [{ id: "seam-1", revision: "rev-1" }],
      parentGoal: "Compose the feature",
      validationContract: { id: "validation-parent", revision: "rev-1" },
      outputArtifactContract: { id: "artifact-parent", revision: "rev-1" },
      createdAt: "2026-08-14T00:00:00.000Z"
    });

    const git = new FakeGitRunner({ heads: { "/wt": BASE } });
    let applied = 0;
    const deps = {
      git,
      // Commit replay is the historical path this durable-recovery cell covers.
      allowCommitTransport: true,
      validate: async () => ({ matrixId: "matrix-r16", outcome: "verified" as const }),
      digestCandidate: async () => "digest-parent"
    };
    const crashing = {
      ...deps,
      git: new Proxy(git, {
        get(target, property, receiver) {
          if (property === "cherryPick") {
            return async (params: { cwd: string; commitSha: string }) => {
              applied += 1;
              const outcome = await target.cherryPick(params);
              if (applied === 2) throw new Error("simulated crash during composite integration");
              return outcome;
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        }
      }) as typeof git
    };

    const operation = { journal, runId: "run:stage9:r16", operationId: "op-r16" };
    await expect(new IntegrationManifestExecutor(crashing).integrate({
      request, worktreePath: "/wt", integrationOperation: operation
    })).rejects.toThrow(/simulated crash/u);

    const appliedBeforeRecovery = applied;
    const recovered = await new IntegrationManifestExecutor(deps).integrate({
      request,
      worktreePath: "/wt",
      integrationOperation: { ...operation, allowTakeover: true }
    });

    // Exactly one integration outcome, and no child is applied a second time.
    // The crash landed after the second child's side effect but before it was
    // journaled, so reconciliation has to adopt that physical result rather
    // than replay it.
    expect(recovered.disposition).toBe("success");
    expect(applied).toBe(appliedBeforeRecovery);
    const persisted = recovered.childArtifacts.map((child) => child.artifactId).sort();
    expect(persisted).toEqual(["a", "b"]);
  });
});
