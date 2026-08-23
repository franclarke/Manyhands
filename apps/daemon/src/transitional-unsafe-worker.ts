import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  CanonicalValidationObligationSchema,
  GoalContractSchema,
  ProofStrategySchema,
  TaskContractBundleSchema,
  type CanonicalValidationObligation,
  type GoalContract,
  type ProofStrategy,
  type TaskContractBundle
} from "@manyhands/contracts";
import {
  CanonicalNodeExecutor,
  DefaultAgentExecutorFactory,
  EphemeralExecutionWorkspaceProvider,
  ExactCandidateValidatorV2,
  ExecutionBaseBuilder,
  ExecutionConfigSchema,
  FinalCandidatePreparer,
  JsonIntegrationOperationJournal,
  NativeWorktreeGit,
  SimpleGitRunner,
  WorktreeManager,
  describeSandboxSurface,
  getExecutorDescriptor,
  isEffortLevel,
  resolveCliBinaryPath,
  safeGitArgs,
  type StageSelection,
  type V2FinalCandidatePort
} from "@manyhands/execution-core";
import {
  CanonicalExecutionDriver,
  type CanonicalNodeExecutionOutcome
} from "@manyhands/orchestrator-graph";
import {
  RepositorySnapshotSchema,
  type RepositorySnapshot
} from "@manyhands/repository-index";
import {
  RunCoordinator,
  RunEventSchema,
  foldRun,
  type ProductRunDefinition,
  type RunEvent,
  type RunEventInput,
  type RunEventJournalPort,
  type RunProjection
} from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import {
  GraphRevisionSchema,
  type GraphRevision
} from "@manyhands/task-graph";
import { JsonlTraceStore } from "@manyhands/trace-store";

import { stage8SandboxFor, type Stage8Sandbox } from "./stage8-sandbox.js";
import { FileTransitionalLifecycleResultStore } from "./transitional-unsafe-profile.js";
import { withTransitionalRepositoryLease } from "./transitional-repository-lease.js";

const execFileAsync = promisify(execFile);

interface WorkerArguments {
  stateRoot: string;
  runId: string;
  attemptId: string;
}

