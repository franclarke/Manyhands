import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import {
  detectRequiredPublicSurfaceFindings,
  ExecutionConfigSchema,
  ExecutionBaseBuilder,
  ExactCandidateValidatorV2,
  FixedAgentExecutorFactory,
  ScopeChecker,
  V2NodeExecutor,
  buildV2CodeRepairInstructions,
  buildV2NodeInstructions,
  WorktreeManager,
  type AgentExecutor,
  type ExecutorRunOutcome,
  type V2ExecutionEvidenceMatrix,
  type V2PhysicalNodeExecutionInput,
  type WorktreeReleaseOutcome
} from "@manyhands/execution-core";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { FakeGitRunner, fakeWorkspaceProvider } from "./helpers/fake-git-runner";

const at = "2026-07-17T12:00:00.000Z";

describe("V2NodeExecutor", () => {
  it("accepts a named observable state operation with a backorder suffix", () => {
    const findings = detectRequiredPublicSurfaceFindings({
      goal: "Expose backorder state through the public API.",
      acceptanceCriteria: [],
      allowedPaths: ["src/api/warehouse-api.mjs"],
      changedFiles: ["src/api/warehouse-api.mjs"],
      candidatePublicSourceContents: {
        "src/api/warehouse-api.mjs": "export function createWarehouseApi() { return { backorderOrders() { return []; } }; }"
      }
    });

    expect(findings).toEqual([]);
  });

  it("includes integrity findings in code-repair instructions", () => {
    const instructions = buildV2CodeRepairInstructions(
      { node: { title: "API backorder exposure" }, contract: { task: { goal: "Expose backorders through the public API." } } } as never,
      { criteria: [], integrityFindings: [{ findingId: "finding-api", code: "required_public_surface_unrepresented", path: "src/api/orders.ts", message: "No named public operation." }] } as never
    );

    expect(instructions).toContain("No named public operation.");
    expect(instructions).toContain("identifier contains that state term");
    expect(instructions).toContain('identifier contains "backorders"');
    expect(instructions).toContain("currentBackorders");
    expect(instructions).toContain("Do not resolve this by adding only a test");
  });

  it("includes the exact inherited source contract in leaf instructions", () => {
    const sourceContract = {
      goal: 'OrderPriority = "standard" | "express"; Backorder has orderId, skuId and missing; listBackorders(state) returns every recorded Backorder.',
      acceptanceCriteria: ["The exact source contract reaches every executable leaf."],
      constraints: ["Do not rename the quoted literals or fields."]
    };
    const compiled = compileGraphRevision({
      breakdown: bookingBreakdown(),
      repositorySnapshot: bookingSnapshot(),
      sourceContract
    }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;

    const instructions = buildV2NodeInstructions({ node, contract, consumedArtifacts: [] });

    expect(instructions).toContain(sourceContract.goal);
    expect(instructions).toContain('Inherited source contract (exact; do not paraphrase):');
    expect(instructions).toContain('OrderPriority = "standard" | "express"');
    expect(instructions).toContain("orderId, skuId and missing");
    expect(instructions).toContain("listBackorders(state)");
  });

  it("turns a retried attempt's recorded failure into explicit repair context", () => {
    const instructions = buildV2NodeInstructions({
      node: { id: "node-server", title: "Recipe HTTP server" },
      contract: {
        task: { goal: "Implement a recipe HTTP server.", acceptanceCriteria: [], constraints: [] },
        scope: { allowedPaths: ["src/index.js"], outputRoots: [], forbiddenPaths: [] },
        seams: []
      },
      consumedArtifacts: [],
      priorFailure: {
        attemptId: "run-1:attempt:node-server:1",
        reason: "npm test failed: expected HTTP 200"
      }
    } as never);

    expect(instructions).toContain("Previous attempt failed; repair that observed failure before finishing:");
    expect(instructions).toContain("npm test failed: expected HTTP 200");
    expect(instructions).toContain("Do not repeat the same implementation without addressing it.");
  });

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
    expect(prompts[0]).toContain("Do not redefine shared domain types");
    expect(prompts[0]).toContain("Treat every named interface or type schema in the objective as exact");
    expect(prompts[0]).toContain("Update every existing constructor, fixture, probe, and snapshot");
    expect(prompts[0]).toContain("Import canonical symbols across layers instead of declaring a second local shape");
    expect(prompts[0]).toContain("Before implementing a consumer leaf, inspect the current canonical producer implementation and its tests");
    expect(prompts[0]).toContain("Use the canonical producer's returned state and exported operations as the only source for shared state");
    expect(prompts[0]).toContain("Literal-contract audit");
    expect(prompts[0]).toContain("do not invent a semantically similar name");
    expect(prompts[0]).not.toContain("pnpm build");
    expect(prompts[0]).toContain("Do not commit");
  });

  it("fails closed when a leaf candidate omits an explicitly declared artifact path", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const input = request(compiled, node.id);
    input.contract = { ...input.contract, scope: { ...input.contract.scope, allowedPaths: ["src/api/**"] } };
    input.outputArtifactContract = { ...input.outputArtifactContract, expectedPaths: ["src/api/required.ts"] };
    const git = new FakeGitRunner({
      commitSha: "b".repeat(40),
      diffCached: "diff",
      diffCachedNameOnly: ["src/api/other.ts"]
    });
    const agent = successfulAgent();
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: { validate: async (validationInput) => matrix(validationInput.contract, validationInput.candidateCommit) },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({ kind: "failure", reason: expect.stringContaining("src/api/required.ts") });
    expect(agent.calls).toHaveLength(1);
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

  it("preserves a verified candidate when pooled worktree cleanup fails", async () => {
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
    const traceStore = new InMemoryTraceStore();
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      baseBuilder,
      traceStore,
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
    expect(traceStore.findByType("worktree_clean_failed")).toHaveLength(1);
  });

  it("publishes a repaired leaf as one cumulative handoff from its physical base", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const firstCommit = "2".repeat(40);
    const repairedCommit = "3".repeat(40);
    const handoffCommit = "4".repeat(40);
    const git = new FakeGitRunner({
      commitShas: [firstCommit, repairedCommit],
      diffCached: "diff",
      diffCachedNameOnly: [contract.scope.allowedPaths[0]!],
      diffRangeNameOnly: contract.scope.allowedPaths,
      integrationHandoffSha: handoffCommit
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
          return {
            manifestId: "manifest-repaired-root",
            finalManifest: {
              commitSha: input.candidateCommit,
              treeSha: "tree-repaired",
              graphRevision: input.graphRevision,
              artifactIds: [...input.artifactIds],
              evidenceMatrixId: input.evidenceMatrix.matrixId,
              validationRecipeDigest: input.validationRecipeDigest,
              deliveryTarget: input.targetBranch
            }
          };
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
      candidateCommit: handoffCommit,
      artifactLocation: handoffCommit,
      artifactCherryPickMainline: 1,
      changedFiles: contract.scope.allowedPaths,
      evidenceMatrix: { outcome: "verified" },
      repairObservations: [{ pass: 1 }],
      finalManifestId: "manifest-repaired-root"
    });
    expect(validated).toEqual([firstCommit, handoffCommit]);
    expect(agent.calls).toHaveLength(2);
    expect(prepared).toEqual([handoffCommit]);
    expect(prompts[1]).toContain("The API response violates the declared seam.");
    expect(git.calls.filter((call) => call.op === "commit")).toHaveLength(2);
    expect(git.calls.filter((call) => call.op === "createIntegrationHandoff")).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          baseCommit: input.graph.baseCommit,
          appliedCommitShas: [firstCommit, repairedCommit]
        })
      })
    ]);
  });

  it("defers a failed exact validation to the canonical retry attempt when configured", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const candidate = "7".repeat(40);
    const git = new FakeGitRunner({
      commitSha: candidate,
      diffCached: "diff",
      diffCachedNameOnly: [contract.scope.allowedPaths[0]!]
    });
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(successfulAgent()),
      validator: {
        validate: async (input) => ({
          ...matrix(input.contract, input.candidateCommit),
          outcome: "failed" as const,
          criteria: matrix(input.contract, input.candidateCommit).criteria.map((criterion) => ({
            ...criterion,
            status: "failed" as const,
            justification: "Focused oracle failed."
          }))
        })
      },
      deferValidationRepair: true,
      writeInstructions: async () => undefined,
      now: () => at
    });

    await expect(executor.execute(request(compiled, node.id))).resolves.toMatchObject({
      kind: "failure",
      reason: expect.stringContaining(`validation_failed: exact candidate ${candidate}`)
    });
    expect(git.opsInvoked()).not.toContain("createIntegrationHandoff");
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
          return {
            manifestId: "final-manifest",
            finalManifest: {
              commitSha: input.candidateCommit,
              treeSha: "tree-final",
              graphRevision: input.graphRevision,
              artifactIds: [...input.artifactIds],
              evidenceMatrixId: input.evidenceMatrix.matrixId,
              validationRecipeDigest: input.validationRecipeDigest,
              deliveryTarget: input.targetBranch
            }
          };
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

  it("aborts an active cherry-pick before launching semantic integration repair", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const root = compiled.graph.nodes[compiled.graph.rootId]!;
    const repairCommit = "a".repeat(40);
    const git = new FakeGitRunner({
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/domain/booking.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/domain/booking.ts"],
      diffCached: "resolved diff",
      commitSha: repairCommit
    });
    const prompts: string[] = [];
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(successfulAgent()),
      validator: { validate: async (input) => matrix(input.contract, input.candidateCommit) },
      finalCandidate: {
        prepare: async (input) => ({
          manifestId: "final-repair-manifest",
          finalManifest: {
            commitSha: input.candidateCommit,
            treeSha: "tree-repaired",
            graphRevision: input.graphRevision,
            artifactIds: [...input.artifactIds],
            evidenceMatrixId: input.evidenceMatrix.matrixId,
            validationRecipeDigest: input.validationRecipeDigest,
            deliveryTarget: input.targetBranch
          }
        })
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async (_path, content) => { prompts.push(content); },
      now: () => at
    });

    const input = request(compiled, root.id);
    input.consumedArtifacts = [{
      artifactId: "adopted-child",
      runId: input.runId,
      nodeId: "node-api",
      digest: "sha256:child",
      producerAttemptId: "attempt-child",
      contract: { id: "contract-child", revision: "r1" },
      kind: "commit",
      location: "b".repeat(40),
      adoptedAt: at
    }];

    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({ kind: "success", candidateCommit: repairCommit });
    expect(prompts[0]).toContain("Apply the incoming commit");
    expect(prompts[0]).toContain("The only accepted repair is a non-empty working-tree diff");
    expect(prompts[0]).toContain("Do not report the conflict resolved from the final summary alone");
    expect(prompts[0]).toContain("Treat the already-integrated canonical producer behavior as authoritative");
    expect(prompts[0]).toContain("Do not add an exception-based fallback or duplicate state");
    expect(prompts[0]).toContain("Child commits are transport");
    expect(prompts[0]).not.toContain("Physical child patches");
    expect(prompts[0]).not.toContain("Preserve every child addition verbatim");
    expect(prompts[0]).toContain("existing unrelated state");
    expect(prompts[0]).toContain("Do not create or modify AGENTS.md");
    const abortIndex = git.calls.findIndex((call) => call.op === "cherryPickAbort");
    const repairStageIndex = git.calls.findIndex((call) => call.op === "addAllExcluding");
    expect(abortIndex).toBeGreaterThanOrEqual(0);
    expect(abortIndex).toBeLessThan(repairStageIndex);
  });

  it("performs one bounded semantic integration repair", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const root = compiled.graph.nodes[compiled.graph.rootId]!;
    const firstRepairCommit = "a".repeat(40);
    const secondRepairCommit = "c".repeat(40);
    const incomingCommit = "b".repeat(40);
    const git = new RepairIntentGit({
      incomingCommit,
      firstRepairCommit,
      secondRepairCommit,
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/domain/booking.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/domain/booking.ts"]
    });
    const prompts: string[] = [];
    const agent = successfulAgent();
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: { validate: async (input) => matrix(input.contract, input.candidateCommit) },
      finalCandidate: {
        prepare: async (input) => ({
          manifestId: "final-repair-intent",
          finalManifest: {
            commitSha: input.candidateCommit,
            treeSha: "tree-repair-intent",
            graphRevision: input.graphRevision,
            artifactIds: [...input.artifactIds],
            evidenceMatrixId: input.evidenceMatrix.matrixId,
            validationRecipeDigest: input.validationRecipeDigest,
            deliveryTarget: input.targetBranch
          }
        })
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async (_path, content) => { prompts.push(content); },
      now: () => at
    });

    const input = request(compiled, root.id);
    input.consumedArtifacts = [{
      artifactId: "adopted-child",
      runId: input.runId,
      nodeId: "node-api",
      digest: "sha256:child",
      producerAttemptId: "attempt-child",
      contract: { id: "contract-child", revision: "r1" },
      kind: "commit",
      location: incomingCommit,
      adoptedAt: at
    }];

    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({ kind: "success", candidateCommit: firstRepairCommit });
    expect(agent.calls).toHaveLength(1);
    expect(prompts).toHaveLength(1);
    expect(git.opsInvoked().filter((operation) => operation === "restoreManagedWorktree")).toHaveLength(0);
  });

  it("fails closed when a consumed child patch cannot be materialized", async () => {
    const incomingCommit = "b".repeat(40);
    const git = new FakeGitRunner({
      missingRefs: [`${incomingCommit}^1`],
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/domain/booking.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/domain/booking.ts"]
    });
    const agent = successfulAgent();
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: { validate: async (input) => matrix(input.contract, input.candidateCommit) },
      finalCandidate: {
        prepare: async (input) => ({
          manifestId: "final-deletion-audit",
          finalManifest: {
            commitSha: input.candidateCommit,
            treeSha: "tree-deletion-audit",
            graphRevision: input.graphRevision,
            artifactIds: [...input.artifactIds],
            evidenceMatrixId: input.evidenceMatrix.matrixId,
            validationRecipeDigest: input.validationRecipeDigest,
            deliveryTarget: input.targetBranch
          }
        })
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const root = compiled.graph.nodes[compiled.graph.rootId]!;
    const input = request(compiled, root.id);
    input.consumedArtifacts = [{
      artifactId: "adopted-child",
      runId: input.runId,
      nodeId: "node-api",
      digest: "sha256:child",
      producerAttemptId: "attempt-child",
      contract: { id: "contract-child", revision: "r1" },
      kind: "commit",
      location: incomingCommit,
      adoptedAt: at
    }];

    const outcome = await executor.execute(input);

    expect(outcome.kind).toBe("failure");
    expect(agent.calls).toHaveLength(0);
  });

  it("does not gate repair on literal retention of an intermediate deletion", async () => {
    const incomingCommit = "b".repeat(40);
    const firstRepairCommit = "a".repeat(40);
    const secondRepairCommit = "c".repeat(40);
    const git = new RepairIntentGit({
      incomingCommit,
      firstRepairCommit,
      secondRepairCommit,
      dropDeletion: true,
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/domain/booking.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/domain/booking.ts"]
    });
    const agent = successfulAgent();
    const executor = new V2NodeExecutor({
      git,
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: { validate: async (input) => matrix(input.contract, input.candidateCommit) },
      finalCandidate: {
        prepare: async (input) => ({
          manifestId: "final-deletion-audit",
          finalManifest: {
            commitSha: input.candidateCommit,
            treeSha: "tree-deletion-audit",
            graphRevision: input.graphRevision,
            artifactIds: [...input.artifactIds],
            evidenceMatrixId: input.evidenceMatrix.matrixId,
            validationRecipeDigest: input.validationRecipeDigest,
            deliveryTarget: input.targetBranch
          }
        })
      },
      worktrees: new WorktreeManager({ git, repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const root = compiled.graph.nodes[compiled.graph.rootId]!;
    const input = request(compiled, root.id);
    input.consumedArtifacts = [{
      artifactId: "adopted-child",
      runId: input.runId,
      nodeId: "node-api",
      digest: "sha256:child",
      producerAttemptId: "attempt-child",
      contract: { id: "contract-child", revision: "r1" },
      kind: "commit",
      location: incomingCommit,
      adoptedAt: at
    }];

    const outcome = await executor.execute(input);

    expect(outcome).toMatchObject({ kind: "success", candidateCommit: firstRepairCommit });
    expect(agent.calls).toHaveLength(1);
  });
});

class RepairIntentGit extends FakeGitRunner {
  private stagedDiffReads = 0;

  constructor(private readonly intent: {
    incomingCommit: string;
    firstRepairCommit: string;
    secondRepairCommit: string;
    dropDeletion?: boolean;
  } & ConstructorParameters<typeof FakeGitRunner>[0]) {
    super({ ...intent, commitShas: [intent.firstRepairCommit, intent.secondRepairCommit] });
  }

  override async diffRange(params: Parameters<FakeGitRunner["diffRange"]>[0]): ReturnType<FakeGitRunner["diffRange"]> {
    if (params.to === this.intent.incomingCommit) {
      return "diff --git a/src/domain/booking.ts b/src/domain/booking.ts\n+export const required = true;" +
        (this.intent.dropDeletion === true ? "\n-export const legacy = true;" : "");
    }
    if (params.to === this.intent.firstRepairCommit) return "diff --git a/src/domain/booking.ts b/src/domain/booking.ts\n+export const unrelated = true;";
    if (params.to === this.intent.secondRepairCommit) {
      return "diff --git a/src/domain/booking.ts b/src/domain/booking.ts\n+export const required = true;" +
        (this.intent.dropDeletion === true ? "" : "\n-export const legacy = true;");
    }
    return super.diffRange(params);
  }

  override async diffCached(cwd: string): ReturnType<FakeGitRunner["diffCached"]> {
    this.stagedDiffReads += 1;
    return this.stagedDiffReads === 1
      ? "diff --git a/src/domain/booking.ts b/src/domain/booking.ts\n+export const unrelated = true;"
      : "diff --git a/src/domain/booking.ts b/src/domain/booking.ts\n+export const required = true;";
  }
}

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
  it("materializes npm test for a bootstrap target that declares its planned test path", () => {
    const compiledContract = {
      task: { goal: "Bootstrap a Node project.", acceptanceCriteria: [], validation: { id: "validation-bootstrap", revision: "r1" } },
      validation: {
        id: "validation-bootstrap",
        revision: "r1",
        nodeId: "node-bootstrap",
        obligations: [{
          id: "obligation-bootstrap",
          criterionId: "criterion-bootstrap",
          layer: "leaf",
          severity: "required",
          acceptableEvidence: ["test_result"],
          baselinePolicy: "required",
          negativeControl: "not_required",
          flakyPolicy: "forbid",
          evidence: { kind: "focused_command", selectors: ["test/basic.test.mjs"], references: ["test/basic.test.mjs"] }
        }]
      },
      scope: { allowedPaths: ["package.json", "src/index.mjs", "test/basic.test.mjs"] }
    } as never;
    const snapshot = {
      ...bookingSnapshot(),
      capabilities: { scripts: {}, baselineCommands: [], languages: [], stack: [] }
    };
    const validator = new ExactCandidateValidatorV2({
      git: new FakeGitRunner(),
      workspaces: fakeWorkspaceProvider(new FakeGitRunner()),
      repoRoot: "C:/repo/bootstrap",
      repositorySnapshot: snapshot,
      bootstrapValidation: true
    });

    const prepared = validator.prepare({ contract: compiledContract });

    expect(prepared.unmaterializedObligationIds).toEqual([]);
    expect(prepared.steps[0]?.command).toMatchObject({ command: "npm", args: ["test", "test/basic.test.mjs"] });
  });

  it("does not treat the first test script as weakened baseline coverage", async () => {
    const compiledContract = {
      task: { goal: "Bootstrap a Node project.", acceptanceCriteria: [], validation: { id: "validation-bootstrap", revision: "r1" } },
      validation: {
        id: "validation-bootstrap",
        revision: "r1",
        nodeId: "node-bootstrap",
        obligations: [{
          id: "obligation-bootstrap",
          criterionId: "criterion-bootstrap",
          layer: "leaf",
          severity: "required",
          acceptableEvidence: ["test_result"],
          baselinePolicy: "required",
          negativeControl: "not_required",
          flakyPolicy: "forbid",
          evidence: { kind: "focused_command", selectors: ["test/basic.test.mjs"], references: ["test/basic.test.mjs"] }
        }]
      },
      scope: { allowedPaths: ["package.json", "src/index.mjs", "test/basic.test.mjs"] }
    } as never;
    const baselineCommit = "b".repeat(40);
    const candidateCommit = "c".repeat(40);
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["package.json", "src/index.mjs", "test/basic.test.mjs"],
      showFileByRef: {
        [candidateCommit]: {
          "package.json": JSON.stringify({ name: "node-esm-root", type: "module", scripts: { test: "node --test test/*.test.mjs" } }),
          "src/index.mjs": "export const ready = true;",
          "test/basic.test.mjs": "import test from 'node:test'; test('ready', () => {});"
        }
      }
    });
    const snapshot = {
      ...bookingSnapshot(),
      capabilities: { scripts: {}, baselineCommands: [], languages: [], stack: [] }
    };
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/bootstrap",
      repositorySnapshot: snapshot,
      bootstrapValidation: true,
      runner: { run: async () => ({ passed: true, output: "green", exitCode: 0 }) }
    });

    const evidence = await validator.validate({
      runId: "run-bootstrap-integrity",
      attemptId: "attempt-bootstrap-integrity",
      contract: compiledContract,
      candidateCommit,
      baselineCommit
    });

    expect(evidence.outcome).toBe("verified");
    expect(evidence.integrityFindings).toEqual([]);
  });

  it("links baseline and candidate observations to the V2 validation obligations", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const candidate = "9".repeat(40);
    const git = new FakeGitRunner();
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
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

  it("rejects a prepared recipe whose contract identity no longer matches the candidate contract", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const candidate = "a".repeat(40);
    const git = new FakeGitRunner();
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/booking",
      repositorySnapshot: bookingSnapshot(),
      runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) }
    });
    const prepared = validator.prepare({ contract });
    const forged = { ...prepared, validationContract: { ...prepared.validationContract, revision: "forged-revision" } };

    await expect(validator.validate({
      runId: "run-v2-validation",
      attemptId: "attempt-api-forged",
      contract,
      prepared: forged,
      candidateCommit: candidate,
      baselineCommit: compiled.graph.baseCommit
    })).rejects.toThrow(/prepared validation recipe.*contract/i);
  });

  it("derives needs_input before agent creation when a required obligation is unmaterialized", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const node = compiled.graph.nodes["node-api"]!;
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === node.id)!;
    const agent = successfulAgent();
    const executor = new V2NodeExecutor({
      git: new FakeGitRunner(),
      repoRoot: "C:/repo/booking",
      traceStore: new InMemoryTraceStore(),
      executorFactory: new FixedAgentExecutorFactory(agent),
      validator: {
        prepare: () => ({
          schemaVersion: 1,
          templateId: "template-unmaterialized",
          programId: "template-unmaterialized",
          validationContract: { ...contract.task.validation },
          repositorySnapshotId: "snapshot-booking",
          steps: [],
          unmaterializedObligationIds: [contract.validation.obligations[0]!.id]
        }),
        validate: async (input) => matrix(input.contract, input.candidateCommit)
      },
      worktrees: new WorktreeManager({ git: new FakeGitRunner(), repoRoot: "C:/repo/booking", now: () => at }),
      writeInstructions: async () => undefined,
      now: () => at
    });

    const outcome = await executor.execute(request(compiled, node.id));

    expect(outcome).toMatchObject({
      kind: "needs_input",
      reason: expect.stringContaining("cannot be materialized"),
      unmaterializedObligationIds: [contract.validation.obligations[0]!.id]
    });
    expect(agent.calls).toHaveLength(0);
  });

  it("rejects a test-only candidate when the task promises a new observable API surface", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = {
      ...original,
      task: {
        ...original.task,
        goal: "Expose the recorded backorders through the public API.",
        acceptanceCriteria: original.task.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          description: "Callers can observe recorded backorders through the API."
        }))
      },
      validation: {
        ...original.validation,
        obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const }))
      }
    };
    const candidate = "9".repeat(40);
    const git = new FakeGitRunner({ diffRangeNameOnly: ["tests/api-observability.test.ts"] });
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/booking",
      repositorySnapshot: snapshot,
      runner: { run: async () => ({ passed: true, output: "green test", exitCode: 0 }) }
    });

    const evidence = await validator.validate({
      runId: "run-public-surface",
      attemptId: "attempt-public-surface",
      contract,
      candidateCommit: candidate,
      baselineCommit: compiled.graph.baseCommit
    });

    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({
      code: "required_public_surface_unchanged",
      path: "src/api/bookings.ts"
    }));
  });

  it("rejects an API edit that still omits the named observable backorder state", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = {
      ...original,
      task: {
        ...original.task,
        goal: "Expose recorded backorders through the public API.",
        acceptanceCriteria: original.task.acceptanceCriteria.map((criterion) => ({ ...criterion, description: "The API exposes recorded backorders." }))
      },
      validation: { ...original.validation, obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const })) }
    };
    const candidate = "8".repeat(40);
    const baseline = compiled.graph.baseCommit;
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["src/api/bookings.ts"],
      showFileByRef: { [candidate]: { "src/api/bookings.ts": "export function currentOrders() { return []; }" } }
    });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "green", exitCode: 0 }) } });

    const evidence = await validator.validate({ runId: "run-public-state", attemptId: "attempt-public-state", contract, candidateCommit: candidate, baselineCommit: baseline });

    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({
      code: "required_public_surface_unrepresented",
      path: "src/api/bookings.ts",
      message: expect.stringContaining('identifier contains "backorders"')
    }));
  });

  it("rejects a backorder response field when the API exposes no named backorder read operation", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = {
      ...original,
      task: {
        ...original.task,
        goal: "Expose recorded backorders through the public API.",
        acceptanceCriteria: original.task.acceptanceCriteria.map((criterion) => ({ ...criterion, description: "The API exposes recorded backorders." }))
      },
      validation: { ...original.validation, obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const })) }
    };
    const candidate = "7".repeat(40);
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["src/api/bookings.ts"],
      showFileByRef: { [candidate]: { "src/api/bookings.ts": "export function placeOrder() { return { backorders: [] }; }" } }
    });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "green", exitCode: 0 }) } });

    const evidence = await validator.validate({ runId: "run-public-operation", attemptId: "attempt-public-operation", contract, candidateCommit: candidate, baselineCommit: compiled.graph.baseCommit });

    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({ code: "required_public_surface_unrepresented", path: "src/api/bookings.ts" }));
  });

  it.each([
    ["deleted test", null, "test_removed"],
    ["skipped test", 'it.skip("works", () => { expect(run()).toBe(true); });', "test_skipped"],
    ["focused test", 'it.only("works", () => { expect(run()).toBe(true); });', "test_only"],
    ["removed assertion", 'it("works", () => { run(); });', "assertion_removed"]
  ] as const)("rejects a green candidate with a %s", async (_label, candidateTest, expectedCode) => {
    const snapshot = bookingSnapshot();
    snapshot.index!.files.push({
      path: "tests/api.test.ts",
      kind: "test",
      contentHash: "b".repeat(64),
      exportedSymbols: [],
      importedSymbols: [],
      declaredSymbols: []
    });
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = {
      ...original,
      validation: {
        ...original.validation,
        obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const }))
      }
    };
    const candidate = "9".repeat(40);
    const baseline = compiled.graph.baseCommit;
    const baselineTest = 'it("works", () => { expect(run()).toBe(true); });';
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["tests/api.test.ts"],
      showFileByRef: {
        [baseline]: { "tests/api.test.ts": baselineTest },
        [candidate]: candidateTest === null ? {} : { "tests/api.test.ts": candidateTest }
      }
    });
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/booking",
      repositorySnapshot: snapshot,
      runner: { run: async () => ({ passed: true, output: "remaining suite passed", exitCode: 0 }) }
    });

    const evidence = await validator.validate({
      runId: "run-v2-integrity",
      attemptId: `attempt-${expectedCode}`,
      contract,
      candidateCommit: candidate,
      baselineCommit: baseline
    });

    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toEqual([
      expect.objectContaining({ code: expectedCode, path: "tests/api.test.ts", findingId: expect.any(String) })
    ]);
    expect(evidence.criteria.some((criterion) => criterion.evidenceRefs.some((ref) => ref.startsWith("test-integrity:")))).toBe(true);
  });

  it("rejects a green candidate that narrows a nested package test script", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = {
      ...original,
      validation: {
        ...original.validation,
        obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const }))
      }
    };
    const candidate = "7".repeat(40);
    const baseline = compiled.graph.baseCommit;
    const manifest = "packages/api/package.json";
    const git = new FakeGitRunner({
      diffRangeNameOnly: [manifest],
      showFileByRef: {
        [baseline]: { [manifest]: JSON.stringify({ scripts: { test: "pnpm run unit", unit: "vitest run" } }) },
        [candidate]: { [manifest]: JSON.stringify({ scripts: { test: "pnpm run unit", unit: "vitest run tests/smoke.test.ts" } }) }
      }
    });
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/booking",
      repositorySnapshot: snapshot,
      runner: { run: async () => ({ passed: true, output: "narrow suite passed", exitCode: 0 }) }
    });

    const evidence = await validator.validate({
      runId: "run-v2-script-integrity",
      attemptId: "attempt-script",
      contract,
      candidateCommit: candidate,
      baselineCommit: baseline
    });

    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toEqual([
      expect.objectContaining({ code: "test_script_weakened", path: `${manifest}#scripts.unit` })
    ]);
  });

  it("rejects a green candidate that narrows test discovery configuration", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const contract = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const candidate = "6".repeat(40);
    const git = new FakeGitRunner({ diffRangeNameOnly: ["vitest.config.ts"] });
    const validator = new ExactCandidateValidatorV2({
      git,
      workspaces: fakeWorkspaceProvider(git),
      repoRoot: "C:/repo/booking",
      repositorySnapshot: snapshot,
      runner: { run: async () => ({ passed: true, output: "smoke-only suite passed", exitCode: 0 }) }
    });
    const evidence = await validator.validate({ runId: "run-config", attemptId: "attempt-config", contract, candidateCommit: candidate, baselineCommit: compiled.graph.baseCommit });
    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({ code: "test_configuration_changed", path: "vitest.config.ts" }));
  });

  it.each([
    ["embedded Jest config", ["package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "jest" }, jest: { testMatch: ["**/*.test.ts"] } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "jest" }, jest: { testMatch: ["**/smoke.test.ts"] } }) },
      expectedPath: "package.json"
    }],
    ["external wrapper", ["scripts/run-tests.mjs"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": "process.exit(0);" },
      expectedPath: "scripts/run-tests.mjs"
    }],
    ["nested workspace wrapper", ["packages/api/scripts/run-tests.mjs"], {
      baseline: { "packages/api/package.json": JSON.stringify({ scripts: { test: "node scripts\\run-tests.mjs" } }), "packages/api/scripts/run-tests.mjs": "runAll();" },
      candidate: { "packages/api/package.json": JSON.stringify({ scripts: { test: "node scripts\\run-tests.mjs" } }), "packages/api/scripts/run-tests.mjs": "process.exit(0);" },
      expectedPath: "packages/api/scripts/run-tests.mjs"
    }],
    ["transitive wrapper import", ["scripts/select-tests.mjs"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "./select-tests.mjs";', "scripts/select-tests.mjs": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "./select-tests.mjs";', "scripts/select-tests.mjs": "process.exit(0);" },
      expectedPath: "scripts/select-tests.mjs"
    }],
    ["workspace package alias", ["packages/test-selector/src/index.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "@repo/test-selector";', "packages/test-selector/package.json": JSON.stringify({ name: "@repo/test-selector", exports: "./src/index.ts" }), "packages/test-selector/src/index.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "@repo/test-selector";', "packages/test-selector/package.json": JSON.stringify({ name: "@repo/test-selector", exports: "./src/index.ts" }), "packages/test-selector/src/index.ts": "process.exit(0);" },
      expectedPath: "packages/test-selector/src/index.ts"
    }],
    ["NodeNext source mapping", ["scripts/select-tests.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "./select-tests.js";', "scripts/select-tests.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "./select-tests.js";', "scripts/select-tests.ts": "process.exit(0);" },
      expectedPath: "scripts/select-tests.ts"
    }],
    ["literal selector data", ["scripts/test-selection.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'readFileSync("./test-selection.json");', "scripts/test-selection.json": "all" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'readFileSync("./test-selection.json");', "scripts/test-selection.json": "smoke" },
      expectedPath: "scripts/test-selection.json"
    }],
    ["spawned selector", ["scripts/select-tests.mjs"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'spawn("node", ["./select-tests.mjs"]);', "scripts/select-tests.mjs": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'spawn("node", ["./select-tests.mjs"]);', "scripts/select-tests.mjs": "process.exit(0);" },
      expectedPath: "scripts/select-tests.mjs"
    }],
    ["Makefile test recipe", ["Makefile"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "make test" } }), "Makefile": "test:\n\tvitest run" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "make test" } }), "Makefile": "test:\n\tvitest run tests/smoke.test.ts" },
      expectedPath: "Makefile"
    }],
    ["workspace exports redirect", ["packages/test-selector/package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "@repo/test-selector";', "packages/test-selector/package.json": JSON.stringify({ name: "@repo/test-selector", exports: "./src/all.ts" }), "packages/test-selector/src/all.ts": "runAll();", "packages/test-selector/src/smoke.ts": "runSmoke();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": 'import "@repo/test-selector";', "packages/test-selector/package.json": JSON.stringify({ name: "@repo/test-selector", exports: "./src/smoke.ts" }), "packages/test-selector/src/all.ts": "runAll();", "packages/test-selector/src/smoke.ts": "runSmoke();" },
      expectedPath: "packages/test-selector/package.json"
    }],
    ["tsconfig path alias", ["packages/test-selector/src/index.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@tests/selector": ["packages/test-selector/src/index.ts"] } } }), "scripts/run-tests.mjs": 'import "@tests/selector";', "packages/test-selector/src/index.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@tests/selector": ["packages/test-selector/src/index.ts"] } } }), "scripts/run-tests.mjs": 'import "@tests/selector";', "packages/test-selector/src/index.ts": "process.exit(0);" },
      expectedPath: "packages/test-selector/src/index.ts"
    }],
    ["cross-workspace script", ["packages/api/package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm -C packages/api verify -- tests/all.test.ts" } }), "packages/api/package.json": JSON.stringify({ name: "@repo/api", scripts: { verify: "vitest run" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm -C packages/api verify -- tests/all.test.ts" } }), "packages/api/package.json": JSON.stringify({ name: "@repo/api", scripts: { verify: "vitest run tests/smoke.test.ts" } }) },
      expectedPath: "packages/api/package.json#scripts.verify"
    }],
    ["multiple workspace filters", ["packages/web/package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm -C . --filter \"@repo/*\" --filter \"!@repo/api\" verify" } }), "packages/web/package.json": JSON.stringify({ name: "@repo/web", scripts: { verify: "vitest run" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm -C . --filter \"@repo/*\" --filter \"!@repo/api\" verify" } }), "packages/web/package.json": JSON.stringify({ name: "@repo/web", scripts: { verify: "vitest run tests/smoke.test.ts" } }) },
      expectedPath: "packages/web/package.json#scripts.verify"
    }],
    ["dotted package script", ["package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm run unit.test", "unit.test": "vitest run" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm run unit.test", "unit.test": "vitest run tests/smoke.test.ts" } }) },
      expectedPath: "package.json#scripts.unit.test"
    }],
    ["package imports without name", ["scripts/select-tests.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" }, imports: { "#selector": "./scripts/select-tests.ts" } }), "scripts/run-tests.mjs": 'import "#selector";', "scripts/select-tests.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" }, imports: { "#selector": "./scripts/select-tests.ts" } }), "scripts/run-tests.mjs": 'import "#selector";', "scripts/select-tests.ts": "process.exit(0);" },
      expectedPath: "scripts/select-tests.ts"
    }],
    ["extended JSONC tsconfig alias", ["scripts/select-tests.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": '{ "extends": "./configs/tsconfig.base.json", // shared\n}', "configs/tsconfig.base.json": '{ "compilerOptions": { "baseUrl": "..", "paths": { "@selector": ["scripts/select-tests.ts",], }, }, }', "scripts/run-tests.mjs": 'import "@selector";', "scripts/select-tests.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": '{ "extends": "./configs/tsconfig.base.json", // shared\n}', "configs/tsconfig.base.json": '{ "compilerOptions": { "baseUrl": "..", "paths": { "@selector": ["scripts/select-tests.ts",], }, }, }', "scripts/run-tests.mjs": 'import "@selector";', "scripts/select-tests.ts": "process.exit(0);" },
      expectedPath: "scripts/select-tests.ts"
    }],
    ["most specific tsconfig path", ["packages/selector/config.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@tests/*": ["fallback/*"], "@tests/selector/*": ["packages/selector/*"] } } }), "scripts/run-tests.mjs": 'import "@tests/selector/config";', "packages/selector/config.ts": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@tests/*": ["fallback/*"], "@tests/selector/*": ["packages/selector/*"] } } }), "scripts/run-tests.mjs": 'import "@tests/selector/config";', "packages/selector/config.ts": "process.exit(0);" },
      expectedPath: "packages/selector/config.ts"
    }],
    ["opaque dynamic selector", ["scripts/select-tests.mjs"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": "const selector = process.env.TEST_SELECTOR; await import(selector);", "scripts/select-tests.mjs": "runAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } }), "scripts/run-tests.mjs": "const selector = process.env.TEST_SELECTOR; await import(selector);", "scripts/select-tests.mjs": "process.exit(0);" },
      expectedPath: "scripts/run-tests.mjs"
    }]
  ] as const)("rejects coverage narrowed through %s", async (_label, changedFiles, fixture) => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const candidate = "5".repeat(40);
    const git = new FakeGitRunner({ diffRangeNameOnly: [...changedFiles], showFileByRef: {
      [compiled.graph.baseCommit]: fixture.baseline,
      [candidate]: fixture.candidate
    } });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "narrow passed", exitCode: 0 }) } });
    const evidence = await validator.validate({ runId: "run-input", attemptId: "attempt-input", contract: compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!, candidateCommit: candidate, baselineCommit: compiled.graph.baseCommit });
    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({ path: fixture.expectedPath }));
  });

  it("does not treat a production-only script dependency as test configuration", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const candidate = "4".repeat(40);
    const baseline = compiled.graph.baseCommit;
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["scripts/dev-renderer.mjs"],
      showFileByRef: {
        [baseline]: { "package.json": JSON.stringify({ scripts: { test: "vitest run", dev: "node scripts/dev.mjs" } }), "scripts/dev.mjs": 'import "./dev-renderer.mjs";', "scripts/dev-renderer.mjs": "render();" },
        [candidate]: { "package.json": JSON.stringify({ scripts: { test: "vitest run", dev: "node scripts/dev.mjs" } }), "scripts/dev.mjs": 'import "./dev-renderer.mjs";', "scripts/dev-renderer.mjs": "renderSafely();" }
      }
    });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) } });
    const evidence = await validator.validate({ runId: "run-dev", attemptId: "attempt-dev", contract: compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!, candidateCommit: candidate, baselineCommit: baseline });
    expect(evidence.outcome).toBe("verified");
    expect(evidence.integrityFindings).toEqual([]);
  });

  it("does not reject an unrelated product change because the stable test wrapper is opaque", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const candidate = "3".repeat(40);
    const baseline = compiled.graph.baseCommit;
    const manifest = JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" } });
    const wrapper = "const selector = process.env.TEST_SELECTOR; await import(selector);";
    const git = new FakeGitRunner({ diffRangeNameOnly: ["src/feature.ts"], showFileByRef: { [baseline]: { "package.json": manifest, "scripts/run-tests.mjs": wrapper, "src/feature.ts": "old();" }, [candidate]: { "package.json": manifest, "scripts/run-tests.mjs": wrapper, "src/feature.ts": "fixed();" } } });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) } });
    const evidence = await validator.validate({ runId: "run-opaque-product", attemptId: "attempt-opaque-product", contract: compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!, candidateCommit: candidate, baselineCommit: baseline });
    expect(evidence.outcome).toBe("verified");
  });

  it.each([
    ["filtered workspace script", ["packages/web/package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm --filter @repo/api run verify" } }), "packages/web/package.json": JSON.stringify({ name: "@repo/web", scripts: { verify: "vitest run" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm --filter @repo/api run verify" } }), "packages/web/package.json": JSON.stringify({ name: "@repo/web", scripts: { verify: "vitest run tests/web-smoke.test.ts" } }) }
    }],
    ["filtered homonym in source manifest", ["package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm --filter @repo/api verify", verify: "vitest run" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm --filter @repo/api verify", verify: "vitest run tests/root-smoke.test.ts" } }) }
    }],
    ["pnpm exec homonym", ["package.json"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "pnpm exec vitest", vitest: "node scripts/dev.mjs" } }) },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "pnpm exec vitest", vitest: "node scripts/dev-smoke.mjs" } }) }
    }],
    ["private alias in another package", ["packages/web/scripts/select.ts"], {
      baseline: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" }, imports: { "#selector": "./scripts/root-select.ts" } }), "scripts/run-tests.mjs": 'import "#selector";', "scripts/root-select.ts": "runAll();", "packages/web/package.json": JSON.stringify({ imports: { "#selector": "./scripts/select.ts" } }), "packages/web/scripts/select.ts": "webAll();" },
      candidate: { "package.json": JSON.stringify({ scripts: { test: "node scripts/run-tests.mjs" }, imports: { "#selector": "./scripts/root-select.ts" } }), "scripts/run-tests.mjs": 'import "#selector";', "scripts/root-select.ts": "runAll();", "packages/web/package.json": JSON.stringify({ imports: { "#selector": "./scripts/select.ts" } }), "packages/web/scripts/select.ts": "webSmoke();" }
    }]
  ] as const)("does not reject an unrelated %s", async (_label, changedFiles, fixture) => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const candidate = "a".repeat(40);
    const git = new FakeGitRunner({ diffRangeNameOnly: [...changedFiles], showFileByRef: { [compiled.graph.baseCommit]: fixture.baseline, [candidate]: fixture.candidate } });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) } });
    const evidence = await validator.validate({ runId: "run-scope", attemptId: "attempt-scope", contract: compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!, candidateCommit: candidate, baselineCommit: compiled.graph.baseCommit });
    expect(evidence.outcome).toBe("verified");
  });

  it("fails closed before loading changed test content beyond the shared integrity budget", async () => {
    const snapshot = bookingSnapshot();
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
    const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    const contract = { ...original, validation: { ...original.validation, obligations: original.validation.obligations.map((obligation) => ({ ...obligation, negativeControl: "not_required" as const })) } };
    const baseline = compiled.graph.baseCommit;
    const candidate = "2".repeat(40);
    const path = "tests/oversized.test.ts";
    const large = `it("works", () => { expect(true).toBe(true); });\n/*${"x".repeat(1_048_576)}*/`;
    const git = new FakeGitRunner({ diffRangeNameOnly: [path], showFileByRef: { [baseline]: { [path]: large }, [candidate]: { [path]: `${large} ` } } });
    const validator = new ExactCandidateValidatorV2({ git, workspaces: fakeWorkspaceProvider(git), repoRoot: "C:/repo/booking", repositorySnapshot: snapshot, runner: { run: async () => ({ passed: true, output: "passed", exitCode: 0 }) } });
    const evidence = await validator.validate({ runId: "run-budget", attemptId: "attempt-budget", contract, candidateCommit: candidate, baselineCommit: baseline });
    expect(evidence.outcome).toBe("failed");
    expect(evidence.integrityFindings).toContainEqual(expect.objectContaining({ code: "test_configuration_changed", path }));
  });

  it("persists and rejects a feasible negative control that stays green on the baseline", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "manyhands-nc-"));
    try {
      const snapshot = bookingSnapshot();
      const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: snapshot }, compilerDependencies);
      const original = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")!;
      const contract = {
        ...original,
        validation: {
          ...original.validation,
          obligations: original.validation.obligations.map((obligation) => ({
            ...obligation,
            baselinePolicy: "not_required" as const,
            negativeControl: "required" as const
          }))
        }
      };
      const candidate = "8".repeat(40);
      const addedTest = "tests/new-behavior.test.ts";
      const candidateSource = 'it("claims coverage", () => { expect(true).toBe(true); });';
      const git = new FakeGitRunner({
        diffRangeNameOnly: [addedTest],
        showFileByRef: { [candidate]: { [addedTest]: candidateSource } }
      });
      const validator = new ExactCandidateValidatorV2({
        git,
        workspaces: fakeWorkspaceProvider(git, tempRoot),
        repoRoot: tempRoot,
        repositorySnapshot: snapshot,
        runner: {
          run: async (_commands, context) => {
            if (context.worktreePath.includes("-negative-")) {
              expect(await readFile(path.join(context.worktreePath, addedTest), "utf8")).toBe(candidateSource);
              return { passed: true, output: "candidate test also passed on baseline", exitCode: 0 };
            }
            return { passed: true, output: "candidate passed", exitCode: 0 };
          }
        }
      });

      const evidence = await validator.validate({
        runId: "run-v2-control",
        attemptId: "attempt-api-control",
        contract,
        candidateCommit: candidate,
        baselineCommit: compiled.graph.baseCommit
      });

      expect(evidence.outcome).toBe("failed");
      expect(evidence.negativeControls).toEqual(contract.validation.obligations.map((obligation) => expect.objectContaining({
        obligationId: obligation.id,
        detectedFailure: false,
        evidenceId: `${obligation.id}:negative-control`,
        outputDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })));
      expect(evidence.criteria.every((criterion) => criterion.evidenceRefs.includes(`${criterion.obligationId}:negative-control`))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
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
    outcome: "verified",
    validationRecipeDigest: "sha256:recipe-v2",
    observations: []
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
