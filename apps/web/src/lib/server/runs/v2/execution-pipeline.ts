import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import { createConflictConstraintEvidence, type ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import {
  DefaultAgentExecutorFactory,
  ExactCandidateValidatorV2,
  ExecutionBaseBuilder,
  ExecutionConfigSchema,
  FinalCandidatePreparer,
  PooledExecutionWorkspaceProvider,
  SimpleGitRunner,
  V2NodeExecutor,
  WorktreeManager,
  WorktreePool,
  safeGitArgs,
  getExecutorDescriptor,
  resolveCliBinaryPath,
  JsonIntegrationOperationJournal,
  type V2FinalCandidatePort
} from "@manyhands/execution-core";
import { V2ExecutionDriver, type V2NodeExecutionOutcome } from "@manyhands/orchestrator-graph";
import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import {
  RunCoordinator,
  foldRun,
  type RunEvent,
  type RunLifecycle,
  type RunProjection
} from "@manyhands/run-coordinator";
import { EventStoreCompactor, JsonlRunEventStore, RunSnapshotStore, verifyAndRecoverRunStore } from "@manyhands/run-store";
import { GraphRevisionSchema, type GraphRevision } from "@manyhands/task-graph";
import type { GranularityPolicyManifest } from "@manyhands/shared";
import { JsonlTraceStore } from "@manyhands/trace-store";

import { executionSelection, repairSelection } from "../executor-selection";
import { DEFAULT_STALE_MS } from "../interrupted";
import { runWithProcessSupervision, supervisedExecFile } from "../process-supervision";
import { withRepositoryLease } from "../repo-lock";
import { createRunAbort, disposeRunAbort } from "../run-abort-registry";
import {
  claimRunOperation,
  isVerifiedRunTakeover,
  releaseRunOperationWithRetry,
  updateRunForOperation
} from "../run-operation-lease";
import { startHeartbeat } from "../runner-heartbeat";
import { markRunnerInactive, startRunBackgroundTask, tryMarkRunnerActive } from "../runner-state";
import { resolveRunsDirectory } from "../runs-directory";
import type { RunOperationLease, RunRecord } from "../schema";
import { resolveRunTargetPath } from "../target-context";
import { projectV2RunRecordCache } from "./run-record-cache";

export interface ApprovedExecutionPlanV2 {
  graph: GraphRevision;
  contracts: TaskContractBundle[];
  repositorySnapshot: RepositorySnapshot;
  state: RunProjection;
}

export function loadApprovedExecutionPlanV2(events: readonly RunEvent[]): ApprovedExecutionPlanV2 {
  const state = foldRun(events);
  if (state.graphId === undefined || state.graphRevision === undefined || state.approvedGraphRevision !== state.graphRevision) {
    throw new Error("V2 execution requires the exact current graph revision to be approved.");
  }
  const compiled = [...events].reverse().find((event) =>
    event.type === "graph.compiled" &&
    event.payload.graphId === state.graphId &&
    event.payload.revision === state.approvedGraphRevision
  );
  if (compiled?.type !== "graph.compiled") throw new Error(`Approved graph ${state.graphId}@${state.approvedGraphRevision} has no compiled event.`);
  const inspected = [...events].reverse().find((event) => event.type === "repository.inspected");
  if (inspected?.type !== "repository.inspected") throw new Error("V2 execution requires the immutable repository snapshot from planning.");
  const graph = GraphRevisionSchema.parse(compiled.payload.graph);
  const contracts = compiled.payload.contracts.map((contract) => TaskContractBundleSchema.parse(contract));
  const repositorySnapshot = RepositorySnapshotSchema.parse(inspected.payload.snapshot) as RepositorySnapshot;
  if (graph.repositorySnapshotId !== repositorySnapshot.snapshotId) {
    throw new Error(`Graph repository snapshot ${graph.repositorySnapshotId} does not match ${repositorySnapshot.snapshotId}.`);
  }
  return { graph, contracts, repositorySnapshot, state };
}

/** Productive V2 execution path: canonical events -> V2 scheduler -> physical executor -> exact evidence. */
export async function runExecutionV2Pipeline(runId: string): Promise<void> {
  await driveClaimedExecutionV2(await claimExecutionV2(runId));
}

/** Re-enters the scheduler after a decision while canonical readiness is still parked. */
export async function runDecisionContinuationV2Pipeline(runId: string): Promise<void> {
  await driveClaimedExecutionV2(await claimExecutionV2(runId, ["running", "waiting_for_input"]));
}

/** Claims execution synchronously so duplicate HTTP starts receive a deterministic conflict. */
export async function startExecutionV2Pipeline(runId: string, label = "execution-v2"): Promise<RunRecord> {
  const claimed = await claimExecutionV2(runId);
  startRunBackgroundTask(runId, label, () => driveClaimedExecutionV2(claimed));
  return claimed.run;
}

export async function startDecisionContinuationV2Pipeline(
  runId: string,
  label = "decision-continuation-v2"
): Promise<RunRecord> {
  const claimed = await claimExecutionV2(runId, ["running", "waiting_for_input"]);
  startRunBackgroundTask(runId, label, () => driveClaimedExecutionV2(claimed));
  return claimed.run;
}

function claimExecutionV2(
  runId: string,
  expectedLifecycles: readonly RunLifecycle[] = ["running"]
): Promise<{ run: RunRecord; lease: RunOperationLease }> {
  return claimRunOperation(runId, "execution", {
    expectedLifecycles,
    allowTakeover: true,
    takeoverStaleAfterMs: DEFAULT_STALE_MS
  });
}

async function driveClaimedExecutionV2(claimed: { run: RunRecord; lease: RunOperationLease }): Promise<void> {
  const { run, lease } = claimed;
  const runId = run.runId;
  const verifiedTakeover = isVerifiedRunTakeover(run, lease);
  if (!tryMarkRunnerActive(runId, lease.operationId, verifiedTakeover)) {
    await releaseRunOperationWithRetry(runId, lease);
    throw new Error(`Run ${runId} already has an active runner.`);
  }
  const stopHeartbeat = startHeartbeat(runId, lease);
  const abort = createRunAbort(runId, lease.operationId);
  try {
    const repoRoot = await resolveRunTargetPath(run);
    if (repoRoot === undefined || run.targetContext === undefined) {
      throw new Error("Execution V2 requires the captured local Git target.");
    }
    const directory = resolveRunsDirectory();
    const integrationJournal = new JsonIntegrationOperationJournal(join(directory, "integration-operations"));
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const authority = { operationId: lease.operationId, fencingToken: lease.fencingToken };
    const recovery = await verifyAndRecoverRunStore(runId, { store: events });
    if (recovery.status === "corrupt") throw new Error(`Run ${runId} has a corrupt durable event store.`);
    const loaded = await events.load(runId);
    const prepared = loadApprovedExecutionPlanV2(loaded);
    const policyConfig = prepared.state.granularityStrategy?.config;
    const granularityPolicy: GranularityPolicyManifest | undefined =
      policyConfig?.maxLeafPlannedPaths === undefined
        ? undefined
        : {
            policyVersion: prepared.state.granularityStrategy!.policyVersion,
            minimumAdvantage: policyConfig.minimumAdvantage,
            maxLeafContextTokens: policyConfig.maxLeafContextTokens,
            maxLeafScopePaths: policyConfig.maxLeafScopePaths,
            maxLeafPlannedPaths: policyConfig.maxLeafPlannedPaths
          };
    const execution = executionSelection(run);
    const repair = repairSelection(run);
    const config = ExecutionConfigSchema.parse(run.executionConfig ?? {});
    const executorReady = await executorAvailability(execution.executorId);
    const git = new SimpleGitRunner();
    await git.revParse(repoRoot, `${prepared.graph.baseCommit}^{commit}`);
    const worktrees = new WorktreeManager({ git, repoRoot });
    const worktreePool = new WorktreePool({
      repoRoot,
      size: config.maxParallel
    });
    const baseBuilder = new ExecutionBaseBuilder({
      git,
      workspaceProvider: new PooledExecutionWorkspaceProvider({ pool: worktreePool })
    });
    const traceStore = new JsonlTraceStore({ runId, directory });
    const nodeExecutor = new V2NodeExecutor({
      git,
      repoRoot,
      worktrees,
      baseBuilder,
      traceStore,
      executorFactory: new DefaultAgentExecutorFactory(),
      validator: new ExactCandidateValidatorV2({
        git,
        worktrees,
        repoRoot,
        repositorySnapshot: prepared.repositorySnapshot,
        operationId: lease.operationId
      }),
      finalCandidate: finalCandidatePort({ git, repoRoot, baseCommit: prepared.graph.baseCommit }),
      integrationOperation: {
        journal: integrationJournal,
        runId,
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        allowTakeover: verifiedTakeover
      }
    });
    const coordinator = new RunCoordinator({
      events: events.bind(authority),
      delivery: { publish: async () => { throw new Error("Delivery is not available from the execution pipeline."); } },
      clock: () => new Date().toISOString(),
      eventId: (type, sequence) => `${runId}:${type}:${sequence}`
    });
    let executionSignal = abort.signal;
    const driver = new V2ExecutionDriver({
      coordinator,
      now: () => new Date().toISOString(),
      loadCurrentInputs: async () => {
        const current = loadApprovedExecutionPlanV2(await events.load(runId));
        return {
          graph: current.graph,
          contracts: current.contracts,
          repositoryContextDigest: current.repositorySnapshot.snapshotId,
          executorProfile: { id: execution.executorId, revision: executorProfileRevision(execution) },
          materializableNodeIds: materializableNodeIds(current.graph, current.contracts),
          availableExecutorNodeIds: executorReady ? Object.keys(current.graph.nodes) : [],
          evaluatedAt: new Date().toISOString(),
          conflictConstraints: conflictEvidence(current.graph)
        };
      },
      execute: async (input): Promise<V2NodeExecutionOutcome> => nodeExecutor.execute({
        ...input,
        selection: execution,
        repairSelection: repair,
        config,
        target: {
          sourceTargetFingerprint: run.targetContext!.fingerprint,
          targetBranch: run.targetContext!.sourceBranch,
          targetHead: run.targetContext!.sourceBaseCommit
        },
        signal: executionSignal
      })
    });
    const state = await withRepositoryLease({ repoRoot, runId }, async (_repositoryLease, repositorySignal) => {
      await events.assertAuthority(runId, authority);
      executionSignal = AbortSignal.any([abort.signal, repositorySignal]);
      return runWithProcessSupervision({
        runId,
        operationId: lease.operationId,
        label: "execution-v2",
        signal: executionSignal
      }, () => driver.run({
          runId,
          graph: prepared.graph,
          contracts: prepared.contracts,
          repositoryContextDigest: prepared.repositorySnapshot.snapshotId,
          executorProfile: { id: execution.executorId, revision: executorProfileRevision(execution) },
          effectiveConfig: {
            maxParallel: config.maxParallel,
            ...(config.maxTokensTotal !== undefined ? { maxTokensTotal: config.maxTokensTotal } : {}),
            ...(config.maxCostUsd !== undefined ? { maxCostUsd: config.maxCostUsd } : {})
          },
          materializableNodeIds: materializableNodeIds(prepared.graph, prepared.contracts),
          availableExecutorNodeIds: executorReady ? Object.keys(prepared.graph.nodes) : [],
          evaluatedAt: new Date().toISOString(),
          conflictConstraints: conflictEvidence(prepared.graph),
          ...(granularityPolicy === undefined ? {} : { granularityPolicy }),
          target: {
            sourceTargetFingerprint: run.targetContext!.fingerprint,
            targetBranch: run.targetContext!.sourceBranch,
            targetHead: run.targetContext!.sourceBaseCommit
          }
        }));
    });
    const persistedEvents = await events.load(runId);
    await snapshots.write(runId, authority, state, state.sequence, persistedEvents.at(-1)!.eventId);
    await new EventStoreCompactor(events).compactIfNeeded(runId, authority);
    await updateRunForOperation(runId, lease, (current) => projectV2RunRecordCache(current, state, persistedEvents));
  } catch (error) {
    await recordExecutionFailure(runId, lease, error).catch(() => undefined);
    throw error;
  } finally {
    disposeRunAbort(runId, lease.operationId);
    markRunnerInactive(runId, lease.operationId);
    stopHeartbeat();
    await releaseRunOperationWithRetry(runId, lease);
  }
}

function conflictEvidence(graph: GraphRevision): ConflictConstraintEvidence[] {
  return graph.conflictConstraints.map((constraint) => createConflictConstraintEvidence({
    id: constraint.id,
    leftNodeId: constraint.leftNodeId,
    rightNodeId: constraint.rightNodeId,
    reason: constraint.reason,
    risk: constraint.risk,
    ...(constraint.mode !== undefined ? { mode: constraint.mode } : {}),
    ...(constraint.resourceId !== undefined ? { resourceId: constraint.resourceId } : {}),
    signals: [{ type: "compiled_scope_overlap", detail: constraint.reason, sourceRef: constraint.id }],
    confidence: 1,
    observedAt: graph.createdAt
  }));
}

function materializableNodeIds(graph: GraphRevision, contracts: TaskContractBundle[]): string[] {
  const contractByNodeId = new Map(contracts.map((bundle) => [bundle.task.nodeId, bundle]));
  return Object.values(graph.nodes)
    .filter((node) => contractByNodeId.get(node.id)?.artifacts.some((artifact) => artifact.producerNodeId === node.id) === true)
    .map((node) => node.id);
}

async function executorAvailability(executorId: string): Promise<boolean> {
  const descriptor = getExecutorDescriptor(executorId as Parameters<typeof getExecutorDescriptor>[0]);
  if (!descriptor.enabled) return false;
  const configured = process.env[descriptor.binaryEnvVar] ?? descriptor.defaultBinary;
  const resolved = resolveCliBinaryPath(configured);
  return existsSync(resolved);
}

function finalCandidatePort(input: { git: SimpleGitRunner; repoRoot: string; baseCommit: string }): V2FinalCandidatePort {
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
        clock: () => new Date().toISOString(),
        validate: async ({ candidateCommit }) => ({
          matrixId: request.evidenceMatrix.matrixId,
          candidateCommit,
          eligible: request.evidenceMatrix.outcome === "verified" && request.evidenceMatrix.candidateCommit === candidateCommit
        }),
        prepare: async ({ runId, integratedCommit }) => {
          await input.git.revParse(input.repoRoot, `${integratedCommit}^{commit}`);
          const candidateRef = `manyhands/run-${slug(runId)}`;
          await supervisedExecFile("git", safeGitArgs(input.repoRoot, ["branch", "-f", candidateRef, integratedCommit]), {
            cwd: input.repoRoot,
            windowsHide: true
          });
          return {
            candidateCommit: integratedCommit,
            candidateRef,
            changedFiles: await input.git.diffRangeNameOnly({ cwd: input.repoRoot, from: input.baseCommit, to: integratedCommit })
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
      const treeSha = await input.git.revParse(input.repoRoot, `${prepared.candidateCommit}^{tree}`);
      const finalManifest = {
        commitSha: prepared.candidateCommit,
        treeSha,
        graphRevision: request.graphRevision,
        artifactIds: [...request.artifactIds].sort(),
        evidenceMatrixId: prepared.evidenceMatrixId,
        validationRecipeDigest: request.validationRecipeDigest,
        deliveryTarget: request.targetBranch,
        ...(request.granularityPolicy === undefined ? {} : { granularityPolicy: request.granularityPolicy })
      };
      return { manifestId, finalManifest };
    }
  };
}

async function recordExecutionFailure(runId: string, lease: RunOperationLease, error: unknown): Promise<void> {
  const events = new JsonlRunEventStore({ directory: resolveRunsDirectory() });
  const authority = { operationId: lease.operationId, fencingToken: lease.fencingToken };
  await events.advanceFence(runId, authority);
  const current = await events.load(runId);
  const reason = error instanceof Error ? error.message : String(error);
  await events.appendFenced(runId, current.length, authority, [{
    eventId: `execution:${runId}:failed:${current.length + 1}`,
    occurredAt: new Date().toISOString(),
    type: "run.failed",
    payload: { reason, area: "execution" }
  }]);
  const persisted = await events.load(runId);
  const state = foldRun(persisted);
  await updateRunForOperation(runId, lease, (run) => projectV2RunRecordCache(run, state, persisted));
}

function executorProfileRevision(selection: { executorId: string; model: string; effort?: string }): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || "run";
}