interface ApprovedExecutionPlan {
  graph: GraphRevision;
  contracts: Record<string, TaskContractBundle>;
  repositorySnapshot: RepositorySnapshot;
  state: RunProjection;
  definition: ProductRunDefinition;
  evidenceAuthority: {
    goal: GoalContract;
    validationObligations: Record<string, CanonicalValidationObligation>;
    proofStrategies: Record<string, ProofStrategy>;
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  const canonicalStore = new JsonlRunEventStore({
    directory: path.join(input.stateRoot, "runs")
  });
  const originalEvents = await canonicalStore.load(input.runId);
  const journal = memoryJournal(originalEvents);
  const resultStore = new FileTransitionalLifecycleResultStore(
    path.join(input.stateRoot, "transitional-results")
  );
  try {
    const prepared = loadApprovedExecutionPlan(originalEvents);
    const repoRoot = targetPath(prepared.definition);
    await withTransitionalRepositoryLease({
      repoRoot,
      runId: input.runId
    }, async (repositorySignal) => {
      let worktrees: WorktreeManager | undefined;
      try {
    const config = ExecutionConfigSchema.parse({
      ...prepared.definition.executionConfig,
      ...(process.env.MANYHANDS_EXECUTION_LEAF_TIMEOUT_MS === undefined
        ? {}
        : { leafTimeoutMs: Number(process.env.MANYHANDS_EXECUTION_LEAF_TIMEOUT_MS) })
    });
    const execution = stageSelection(prepared.definition.executionSelection, "execution");
    const repair = stageSelection(prepared.definition.repairSelection, "repair");
    const sandbox = stage8SandboxFor({
      stateRoot: input.stateRoot,
      executionExecutorId: execution.executorId
    });
    const executorReady = await executorAvailability(execution.executorId);
    const git = new SimpleGitRunner();
    await git.revParse(repoRoot, `${targetField(prepared.definition, "sourceBaseCommit")}^{commit}`);
    const baselineTree = await git.revParse(repoRoot, `${targetField(prepared.definition, "sourceBaseCommit")}^{tree}`);
    worktrees = new WorktreeManager({ git, repoRoot });
    const workspaces = new EphemeralExecutionWorkspaceProvider({
      repoRoot,
      worktreesRoot: path.join(repoRoot, ".manyhands", "worktrees"),
      git: new NativeWorktreeGit()
    });
    const traceStore = new JsonlTraceStore({
      runId: input.runId,
      directory: path.join(input.stateRoot, "traces")
    });
    const nodeExecutor = new CanonicalNodeExecutor({
      git,
      repoRoot,
      worktrees,
      baseBuilder: new ExecutionBaseBuilder({ git, workspaceProvider: workspaces }),
      traceStore,
      executorFactory: new DefaultAgentExecutorFactory(),
      ...(sandbox === undefined ? {} : { sandbox }),
      validator: new ExactCandidateValidatorV2({
        git,
        workspaces,
        repoRoot,
        repositorySnapshot: prepared.repositorySnapshot,
        bootstrapValidation: true,
        operationId: input.attemptId,
        traceStore
      }),
      evidenceAuthority: prepared.evidenceAuthority,
      finalCandidate: finalCandidatePort({
        git,
        repoRoot,
        baseCommit: targetField(prepared.definition, "sourceBaseCommit")
      }),
      integrationOperation: {
        journal: new JsonIntegrationOperationJournal(
          path.join(input.stateRoot, "integration-operations")
        ),
        runId: input.runId,
        operationId: input.attemptId
      }
    });
    const coordinator = new RunCoordinator({
      events: journal,
      delivery: {
        publish: async () => {
          throw new Error("Delivery is owned by the daemon delivery adapter.");
        }
      },
      clock: now,
      eventId: (type, sequence) => `${input.runId}:${type}:${sequence}`
    });
    const profile = {
      id: execution.executorId,
      revision: executorProfileRevision(execution, sandbox)
    };
    const availableExecutorNodeIds = executorReady
      ? Object.keys(prepared.graph.nodes)
      : [];
    const driver = new CanonicalExecutionDriver({
      coordinator,
      now,
      estimateIntegrationRisk: (candidate, selected) => integrationRisk(prepared.graph, candidate.nodeId, selected.map(({ nodeId }) => nodeId)),
      execute: async (nodeInput): Promise<CanonicalNodeExecutionOutcome> => nodeExecutor.execute({
        ...nodeInput,
        selection: execution,
        repairSelection: repair,
        config,
        target: {
          sourceTargetFingerprint: targetField(prepared.definition, "fingerprint"),
          targetBranch: targetField(prepared.definition, "sourceBranch"),
          targetHead: targetField(prepared.definition, "sourceBaseCommit")
        },
        signal: repositorySignal
      })
    });
    await driver.run({
      runId: input.runId,
      graph: prepared.graph,
      contracts: prepared.contracts,
      repositoryContextDigest: prepared.repositorySnapshot.snapshotId,
      executorProfile: profile,
      effectiveConfig: {
        maxParallel: config.maxParallel,
        ...(config.maxTokensTotal === undefined
          ? {}
          : { maxTokensTotal: config.maxTokensTotal }),
        ...(config.maxCostUsd === undefined ? {} : { maxCostUsd: config.maxCostUsd }),
      },
      availableExecutorNodeIds,
      target: {
        sourceTargetFingerprint: targetField(prepared.definition, "fingerprint"),
        targetBranch: targetField(prepared.definition, "sourceBranch"),
        targetHead: targetField(prepared.definition, "sourceBaseCommit")
      },
      evidenceAuthority: {
        ...prepared.evidenceAuthority,
        baseline: {
          commitOid: targetField(prepared.definition, "sourceBaseCommit"),
          treeOid: baselineTree
        }
      }
    });
      } finally {
        if (!repositorySignal.aborted) {
          await worktrees?.gcRun(input.runId).catch((error: unknown) => {
            process.stderr.write(
              `Worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`
            );
          });
        }
      }
    });
  } catch (error) {
    await journal.append(input.runId, journal.sequence(), [{
      eventId: `${input.runId}:execution:failed:${journal.sequence() + 1}`,
      occurredAt: now(),
      type: "run.failed",
      payload: {
        reason: error instanceof Error ? error.message : String(error),
        area: "execution"
      }
    }]);
  }

  await resultStore.writeExecution(input.runId, input.attemptId, {
    events: journal.addedEvents().map(withoutJournalIdentity)
  });
}

function loadApprovedExecutionPlan(events: readonly RunEvent[]): ApprovedExecutionPlan {
  const state = foldRun(events);
  if (state.definition === undefined) {
    throw new Error("Transitional execution requires the immutable run definition.");
  }
  if (
    state.graphId === undefined
    || state.graphRevision === undefined
    || state.approvedGraphRevision !== state.graphRevision
  ) {
    throw new Error("Transitional execution requires the exact current graph revision to be approved.");
  }
  const compiled = [...events].reverse().find((event) =>
    event.type === "graph.compiled"
    && event.payload.graphId === state.graphId
    && event.payload.revision === state.approvedGraphRevision
  );
  if (compiled?.type !== "graph.compiled") {
    throw new Error(`Approved graph ${state.graphId}@${state.approvedGraphRevision} has no compiled event.`);
  }
  const inspected = [...events].reverse().find((event) => event.type === "repository.inspected");
  if (inspected?.type !== "repository.inspected") {
    throw new Error("Transitional execution requires the immutable repository snapshot from planning.");
  }
  const graph = GraphRevisionSchema.parse(compiled.payload.graph);
  const contracts = Object.fromEntries(compiled.payload.contracts.map((contract) => {
    const bundle = TaskContractBundleSchema.parse(contract);
    return [bundle.task.nodeId, bundle];
  }));
  if (compiled.payload.evidenceAuthority === undefined) {
    throw new Error("Approved graph has no immutable validation authority; re-plan before execution.");
  }
  const authority = compiled.payload.evidenceAuthority;
  const goal = GoalContractSchema.parse(authority.goal);
  const validationObligations = Object.fromEntries(
    authority.validationObligations.map((obligation) => {
      const parsed = CanonicalValidationObligationSchema.parse(obligation);
      return [parsed.id, parsed];
    })
  );
  const proofStrategies = Object.fromEntries(
    authority.proofStrategies.map((strategy) => {
      const parsed = ProofStrategySchema.parse(strategy);
      return [parsed.id, parsed];
    })
  );
  const repositorySnapshot = RepositorySnapshotSchema.parse(
    inspected.payload.snapshot
  ) as RepositorySnapshot;
  const repositoryView = inspected.payload.repositoryView;
  if (repositoryView === undefined ||
      repositoryView.digest !== graph.repositoryView.digest ||
      repositoryView.treeSha !== graph.repositoryView.treeSha ||
      repositoryView.resourceCatalogDigest !== graph.repositoryView.resourceCatalogDigest) {
    throw new Error("Approved graph does not match the exact repository view captured during planning.");
  }
  return {
    graph,
    contracts,
    repositorySnapshot,
    state,
    definition: state.definition,
    evidenceAuthority: { goal, validationObligations, proofStrategies }
  };
}

function memoryJournal(initialEvents: readonly RunEvent[]): RunEventJournalPort & {
  sequence(): number;
  addedEvents(): RunEvent[];
} {
  let events = structuredClone(initialEvents) as RunEvent[];
  const initialLength = events.length;
  return {
    load: async (runId) => events
      .filter((event) => event.runId === runId)
      .map((event) => structuredClone(event)),
    append: async (runId, expectedSequence, inputs) => {
      if (expectedSequence !== events.length) {
        throw new Error(
          `Transitional execution journal expected sequence ${expectedSequence}, current ${events.length}.`
        );
      }
      const appended = inputs.map((event, index) => RunEventSchema.parse({
        ...structuredClone(event),
        runId,
        sequence: expectedSequence + index + 1
      }));
      events = [...events, ...appended];
      return structuredClone(appended);
    },
    sequence: () => events.length,
    addedEvents: () => structuredClone(events.slice(initialLength))
  };
}

function withoutJournalIdentity(event: RunEvent): RunEventInput {
  const { runId, sequence, ...input } = event;
  void runId;
  void sequence;
  return input as RunEventInput;
}

async function executorAvailability(executorId: string): Promise<boolean> {
  const descriptor = getExecutorDescriptor(
    executorId as Parameters<typeof getExecutorDescriptor>[0]
  );
  if (!descriptor.enabled) return false;
  const configured = process.env[descriptor.binaryEnvVar] ?? descriptor.defaultBinary;
  return existsSync(resolveCliBinaryPath(configured));
}

function integrationRisk(graph: GraphRevision, candidateNodeId: string, selectedNodeIds: readonly string[]): {
  score: number;
  evidenceRefs: string[];
} {
  if (selectedNodeIds.length === 0) return { score: 0, evidenceRefs: [] };
  const related = graph.seamBindings.filter((binding) =>
    (binding.producerNodeId === candidateNodeId && selectedNodeIds.includes(binding.consumerNodeId)) ||
    (binding.consumerNodeId === candidateNodeId && selectedNodeIds.includes(binding.producerNodeId))
  ).slice(0, 8);
  return {
    score: related.length * 25,
    evidenceRefs: related.flatMap((binding) => [binding.id, ...binding.validationObligationIds]).sort()
  };
}

function finalCandidatePort(input: {
  git: SimpleGitRunner;
  repoRoot: string;
  baseCommit: string;
}): V2FinalCandidatePort {
  return {
    prepare: async (request) => {
      const manifestId = `final-${createHash("sha256").update(JSON.stringify({
        runId: request.runId,
        candidateCommit: request.candidateCommit,
        evidenceMatrixId: request.evidenceMatrix.matrixId,
        target: request.targetHead,
        graphRevision: request.graphRevision,
        artifactIds: request.artifactIds,
        validationRecipeDigest: request.validationRecipeDigest
      })).digest("hex").slice(0, 16)}`;
      const preparer = new FinalCandidatePreparer({
        clock: now,
        validate: async ({ candidateCommit }) => ({
          matrixId: request.evidenceMatrix.matrixId,
          candidateCommit,
          eligible: request.evidenceMatrix.outcome === "verified"
            && request.evidenceMatrix.candidateCommit === candidateCommit
        }),
        prepare: async ({ runId, integratedCommit }) => {
          await input.git.revParse(input.repoRoot, `${integratedCommit}^{commit}`);
          const candidateRef = `manyhands/run-${slug(runId)}`;
          await execFileAsync(
            "git",
            safeGitArgs(input.repoRoot, ["branch", "-f", candidateRef, integratedCommit]),
            { cwd: input.repoRoot, windowsHide: true }
          );
          return {
            candidateCommit: integratedCommit,
            candidateRef,
            changedFiles: await input.git.diffRangeNameOnly({
              cwd: input.repoRoot,
              from: input.baseCommit,
              to: integratedCommit
            })
          };
        }
      });
      const prepared = await preparer.prepare({
        manifestId,
        runId: request.runId,
        integratedCommit: request.candidateCommit,
        sourceTargetFingerprint: request.sourceTargetFingerprint,
        targetBranch: request.targetBranch,
        targetHead: request.targetHead
      });
      const treeSha = await input.git.revParse(
        input.repoRoot,
        `${prepared.candidateCommit}^{tree}`
      );
      return {
        manifestId,
        finalManifest: {
          commitSha: prepared.candidateCommit,
          treeSha,
          graphRevision: request.graphRevision,
          artifactIds: [...request.artifactIds].sort(),
          evidenceMatrixId: prepared.evidenceMatrixId,
          validationRecipeDigest: request.validationRecipeDigest,
          deliveryTarget: request.targetBranch,
          ...(request.granularityPolicy === undefined
            ? {}
            : { granularityPolicy: request.granularityPolicy })
        }
      };
    }
  };
}

/**
 * The recorded surface comes from the provider that will actually create the
 * session. An independently written capability literal here would be a second
 * statement of the boundary with no way to fail when it disagrees with the one
 * the sandbox enforces.
 */
function executorProfileRevision(
  selection: StageSelection,
  sandbox: Stage8Sandbox | undefined
): string {
  const surface = sandbox === undefined
    ? { profile: "unsafe_local", capabilities: "unverified" }
    : describeSandboxSurface({
        profile: sandbox.profile,
        capabilities: sandbox.provider.capabilities(),
        ...(sandbox.windowsSandbox === undefined ? {} : { windowsSandbox: sandbox.windowsSandbox })
      });
  return `sha256:${createHash("sha256").update(JSON.stringify({ selection, sandbox: surface })).digest("hex")}`;
}

function stageSelection(
  value: ProductRunDefinition["executionSelection"],
  stage: string
): StageSelection {
  const descriptor = getExecutorDescriptor(
    value.executorId as Parameters<typeof getExecutorDescriptor>[0]
  );
  if (descriptor.id !== value.executorId) {
    throw new Error(`Unsupported ${stage} executor ${value.executorId}.`);
  }
  if (value.effort !== undefined && !isEffortLevel(value.effort)) {
    throw new Error(`Unsupported ${stage} reasoning effort ${value.effort}.`);
  }
  return {
    executorId: descriptor.id,
    model: value.model,
    ...(value.effort === undefined ? {} : { effort: value.effort })
  };
}

function targetPath(definition: ProductRunDefinition): string {
  const value = targetField(definition, "sourceRealPath");
  if (!path.isAbsolute(value)) {
    throw new Error("The captured target path must be absolute.");
  }
  return path.resolve(value);
}

function targetField(definition: ProductRunDefinition, key: string): string {
  const value = definition.targetContext[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Target context ${key} is required.`);
  }
  return value;
}

function parseArguments(argv: readonly string[]): WorkerArguments {
  const value = (name: string): string => {
    const index = argv.indexOf(name);
    const candidate = index < 0 ? undefined : argv[index + 1];
    if (candidate === undefined || candidate.length === 0) {
      throw new Error(`Missing required worker argument ${name}.`);
    }
    return candidate;
  };
  const stateRoot = value("--state-root");
  if (!path.isAbsolute(stateRoot)) {
    throw new Error("--state-root must be absolute.");
  }
  return {
    stateRoot: path.resolve(stateRoot),
    runId: value("--run-id"),
    attemptId: value("--attempt-id")
  };
}

function slug(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "run";
}

function now(): string {
  return new Date().toISOString();
}
