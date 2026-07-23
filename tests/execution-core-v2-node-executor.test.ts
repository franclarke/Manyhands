import { describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import {
  ExecutionConfigSchema,
  ExecutionBaseBuilder,
  ExactCandidateValidatorV2,
  FixedAgentExecutorFactory,
  ScopeChecker,
  V2NodeExecutor,
  WorktreeManager,
  type AgentExecutor,
  type ExecutorRunOutcome,
  type V2ExecutionEvidenceMatrix,
  type V2PhysicalNodeExecutionInput,
  type WorktreeReleaseOutcome
} from "@manyhands/execution-core";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const at = "2026-07-17T12:00:00.000Z";

describe("V2NodeExecutor", () => {
  it("executes a leaf directly from its V2 bundle and validates the exact orchestrator commit", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const commit = "2".repeat(40);
    const changedFile = contract.scope.allowedPaths[0]!;
    const git = new FakeGitRunner({
      commitSha: commit,
      diffCached: "diff",
      diffCachedNameOnly: [changedFile]
    });
    const agent = successfulAgent();
    const prompts: string[] = [];
    const validated: string[] = [];
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: {
        validate: async (input) => {
          validated.push(input.candidateCommit);
          return matrix(input.contract, input.candidateCommit);
        }
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async (_path, content) => { prompts.push(content); },
      now: () => at
    });

    const outcome = await executor.execute(request(compiled, node.id));

    expect(outcome).toMatchObject({ kind: "success", candidateCommit: commit, artifactLocation: commit });
    expect(validated).toEqual([commit]);
    expect(agent.calls).toHaveLength(1);
    expect(prompts[0]).toContain(contract.task.goal);
    expect(prompts[0]).toContain(contract.scope.allowedPaths[0]);
    expect(prompts[0]).toContain("Shared contracts with sibling work");
    expect(prompts[0]).toContain("Do not commit");
  });

  it("releases a pooled execution base with the successful candidate identity", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const commit = "4".repeat(40);
    const git = new FakeGitRunner({
      commitSha: commit,
      diffCached: "diff",
      diffCachedNameOnly: [contract.scope.allowedPaths[0]!]
    });
    const releases: WorktreeReleaseOutcome[] = [];
    const baseBuilder = new ExecutionBaseBuilder({
      git,
      workspaceProvider: {
        acquire: async (params) => ({
          worktree: {
            ...params,
            path: "C:/repo/booking/.manyhands/pool/slot-000",
            branch: "pool/slot-000",
            status: "active",
            createdAt: at
          },
          release: async (outcome = { kind: "discard" }) => {
            releases.push(outcome);
          }
        })
      },
      now: () => at
    });
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      baseBuilder,
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(successfulAgent()),
      validator: {
        validate: async (input) => matrix(input.contract, input.candidateCommit)
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const outcome = await executor.execute(request(compiled, node.id));

    expect(outcome).toMatchObject({ kind: "success", candidateCommit: commit });
    expect(releases).toEqual([{
      kind: "candidate",
      runId: "run-v2-physical",
      attemptId: "run-v2-physical:attempt:node-api:1",
      candidateCommit: commit
    }]);
  });

  it("does not report success when a pooled candidate cannot be anchored", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const commit = "5".repeat(40);
    const git = new FakeGitRunner({
      commitSha: commit,
      diffCached: "diff",
      diffCachedNameOnly: [contract.scope.allowedPaths[0]!]
    });
    const baseBuilder = new ExecutionBaseBuilder({
      git,
      workspaceProvider: {
        acquire: async (params) => ({
          worktree: {
            ...params,
            path: "C:/repo/booking/.manyhands/pool/slot-000",
            branch: "pool/slot-000",
            status: "active",
            createdAt: at
          },
          release: async () => {
            throw new Error("candidate anchor failed");
          }
        })
      },
      now: () => at
    });
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      baseBuilder,
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(successfulAgent()),
      validator: {
        validate: async (input) => matrix(input.contract, input.candidateCommit)
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const outcome = await executor.execute(request(compiled, node.id));

    expect(outcome).toEqual({
      kind: "failure",
      reason: "candidate anchor failed"
    });
  });

  it("repairs one failed code candidate in the same worktree and revalidates the repaired commit", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const firstCommit = "2".repeat(40);
    const repairedCommit = "3".repeat(40);
    const git = new FakeGitRunner({
      commitShas: [firstCommit, repairedCommit],
      diffCached: "diff",
      diffCachedNameOnly: [contract.scope.allowedPaths[0]!]
    });
    const agent = successfulAgent();
    const prompts: string[] = [];
    const validated: string[] = [];
    const prepared: string[] = [];
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: {
        validate: async (input) => {
          validated.push(input.candidateCommit);
          const evidence = matrix(input.contract, input.candidateCommit);
          return input.candidateCommit === firstCommit
            ? {
                ...evidence,
                outcome: "failed" as const,
                criteria: evidence.criteria.map((criterion) => ({
                  ...criterion,
                  status: "failed" as const,
                  justification: "The API response violates the declared seam."
                }))
              }
            : evidence;
        }
      },
      finalCandidate: {
        prepare: async (input) => {
          prepared.push(input.candidateCommit);
          return { manifestId: "manifest-repaired-root" };
        }
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async (_path, content) => { prompts.push(content); },
      now: () => at
    });

    const input = request(compiled, node.id);
    input.graph = { ...input.graph, rootId: node.id };
    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({
      kind: "success",
      candidateCommit: repairedCommit,
      evidenceMatrix: { outcome: "verified" },
      repairObservations: [{ pass: 1 }],
      finalManifestId: "manifest-repaired-root"
    });
    expect(validated).toEqual([firstCommit, repairedCommit]);
    expect(agent.calls).toHaveLength(2);
    expect(prepared).toEqual([repairedCommit]);
    expect(prompts[1]).toContain("The API response violates the declared seam.");
    expect(git.calls.filter((call) => call.op === "commit")).toHaveLength(2);
  });

  it("integrates adopted child artifacts bottom-up and prepares only a verified root candidate", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const root = compiled.graph.nodes[compiled.graph.rootId]!;
    const integrated = ["6".repeat(40), "7".repeat(40), "8".repeat(40)];
    const git = new FakeGitRunner({
      cherryPickResultShas: integrated,
      diffRangeNameOnly: ["src/domain/booking.ts", "src/api/bookings.ts", "src/ui/BookingForm.tsx"]
    });
    const prepared: string[] = [];
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(successfulAgent()),
      validator: { validate: async (input) => matrix(input.contract, input.candidateCommit) },
      finalCandidate: {
        prepare: async (input) => {
          expect(input.evidenceMatrix.outcome).toBe("verified");
          prepared.push(input.candidateCommit);
          return { manifestId: "final-manifest" };
        }
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });
    const input = request(compiled, root.id);
    input.consumedArtifacts = compiled.graph.artifactRequirements
      .filter((requirement) => requirement.consumerNodeId === root.id)
      .map((requirement, index) => ({
        artifactId: `adopted-${index}`,
        runId: input.runId,
        nodeId: requirement.producerNodeId,
        digest: `sha256:child-${index}`,
        producerAttemptId: `attempt-child-${index}`,
        contract: { ...requirement.artifactContract },
        kind: "commit" as const,
        location: `${index + 3}`.repeat(40),
        adoptedAt: at
      }));

    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({
      kind: "success",
      candidateCommit: integrated.at(-1),
      integrationManifestId: expect.stringMatching(/^integration-result-/u),
      finalManifestId: "final-manifest"
    });
    expect(prepared).toEqual([integrated.at(-1)]);
    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(
      input.consumedArtifacts.map((artifact) => artifact.location)
    );
  });
});

