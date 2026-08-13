import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import {
  createConflictConstraintEvidence,
  type ConflictConstraintEvidence
} from "@manyhands/conflict-risk";
import {
  DefaultAgentExecutorFactory,
  EphemeralExecutionWorkspaceProvider,
  ExactCandidateValidatorV2,
  ExecutionBaseBuilder,
  ExecutionConfigSchema,
  FinalCandidatePreparer,
  JsonIntegrationOperationJournal,
  NativeWorktreeGit,
  SimpleGitRunner,
  V2NodeExecutor,
  WorktreeManager,
  getExecutorDescriptor,
  isEffortLevel,
  resolveCliBinaryPath,
  safeGitArgs,
  type StageSelection,
  type V2FinalCandidatePort
} from "@manyhands/execution-core";
import {
  V2ExecutionDriver,
  type V2NodeExecutionOutcome
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
import type { GranularityPolicyManifest } from "@manyhands/shared";
import {
  LegacyGraphRevisionV2Schema,
  type LegacyGraphRevisionV2
} from "@manyhands/task-graph";
import { JsonlTraceStore } from "@manyhands/trace-store";

import { FileTransitionalLifecycleResultStore } from "./transitional-unsafe-profile.js";
import { withTransitionalRepositoryLease } from "./transitional-repository-lease.js";

const execFileAsync = promisify(execFile);

interface WorkerArguments {
  stateRoot: string;
  runId: string;
  attemptId: string;
}

interface ApprovedExecutionPlan {
  graph: LegacyGraphRevisionV2;
  contracts: TaskContractBundle[];
  repositorySnapshot: RepositorySnapshot;
  state: RunProjection;
  definition: ProductRunDefinition;
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
    const config = ExecutionConfigSchema.parse(prepared.definition.executionConfig);
    const execution = stageSelection(prepared.definition.executionSelection, "execution");
    const repair = stageSelection(prepared.definition.repairSelection, "repair");
    const executorReady = await executorAvailability(execution.executorId);
    const git = new SimpleGitRunner();
    await git.revParse(repoRoot, `${prepared.graph.baseCommit}^{commit}`);
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
    const nodeExecutor = new V2NodeExecutor({
      git,
      repoRoot,
      worktrees,
      baseBuilder: new ExecutionBaseBuilder({ git, workspaceProvider: workspaces }),
      traceStore,
      executorFactory: new DefaultAgentExecutorFactory(),
      validator: new ExactCandidateValidatorV2({
        git,
        workspaces,
        repoRoot,
        repositorySnapshot: prepared.repositorySnapshot,
        bootstrapValidation: true,
        operationId: input.attemptId,
        traceStore
      }),
      finalCandidate: finalCandidatePort({
        git,
        repoRoot,
        baseCommit: prepared.graph.baseCommit
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
      revision: executorProfileRevision(execution)
    };
    const availableExecutorNodeIds = executorReady
      ? Object.keys(prepared.graph.nodes)
      : [];
    const driver = new V2ExecutionDriver({
      coordinator,
      now,
      loadCurrentInputs: async () => ({
        graph: prepared.graph,
        contracts: prepared.contracts,
        repositoryContextDigest: prepared.repositorySnapshot.snapshotId,
        executorProfile: profile,
        materializableNodeIds: materializableNodeIds(prepared.graph, prepared.contracts),
        availableExecutorNodeIds,
        evaluatedAt: now(),
        conflictConstraints: conflictEvidence(prepared.graph)
      }),
      execute: async (nodeInput): Promise<V2NodeExecutionOutcome> => nodeExecutor.execute({
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
    const policy = granularityPolicy(prepared.state);
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
        ...(config.automaticRetryBudget === undefined
          ? {}
          : { automaticRetryBudget: config.automaticRetryBudget })
      },
      materializableNodeIds: materializableNodeIds(prepared.graph, prepared.contracts),
      availableExecutorNodeIds,
      evaluatedAt: now(),
      conflictConstraints: conflictEvidence(prepared.graph),
      ...(policy === undefined ? {} : { granularityPolicy: policy }),
      target: {
        sourceTargetFingerprint: targetField(prepared.definition, "fingerprint"),
        targetBranch: targetField(prepared.definition, "sourceBranch"),
        targetHead: targetField(prepared.definition, "sourceBaseCommit")
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
  const graph = LegacyGraphRevisionV2Schema.parse(compiled.payload.graph);
  const contracts = compiled.payload.contracts.map((contract) =>
    TaskContractBundleSchema.parse(contract));
  const repositorySnapshot = RepositorySnapshotSchema.parse(
    inspected.payload.snapshot
  ) as RepositorySnapshot;
  if (graph.repositorySnapshotId !== repositorySnapshot.snapshotId) {
    throw new Error(
      `Graph repository snapshot ${graph.repositorySnapshotId} does not match ${repositorySnapshot.snapshotId}.`
    );
  }
  return { graph, contracts, repositorySnapshot, state, definition: state.definition };
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

function conflictEvidence(graph: LegacyGraphRevisionV2): ConflictConstraintEvidence[] {
  return graph.conflictConstraints.map((constraint) => createConflictConstraintEvidence({
    id: constraint.id,
    leftNodeId: constraint.leftNodeId,
    rightNodeId: constraint.rightNodeId,
    reason: constraint.reason,
    risk: constraint.risk,
    ...(constraint.mode === undefined ? {} : { mode: constraint.mode }),
    ...(constraint.resourceId === undefined ? {} : { resourceId: constraint.resourceId }),
    signals: [{
      type: "compiled_scope_overlap",
      detail: constraint.reason,
      sourceRef: constraint.id
    }],
    confidence: 1,
    observedAt: graph.createdAt
  }));
}

function materializableNodeIds(
  graph: LegacyGraphRevisionV2,
  contracts: readonly TaskContractBundle[]
): string[] {
  const contractByNode = new Map(contracts.map((bundle) => [bundle.task.nodeId, bundle]));
  return Object.values(graph.nodes)
    .filter((node) => contractByNode.get(node.id)?.artifacts
      .some((artifact) => artifact.producerNodeId === node.id) === true)
    .map((node) => node.id);
}

async function executorAvailability(executorId: string): Promise<boolean> {
  const descriptor = getExecutorDescriptor(
    executorId as Parameters<typeof getExecutorDescriptor>[0]
  );
  if (!descriptor.enabled) return false;
  const configured = process.env[descriptor.binaryEnvVar] ?? descriptor.defaultBinary;
  return existsSync(resolveCliBinaryPath(configured));
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

function granularityPolicy(state: RunProjection): GranularityPolicyManifest | undefined {
  const strategy = state.granularityStrategy;
  const config = strategy?.config;
  if (strategy === undefined || config?.maxLeafPlannedPaths === undefined) return undefined;
  return {
    policyVersion: strategy.policyVersion,
    maxLeafContextTokens: config.maxLeafContextTokens,
    maxLeafScopePaths: config.maxLeafScopePaths,
    maxLeafPlannedPaths: config.maxLeafPlannedPaths
  };
}

function executorProfileRevision(selection: StageSelection): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
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