describe("ScopeChecker V2", () => {
  it("uses the canonical allowed and forbidden paths without a legacy ExecutionScope", () => {
    const checked = new ScopeChecker().check({
      changedFiles: ["src/feature.ts", "docs/readme.md", "secrets/key.txt"],
      scopeContract: { allowedPaths: ["src/**"], forbiddenPaths: ["secrets/**"] }
    });
    expect(checked).toEqual({
      passed: false,
      violations: ["secrets/key.txt"],
      outOfScope: ["docs/readme.md"]
    });
  });
});

describe("ExactCandidateValidatorV2", () => {
  it("links baseline and candidate observations to the V2 validation obligations", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const candidate = "9".repeat(40);
    const git = new FakeGitRunner();
    const worktrees = new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at });
    const validator = new ExactCandidateValidatorV2({
      git,
      worktrees,
      repoRoot: "C:/repo/booking",
      repositorySnapshot: bookingSnapshot(),
      runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) }
    });

    const evidence = await validator.validate({
      runId: "run-v2-validation",
      attemptId: "attempt-api-1",
      contract,
      candidateCommit: candidate,
      baselineCommit: compiled.graph.baseCommit
    });

    expect(evidence).toMatchObject({ candidateCommit: candidate, outcome: "verified" });
    expect(evidence.criteria.every((criterion) => criterion.status === "satisfied")).toBe(true);
    expect(git.opsInvoked().filter((operation) => operation === "worktreeAdd")).toHaveLength(2);
    expect(git.opsInvoked().filter((operation) => operation === "worktreeRemove")).toHaveLength(2);
  });
});

function request(
  compiled: ReturnType<typeof compileGraphRevision>,
  nodeId: string
): V2PhysicalNodeExecutionInput {
  const node = compiled.graph.nodes[nodeId]!;
  const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === nodeId)!;
  const outputArtifactContract = contract.artifacts.find((artifact) =>
    artifact.producerNodeId === nodeId && ["node-result", "final-candidate"].includes(artifact.artifactType)
  )!;
  return {
    runId: "run-v2-physical",
    attemptId: `run-v2-physical:attempt:${nodeId}:1`,
    inputFingerprint: `sha256:${"f".repeat(64)}`,
    graph: compiled.graph,
    node,
    contract,
    consumedArtifacts: [],
    outputArtifactContract,
    selection: { executorId: "claude-code-cli", model: "claude-sonnet-4-5" },
    repairSelection: { executorId: "claude-code-cli", model: "claude-sonnet-4-5" },
    config: ExecutionConfigSchema.parse({ maxParallel: 3 }),
    target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: compiled.graph.baseCommit }
  };
}

function matrix(contract: V2PhysicalNodeExecutionInput["contract"], candidateCommit: string): V2ExecutionEvidenceMatrix {
  return {
    matrixId: `matrix-${contract.task.nodeId}`,
    candidateCommit,
    validationContract: { ...contract.task.validation },
    criteria: contract.validation.obligations.map((obligation) => ({
      criterionId: obligation.criterionId,
      obligationId: obligation.id,
      status: "satisfied" as const,
      justification: "Exact candidate evidence passed.",
      evidenceRefs: [`evidence-${obligation.id}`]
    })),
    outcome: "verified"
  };
}

function successfulAgent(): AgentExecutor & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    execute: async (options): Promise<ExecutorRunOutcome> => {
      calls.push(options);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
    }
  };
}
