import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ArtifactContract,
  ArtifactManifest,
  CanonicalValidationObligation,
  CandidateTreeManifest,
  EvidenceBinding,
  GoalContract,
  ProofStrategy,
  TaskContractBundle
} from "@manyhands/contracts";
import type { CriterionEvidenceObservation, GranularityPolicyManifest } from "@manyhands/shared";
import type { CanonicalTaskNode, GraphRevision } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import { ExecutionBaseBuilder, type BuiltExecutionBase } from "../base/execution-base-builder";
import type { FinalArtifactManifest } from "../delivery/candidate-preparer";
import { AGENT_STATUS_PROTOCOL_INSTRUCTIONS } from "../executor/status-channel";
import type { AgentExecutorFactory } from "../executor/factory";
import type { StageSelection } from "../executor/registry";
import { usageSourceForSelection } from "../executor/registry";
import type { GitRunner } from "../git/runner";
import { GitArtifactBuilder } from "../git/artifact-builder";
import { bindExactEvidence } from "../validation/exact-evidence-binding";
import {
  createIntegrationRequestManifest,
  IntegrationManifestExecutor,
  type IntegrationChildArtifact,
  type IntegrationManifest
} from "../integration/manifest";
import type { IntegrationOperationJournal } from "../integration/operation-journal";
import { ResultRecorder } from "../result/recorder";
import type { ExecutionConfig, WorktreeRecord } from "../types";
import type { PreparedValidationRecipe, UnmaterializedObligation } from "../validation/recipe-compiler";
import { WorktreeManager } from "../worktree/manager";
import type { DeclaredCredential, SandboxProfile, SandboxProvider, SandboxSession } from "../sandbox/types";

export interface V2ExecutionArtifact {
  artifactId: string;
  runId: string;
  nodeId: string;
  digest: string;
  producerAttemptId: string;
  contract: { id: string; revision: string };
  kind: "commit" | "files" | "manifest" | "logical";
  location: string;
  manifest?: ArtifactManifest | undefined;
  cherryPickMainline?: 1 | undefined;
  adoptedAt: string;
}

export interface V2ExecutionEvidenceMatrix {
  matrixId: string;
  candidateCommit: string;
  validationContract: { id: string; revision: string };
  criteria: Array<{
    criterionId: string;
    obligationId: string;
    status: "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";
    justification: string;
    evidenceRefs: string[];
  }>;
  outcome: "verified" | "unverified" | "failed";
  validationRecipeDigest?: string;
  evidenceBindings: EvidenceBinding[];
  observations: CriterionEvidenceObservation[];
  integrityFindings?: Array<{
    findingId: string;
    code: "test_removed" | "test_script_weakened" | "test_configuration_changed" | "test_skipped" | "test_only" | "assertion_removed" | "required_public_surface_unchanged" | "required_public_surface_unrepresented";
    path: string;
    message: string;
    disposition?: "blocking" | "rebutted";
    rebuttalEvidenceRefs?: string[];
  }>;
  negativeControls?: Array<{
    evidenceId: string;
    obligationId: string;
    detectedFailure: boolean;
    outputDigest: string;
  }>;
}

export interface V2NodeValidationPort {
  /** Prepare the immutable command program before any agent is created. */
  prepare?(input: { contract: TaskContractBundle }): PreparedValidationRecipe;
  validate(input: {
    runId: string;
    attemptId: string;
    contract: TaskContractBundle;
    prepared?: PreparedValidationRecipe;
    candidateCommit: string;
    baselineCommit: string;
    signal?: AbortSignal;
  }): Promise<V2ExecutionEvidenceMatrix>;
}

export interface V2FailureCause {
  source: "artifact" | "executor" | "scope" | "integration";
  code: string;
  artifactId?: string;
  producerNodeId?: string;
}

export interface V2FinalCandidatePort {
  prepare(input: {
    runId: string;
    attemptId: string;
    candidateCommit: string;
    evidenceMatrix: V2ExecutionEvidenceMatrix;
    sourceTargetFingerprint: string;
    targetBranch: string;
    targetHead: string;
    graphRevision: number;
    artifactIds: string[];
    validationRecipeDigest: string;
    granularityPolicy?: GranularityPolicyManifest;
  }): Promise<{ manifestId: string; finalManifest: FinalArtifactManifest }>;
}

export interface V2PhysicalNodeExecutionInput {
  runId: string;
  attemptId: string;
  inputFingerprint: string;
  priorFailure?: { attemptId: string; reason: string; checkpointCommit?: string; guidance?: string };
  graph: ExecutionGraphContext;
  node: ExecutionGraphNode;
  contract: TaskContractBundle;
  consumedArtifacts: V2ExecutionArtifact[];
  outputArtifactContract: ArtifactContract;
  selection: StageSelection;
  repairSelection: StageSelection;
  config: ExecutionConfig;
  target: { sourceTargetFingerprint: string; targetBranch: string; targetHead: string };
  granularityPolicy?: GranularityPolicyManifest;
  signal?: AbortSignal;
}

/** Minimal immutable graph context consumed by the transitional executor. */
export interface ExecutionGraphContext {
  graphId: string;
  revision: number;
  rootId: string;
  baseCommit: string;
  nodes: Record<string, ExecutionGraphNode>;
}

export interface ExecutionGraphNode {
  id: string;
  parentId: string | null;
  kind: "root" | "composite" | "leaf" | "integrator";
  title: string;
}

/** What one attempt consumed, as the executor reported it. */
export interface V2AttemptUsage {
  tokensIn?: number;
  tokensOut?: number;
  /** Providers that report only a total keep it here, never split. */
  tokensTotal?: number;
  costUsd?: number;
  source: "reported" | "estimated" | "unavailable";
}

export type V2PhysicalNodeExecutionOutcome =
  | {
      kind: "success";
      usage?: V2AttemptUsage;
      candidateCommit: string;
      outputDigest: string;
      changedFiles: string[];
      evidenceMatrix: V2ExecutionEvidenceMatrix;
      artifactBaseCommit?: string;
      artifactLocation: string;
      artifactCherryPickMainline?: 1;
      integrationManifestId?: string;
      repairObservations?: Array<{ kind: "code" | "integration"; pass: number; evidenceRefs: string[] }>;
      finalManifestId?: string;
      finalManifest?: FinalArtifactManifest;
    }
  | {
      kind: "needs_input";
      reason: string;
      unmaterializedObligationIds: string[];
      /** Why each obligation produced no command, so the operator sees the remedy. */
      unmaterialized: UnmaterializedObligation[];
    }
  | {
      kind: "failure";
      reason: string;
      usage?: V2AttemptUsage;
      integrationManifestId?: string;
      candidateCommit?: string;
      evidenceMatrix?: V2ExecutionEvidenceMatrix;
      failureCause?: V2FailureCause;
      checkpoint?: {
        candidateCommit: string;
        outputDigest: string;
        changedFiles: string[];
      };
      repairObservations?: Array<{ kind: "code" | "integration"; pass: number; evidenceRefs: string[] }>;
    };

export interface V2NodeExecutorOptions {
  git: GitRunner;
  repoRoot: string;
  traceStore: TraceStore;
  executorFactory: AgentExecutorFactory;
  validator: V2NodeValidationPort;
  finalCandidate?: V2FinalCandidatePort;
  worktrees?: WorktreeManager;
  baseBuilder?: ExecutionBaseBuilder;
  recorder?: ResultRecorder;
  writeInstructions?(path: string, content: string): Promise<void>;
  now?(): string;
  artifactBuilder?: Pick<GitArtifactBuilder, "build" | "buildCandidateTree">;
  evidenceAuthority?: {
    goal: GoalContract;
    validationObligations: Readonly<Record<string, CanonicalValidationObligation>>;
    proofStrategies: Readonly<Record<string, ProofStrategy>>;
  };
  integrationOperation?: {
    journal: IntegrationOperationJournal;
    runId: string;
    operationId?: string;
    fencingToken?: number;
    allowTakeover?: boolean;
  };
  /** Historical V2 replay may inspect commits; canonical daemon work may not transport them. */
  allowCommitArtifactTransport?: boolean;
  /** Canonical Stage 8 records validation repair as a new durable attempt. */
  deferValidationRepair?: boolean;
  /** Stage 8 injects an explicit capability-checked session. */
  sandbox?: {
    provider: SandboxProvider;
    profile: SandboxProfile;
    credentials: readonly DeclaredCredential[];
    credentialScopeId?: string;
    /** An explicit native Codex Windows mode; default executor behavior remains elevated. */
    windowsSandbox?: "elevated" | "unelevated";
  };
}

/** Executes one V2 node without translating its bundle back to AgentTaskContract. */
export class V2NodeExecutor {
  private readonly worktrees: WorktreeManager;
  private readonly baseBuilder: ExecutionBaseBuilder;
  private readonly recorder: ResultRecorder;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;
  private readonly now: () => string;

  constructor(private readonly options: V2NodeExecutorOptions) {
    this.worktrees = options.worktrees ?? new WorktreeManager({ git: options.git, repoRoot: options.repoRoot });
    this.baseBuilder = options.baseBuilder ?? new ExecutionBaseBuilder({ git: options.git, worktreeManager: this.worktrees });
    this.recorder = options.recorder ?? new ResultRecorder({ git: options.git, traceStore: options.traceStore });
    this.writeInstructions = options.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(input: V2PhysicalNodeExecutionInput): Promise<V2PhysicalNodeExecutionOutcome> {
    try {
      if (this.options.allowCommitArtifactTransport === false && input.consumedArtifacts.some((artifact) => artifact.kind === "commit")) {
        return { kind: "failure", reason: "Commit artifacts are not accepted by the canonical execution route." };
      }
      const prepared = this.options.validator.prepare?.({ contract: input.contract });
      const unmaterialized = requiredUnmaterializedObligations(input.contract, prepared);
      if (unmaterialized.length > 0) {
        return {
          kind: "needs_input",
          reason: `Required validation obligations cannot be materialized: ${unmaterialized.map(({ obligationId }) => obligationId).join(", ")}.`,
          unmaterializedObligationIds: unmaterialized.map(({ obligationId }) => obligationId),
          unmaterialized
        };
      }
      const hasChildren = Object.values(input.graph.nodes).some((node) => node.parentId === input.node.id);
      return await (
        (input.node.kind === "root" || input.node.kind === "composite" || input.node.kind === "integrator") && hasChildren
          ? this.executeComposite(input, prepared)
          : this.executeLeaf(input, prepared)
      );
    } catch (error) {
      const failureCause = failureCauseFor(input, error);
      return { kind: "failure", reason: describe(error), ...(failureCause === undefined ? {} : { failureCause }) };
    }
  }

  private async executeLeaf(input: V2PhysicalNodeExecutionInput, prepared?: PreparedValidationRecipe): Promise<V2PhysicalNodeExecutionOutcome> {
    let base: BuiltExecutionBase;
    try {
      base = await this.baseBuilder.build({
        runId: input.runId,
        nodeId: input.node.id,
        baseCommit: input.graph.baseCommit,
        contractBaseline: { id: input.contract.task.id, revision: input.contract.task.revision },
        artifacts: input.consumedArtifacts.map(executionArtifactInput),
        inputFingerprint: input.inputFingerprint
      });
    } catch (error) {
      const failureCause = failureCauseFor(input, error);
      return { kind: "failure", reason: describe(error), ...(failureCause === undefined ? {} : { failureCause }) };
    }
    const instructionPath = instructionFilePath(input, "execute");
    let candidateToAnchor: string | undefined;
    let sandboxSession: SandboxSession | undefined;
    let executionWorktree = base.worktree;
    let restoredCheckpointCommit: string | undefined;
    try {
      if (input.priorFailure?.checkpointCommit !== undefined) {
        const checkpoint = await this.options.git.cherryPick({
          cwd: executionWorktree.path,
          commitSha: input.priorFailure.checkpointCommit,
          mainline: 1
        });
        if (!checkpoint.ok) {
          if (await this.options.git.cherryPickHead(executionWorktree.path) !== undefined) {
            await this.options.git.cherryPickAbort(executionWorktree.path);
          }
          throw new Error(`Retry checkpoint ${input.priorFailure.checkpointCommit} could not be materialized: ${checkpoint.output}`);
        }
        restoredCheckpointCommit = await this.options.git.head(executionWorktree.path);
        executionWorktree = {
          ...executionWorktree,
          baseCommit: restoredCheckpointCommit
        };
      }
      if (this.options.sandbox !== undefined) {
        sandboxSession = await this.options.sandbox.provider.create({
          attemptId: input.attemptId,
          ...(this.options.sandbox.credentialScopeId === undefined
            ? {}
            : { credentialScopeId: this.options.sandbox.credentialScopeId }),
          workspacePath: executionWorktree.path,
          profile: this.options.sandbox.profile,
          credentials: this.options.sandbox.credentials
        });
      }
      await this.writeInstructions(instructionPath, buildV2NodeInstructions(input, prepared));
      const executor = this.options.executorFactory.create(input.selection);
      const executorOutcome = await executor.execute({
        cwd: executionWorktree.path,
        instructionFilePath: instructionPath,
        model: input.selection.model,
        timeoutMs: input.config.leafTimeoutMs,
        bypassApprovals: sandboxSession === undefined,
        ...(sandboxSession === undefined ? {} : {
          env: { ...sandboxSession.environment },
          isolatedEnvironment: true,
          ...(this.options.sandbox?.windowsSandbox === undefined
            ? {}
            : { windowsSandbox: this.options.sandbox.windowsSandbox })
        }),
        processOwnerId: input.runId,
        attemptId: stableUuid(input.attemptId),
        ...(input.selection.effort !== undefined ? { reasoningEffort: input.selection.effort } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        onOutput: (chunk) => this.options.traceStore.append({ type: "executor_output", actor: "agent", taskId: input.node.id, payload: chunk }),
        onAgentStatus: (status) => this.options.traceStore.append({ type: "agent_status", actor: "agent", taskId: input.node.id, payload: { ...status } })
      });
      const result = await this.recorder.record({
        worktree: executionWorktree,
        executorOutcome,
        scopeContract: input.contract.scope,
        scopePolicy: input.config.scopePolicy,
        unexpectedCommitPolicy: input.config.unexpectedCommitPolicy,
        commitMessage: executorOutcome.timedOut
          ? `mh-v2-checkpoint: ${input.node.id}`
          : `mh-v2: ${input.node.id}`,
        usageSource: usageSourceForSelection(input.selection)
      });
      if (result.status !== "success") {
        if (result.status === "timeout" && result.commitSha !== undefined) {
          const checkpointCommit = await this.options.git.createIntegrationHandoff({
            cwd: executionWorktree.path,
            baseCommit: base.manifest.resultingCommit,
            message: `mh-v2-checkpoint-handoff: ${input.node.id}`,
            appliedCommitShas: [
              ...(restoredCheckpointCommit === undefined ? [] : [restoredCheckpointCommit]),
              result.commitSha
            ]
          });
          const changedFiles = await this.options.git.diffRangeNameOnly({
            cwd: executionWorktree.path,
            from: base.manifest.resultingCommit,
            to: checkpointCommit
          });
          candidateToAnchor = checkpointCommit;
          return {
            kind: "failure",
            reason: executionFailureReason(result),
            usage: usageOf(result),
            checkpoint: {
              candidateCommit: checkpointCommit,
              outputDigest: digest(checkpointCommit),
              changedFiles
            }
          };
        }
        // An empty diff is not automatically a failed leaf. A sibling whose
        // declared scope overlaps this one can legitimately have implemented
        // the work already, leaving this agent nothing to do. Rather than guess
        // from paths -- the existing heuristic needs expected outputs this path
        // never carries -- let the system's own verification decide: revalidate
        // the baseline, and accept the no-op only if the contract really is
        // satisfied. An agent that simply skipped its work still fails.
        // ...but only when there is prior work that could have done it. A leaf
        // whose worktree still sits on the run's own base commit has no sibling
        // ahead of it, so nothing in this run can have satisfied its contract.
        // Revalidating there asks the target's suite whether it was green
        // before the run started, and on any well-formed target it was — which
        // is how a leaf that spent 184k tokens and changed nothing came back
        // `verified`, with its empty artifact adopted (SP2 rehearsal, run
        // 1bb2b66b). Whole-suite validation cannot tell "already satisfied"
        // apart from "untouched", so the question is only worth asking when the
        // baseline has actually moved.
        if (result.status === "empty_diff" && result.currentHead !== input.graph.baseCommit) {
          const baselineMatrix = await this.options.validator.validate({
            runId: input.runId,
            attemptId: input.attemptId,
            contract: input.contract,
            ...(prepared === undefined ? {} : { prepared }),
            candidateCommit: result.currentHead,
            baselineCommit: input.graph.baseCommit,
            ...(input.signal !== undefined ? { signal: input.signal } : {})
          });
          if (baselineMatrix.outcome === "verified") {
            return {
              ...successOutcome(result.currentHead, [], baselineMatrix),
              usage: usageOf(result)
            };
          }
        }
        return { kind: "failure", reason: executionFailureReason(result), usage: usageOf(result) };
      }
      const missingArtifactPaths = missingExpectedArtifactPaths(
        input.outputArtifactContract.expectedPaths,
        result.changedFiles,
        result.noOp === true ? result.baselineEvidence?.verifiedPaths : undefined
      );
      if (missingArtifactPaths.length > 0) {
        return {
          kind: "failure",
          reason: `Candidate omitted declared artifact paths: ${missingArtifactPaths.join(", ")}.`,
          usage: usageOf(result)
        };
      }
      const candidateCommit = result.commitSha ?? result.currentHead;
      candidateToAnchor = candidateCommit;
      const evidenceMatrix = await this.options.validator.validate({
        runId: input.runId,
        attemptId: input.attemptId,
        contract: input.contract,
        ...(prepared === undefined ? {} : { prepared }),
        candidateCommit,
        baselineCommit: input.graph.baseCommit,
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      let success: Extract<V2PhysicalNodeExecutionOutcome, { kind: "success" }> =
        { ...successOutcome(candidateCommit, result.changedFiles, evidenceMatrix), usage: usageOf(result) };
      if (evidenceMatrix.outcome === "failed") {
        if (this.options.deferValidationRepair === true) {
          return {
            kind: "failure",
            reason: validationFailureReason(candidateCommit, evidenceMatrix),
            usage: usageOf(result)
          };
        }
        const repaired = await this.repairLeaf(
          input,
          executionWorktree,
          candidateCommit,
          evidenceMatrix,
          prepared,
          sandboxSession?.environment
        );
        if (repaired.kind === "failure") return repaired;
        success = repaired;
        candidateToAnchor = repaired.candidateCommit;
      }
      success = { ...success, artifactBaseCommit: base.manifest.resultingCommit };
      if (input.node.id !== input.graph.rootId || success.evidenceMatrix.outcome !== "verified") return success;
      if (this.options.finalCandidate === undefined) {
        return { kind: "failure", reason: "Root execution has no final-candidate preparer." };
      }
      const finalManifest = await this.options.finalCandidate.prepare({
        runId: input.runId,
        attemptId: input.attemptId,
        candidateCommit: success.candidateCommit,
        evidenceMatrix: success.evidenceMatrix,
        ...input.target,
        graphRevision: input.graph.revision,
        artifactIds: input.contract.task.produces.map(({ id }) => id),
        validationRecipeDigest: requiredValidationRecipeDigest(success.evidenceMatrix),
        ...(input.granularityPolicy === undefined ? {} : { granularityPolicy: input.granularityPolicy })
      });
      return {
        ...success,
        finalManifestId: finalManifest.manifestId,
        finalManifest: finalManifest.finalManifest
      };
    } catch (error) {
      return { kind: "failure", reason: describe(error) };
    } finally {
      await rm(instructionPath, { force: true }).catch(() => undefined);
      await sandboxSession?.dispose();
      await this.releaseExecutionBase(base, input, candidateToAnchor);
    }
  }

  private async executeComposite(input: V2PhysicalNodeExecutionInput, prepared?: PreparedValidationRecipe): Promise<V2PhysicalNodeExecutionOutcome> {
    let base: BuiltExecutionBase;
    try {
      base = await this.baseBuilder.build({
        runId: input.runId,
        nodeId: input.node.id,
        baseCommit: input.graph.baseCommit,
        contractBaseline: { id: input.contract.task.id, revision: input.contract.task.revision },
        artifacts: [],
        inputFingerprint: input.inputFingerprint
      });
    } catch (error) {
      return { kind: "failure", reason: describe(error) };
    }

    let candidateToAnchor: string | undefined;
    let repairCheckpoint: Extract<V2PhysicalNodeExecutionOutcome, { kind: "failure" }>["checkpoint"];
    try {
      const integrationTimeout = AbortSignal.timeout(input.config.integrationTimeoutMs);
      const integrationSignal = input.signal === undefined
        ? integrationTimeout
        : AbortSignal.any([input.signal, integrationTimeout]);
      const childArtifacts = input.consumedArtifacts.map(integrationArtifact);
      const request = createIntegrationRequestManifest({
        runId: input.runId,
        integrationAttemptId: input.attemptId,
        compositeNode: { id: input.node.id, graphRevision: input.graph.revision },
        base: {
          manifestId: `execution-base:${input.attemptId}`,
          resultingCommit: base.manifest.resultingCommit,
          inputFingerprint: input.inputFingerprint
        },
        availableArtifacts: childArtifacts,
        requiredArtifactIds: childArtifacts.map((artifact) => artifact.artifactId),
        seamRevisions: input.contract.seams.map(({ id, revision }) => ({ id, revision })),
        parentGoal: input.contract.task.goal,
        validationContract: { ...input.contract.task.validation },
        outputArtifactContract: {
          id: input.outputArtifactContract.id,
          revision: input.outputArtifactContract.revision
        },
        createdAt: this.now()
      });
      let evidenceMatrix: V2ExecutionEvidenceMatrix | undefined;
      const integrator = new IntegrationManifestExecutor({
        git: this.options.git,
        // The canonical route sets allowCommitArtifactTransport: false and gets
        // exact manifests only. Historical V2 replay leaves it unset and keeps
        // commit transport until Stage 11 deletes both.
        allowCommitTransport: this.options.allowCommitArtifactTransport !== false,
        validate: async ({ candidateSha }) => {
          evidenceMatrix = await this.options.validator.validate({
            runId: input.runId,
            attemptId: input.attemptId,
            contract: input.contract,
            ...(prepared === undefined ? {} : { prepared }),
            candidateCommit: candidateSha,
            baselineCommit: input.graph.baseCommit,
            ...(input.signal !== undefined ? { signal: input.signal } : {})
          });
          return {
            matrixId: evidenceMatrix.matrixId,
            outcome: evidenceMatrix.outcome,
            ...(evidenceMatrix.outcome === "verified" ? {} : {
              failedCriteria: evidenceMatrix.criteria
                .filter((criterion) => criterion.status === "failed" || criterion.status === "uncovered" || criterion.status === "flaky")
                .map((criterion) => ({
                  criterionId: criterion.criterionId,
                  obligationId: criterion.obligationId,
                  justification: criterion.justification
                }))
            })
          };
        },
        repair: async (repair) => {
          const result = await this.repairIntegration(input, base.worktree, repair, integrationSignal, prepared);
          if (result.checkpoint !== undefined) {
            repairCheckpoint = result.checkpoint;
            candidateToAnchor = result.checkpoint.candidateCommit;
          }
          return result;
        },
        digestCandidate: async ({ candidateSha }) => digest(candidateSha)
      });
      let manifest: IntegrationManifest;
      try {
        manifest = await integrator.integrate({
          request,
          worktreePath: base.worktree.path,
          signal: integrationSignal,
          ...(this.options.integrationOperation !== undefined ? { integrationOperation: this.options.integrationOperation } : {})
        });
        candidateToAnchor = manifest.candidateSha;
      } catch (error) {
        return {
          kind: "failure",
          integrationManifestId: `integration-result-${request.manifestId}`,
          ...(evidenceMatrix === undefined ? {} : { evidenceMatrix }),
          ...(repairCheckpoint === undefined ? {} : { checkpoint: repairCheckpoint }),
          reason: describe(error)
        };
      }
      const repairObservations = manifest.repairAttempt === undefined
        ? undefined
        : [{
            kind: "integration" as const,
            pass: manifest.repairAttempt.pass,
            evidenceRefs: [...manifest.repairAttempt.evidenceRefs]
          }];
      if (
        manifest.disposition !== "success" ||
        manifest.candidateSha === undefined ||
        evidenceMatrix === undefined
      ) {
        return {
          kind: "failure",
          integrationManifestId: manifest.manifestId,
          ...(manifest.candidateSha === undefined ? {} : { candidateCommit: manifest.candidateSha }),
          ...(evidenceMatrix === undefined ? {} : { evidenceMatrix }),
          ...(repairCheckpoint === undefined ? {} : { checkpoint: repairCheckpoint }),
          ...(repairObservations !== undefined ? { repairObservations } : {}),
          reason:
            manifest.errors.map((error) => error.message).join("; ") ||
            `Integration ended as ${manifest.disposition}.`
        };
      }
      const artifactBaseCommit = [...manifest.operations]
        .reverse()
        .find((operation) => operation.outcome === "applied")?.resultSha
        ?? base.manifest.resultingCommit;
      const changedFiles = await this.options.git.diffRangeNameOnly({
        cwd: base.worktree.path,
        from: artifactBaseCommit,
        to: manifest.candidateSha
      });
      let finalManifestId: string | undefined;
      let finalManifest: FinalArtifactManifest | undefined;
      if (input.node.kind === "root") {
        if (this.options.finalCandidate === undefined) {
          return {
            kind: "failure",
            integrationManifestId: manifest.manifestId,
            reason: "Root execution has no final-candidate preparer."
          };
        }
        const preparedFinal = await this.options.finalCandidate.prepare({
          runId: input.runId,
          attemptId: input.attemptId,
          candidateCommit: manifest.candidateSha,
          evidenceMatrix,
          ...input.target,
          graphRevision: input.graph.revision,
          artifactIds: input.contract.task.produces.map(({ id }) => id),
          validationRecipeDigest: requiredValidationRecipeDigest(evidenceMatrix),
          ...(input.granularityPolicy === undefined ? {} : { granularityPolicy: input.granularityPolicy })
        });
        finalManifestId = preparedFinal.manifestId;
        finalManifest = preparedFinal.finalManifest;
      }
      return {
        ...successOutcome(manifest.candidateSha, changedFiles, evidenceMatrix),
        artifactBaseCommit,
        integrationManifestId: manifest.manifestId,
        ...(repairObservations !== undefined ? { repairObservations } : {}),
        ...(finalManifestId !== undefined ? { finalManifestId } : {}),
        ...(finalManifest !== undefined ? { finalManifest } : {})
      };
    } finally {
      await this.releaseExecutionBase(base, input, candidateToAnchor);
    }
  }

  private async releaseExecutionBase(
    base: BuiltExecutionBase,
    input: V2PhysicalNodeExecutionInput,
    candidateCommit: string | undefined
  ): Promise<void> {
    try {
      await base.release?.(
        candidateCommit === undefined
          ? { kind: "discard" }
          : {
              kind: "candidate",
              runId: input.runId,
              attemptId: input.attemptId,
              candidateCommit
            }
      );
    } catch (error) {
      try {
        await this.options.traceStore.append({
          type: "worktree_clean_failed",
          actor: "system",
          taskId: input.node.id,
          payload: { message: describe(error) }
        });
      } catch {
        // The cleanup failure is non-blocking once the candidate is recorded.
      }
    }
  }

  private async repairIntegration(
    input: V2PhysicalNodeExecutionInput,
    worktree: WorktreeRecord,
    repair: {
      artifactId: string;
      conflictFiles: string[];
      conflictOutput: string;
      pass: 1;
      childArtifacts: IntegrationChildArtifact[];
      cause: "materialization_conflict" | "parent_validation_failed";
      parentValidation?: {
        matrixId: string;
        outcome: "unverified" | "failed";
        failedCriteria: Array<{ criterionId: string; obligationId: string; justification: string }>;
      };
    },
    signal: AbortSignal,
    prepared?: PreparedValidationRecipe
  ): Promise<{
    success: boolean;
    candidateSha?: string;
    evidenceRefs: string[];
    failureReason?: string;
    checkpoint?: Extract<V2PhysicalNodeExecutionOutcome, { kind: "failure" }>["checkpoint"];
  }> {
    const instructionPath = instructionFilePath(input, "repair");
    let sandboxSession: SandboxSession | undefined;
    if (await this.options.git.cherryPickHead(worktree.path) !== undefined) {
      await this.options.git.cherryPickAbort(worktree.path);
    }
    try {
      if (input.priorFailure?.checkpointCommit !== undefined) {
        const checkpoint = await this.options.git.cherryPick({
          cwd: worktree.path,
          commitSha: input.priorFailure.checkpointCommit,
          mainline: 1
        });
        if (!checkpoint.ok) {
          if (await this.options.git.cherryPickHead(worktree.path) !== undefined) {
            await this.options.git.cherryPickAbort(worktree.path);
          }
          throw new Error(`Integration checkpoint ${input.priorFailure.checkpointCommit} could not be materialized: ${checkpoint.output}`);
        }
      }
      const expectedHead = await this.options.git.head(worktree.path);
      // Historical commit transport still needs an inspectable source parent.
      // Exact manifests were already validated and materialized from declared
      // Git objects, so their sha256 identity is not a Git revision.
      for (const artifact of repair.childArtifacts) {
        if (artifact.kind === "commit") {
          await this.options.git.revParse(worktree.path, `${artifact.location}^1`);
        }
      }
      if (this.options.sandbox !== undefined) {
        sandboxSession = await this.options.sandbox.provider.create({
          attemptId: `${input.attemptId}:repair:${repair.pass}`,
          ...(this.options.sandbox.credentialScopeId === undefined
            ? {}
            : { credentialScopeId: this.options.sandbox.credentialScopeId }),
          workspacePath: worktree.path,
          profile: this.options.sandbox.profile,
          credentials: this.options.sandbox.credentials
        });
      }
      await this.writeInstructions(instructionPath, buildV2RepairInstructions(input, repair, prepared));
      const executor = this.options.executorFactory.create(input.repairSelection);
      const outcome = await executor.execute({
        cwd: worktree.path,
        instructionFilePath: instructionPath,
        model: input.repairSelection.model,
        timeoutMs: input.config.integrationTimeoutMs,
        bypassApprovals: sandboxSession === undefined,
        ...(sandboxSession === undefined ? {} : {
          env: { ...sandboxSession.environment },
          isolatedEnvironment: true,
          ...(this.options.sandbox?.windowsSandbox === undefined
            ? {}
            : { windowsSandbox: this.options.sandbox.windowsSandbox })
        }),
        processOwnerId: input.runId,
        attemptId: stableUuid(`${input.attemptId}:repair:${repair.pass}`),
        ...(input.repairSelection.effort !== undefined ? { reasoningEffort: input.repairSelection.effort } : {}),
        signal,
        onOutput: (chunk) => this.options.traceStore.append({ type: "executor_output", actor: "agent", taskId: input.node.id, payload: chunk }),
        onAgentStatus: (status) => this.options.traceStore.append({ type: "agent_status", actor: "agent", taskId: input.node.id, payload: { ...status } })
      });
      const result = await this.recorder.record({
        worktree,
        executorOutcome: outcome,
        expectedHead,
        scopeContract: input.contract.scope,
        scopePolicy: input.config.scopePolicy,
        unexpectedCommitPolicy: input.config.unexpectedCommitPolicy,
        commitMessage: outcome.timedOut
          ? `mh-v2-checkpoint: ${input.node.id}`
          : `mh-v2-repair: ${input.node.id}`,
        usageSource: usageSourceForSelection(input.repairSelection)
      });
      const evidenceRefs = [`repair:${input.attemptId}:${repair.pass}`, ...repair.conflictFiles.map((file) => `file:${file}`)];
      if (result.status !== "success" || result.commitSha === undefined) {
        if (result.status === "timeout" && result.commitSha !== undefined) {
          return {
            success: false,
            checkpoint: {
              candidateCommit: result.commitSha,
              outputDigest: digest(result.commitSha),
              changedFiles: [...result.changedFiles]
            },
            evidenceRefs,
            failureReason: executionFailureReason(result)
          };
        }
        const changedFiles = result.changedFiles.slice(0, 8);
        const violations = result.scopeCheck.violations.slice(0, 8);
        const outOfScope = result.scopeCheck.outOfScope.slice(0, 8);
        return {
          success: false,
          evidenceRefs,
          failureReason: [
            `Integration repair rejected: ${result.status}.`,
            ...(changedFiles.length === 0 ? [] : [`Changed files: ${changedFiles.join(", ")}.`]),
            ...(violations.length === 0 ? [] : [`Scope violations: ${violations.join(" | ")}.`]),
            ...(outOfScope.length === 0 ? [] : [`Out-of-scope files: ${outOfScope.join(" | ")}.`])
          ].join(" ")
        };
      }
      return { success: true, candidateSha: result.commitSha, evidenceRefs };
    } catch {
      return {
        success: false,
        failureReason: "Integration repair failed before a candidate could be recorded.",
        evidenceRefs: [
          `repair:${input.attemptId}:${repair.pass}`,
          "physical-intent:source-diff-unavailable"
        ]
      };
    } finally {
      await rm(instructionPath, { force: true }).catch(() => undefined);
      await sandboxSession?.dispose();
    }
  }

  private async repairLeaf(
    input: V2PhysicalNodeExecutionInput,
    worktree: WorktreeRecord,
    candidateCommit: string,
    failedMatrix: V2ExecutionEvidenceMatrix,
    prepared?: PreparedValidationRecipe,
    sandboxEnvironment?: Readonly<Record<string, string>>
  ): Promise<Extract<V2PhysicalNodeExecutionOutcome, { kind: "success" | "failure" }>> {
    const pass = 1;
    const evidenceRefs = [failedMatrix.matrixId, ...failedMatrix.criteria.flatMap((criterion) => criterion.evidenceRefs)];
    const repairObservation = { kind: "code" as const, pass, evidenceRefs: [...new Set(evidenceRefs)] };
    const instructionPath = instructionFilePath(input, "code-repair");
    try {
      await this.writeInstructions(instructionPath, buildV2CodeRepairInstructions(input, failedMatrix, prepared));
      const executor = this.options.executorFactory.create(input.repairSelection);
      const outcome = await executor.execute({
        cwd: worktree.path,
        instructionFilePath: instructionPath,
        model: input.repairSelection.model,
        timeoutMs: input.config.leafTimeoutMs,
        bypassApprovals: sandboxEnvironment === undefined,
        ...(sandboxEnvironment === undefined ? {} : {
          env: { ...sandboxEnvironment },
          isolatedEnvironment: true,
          ...(this.options.sandbox?.windowsSandbox === undefined
            ? {}
            : { windowsSandbox: this.options.sandbox.windowsSandbox })
        }),
        processOwnerId: input.runId,
        attemptId: stableUuid(`${input.attemptId}:code-repair:${pass}`),
        ...(input.repairSelection.effort !== undefined ? { reasoningEffort: input.repairSelection.effort } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      const result = await this.recorder.record({
        worktree,
        executorOutcome: outcome,
        expectedHead: candidateCommit,
        scopeContract: input.contract.scope,
        scopePolicy: input.config.scopePolicy,
        unexpectedCommitPolicy: input.config.unexpectedCommitPolicy,
        commitMessage: `mh-v2-code-repair: ${input.node.id}`,
        usageSource: usageSourceForSelection(input.repairSelection)
      });
      if (result.status !== "success") {
        return { kind: "failure", reason: `Code repair failed: ${executionFailureReason(result)}`, usage: usageOf(result), repairObservations: [repairObservation] };
      }
      const repairedCommit = result.commitSha ?? result.currentHead;
      // A repair commit is a delta on top of the first candidate. Publishing
      // only that terminal delta makes the artifact impossible to materialize
      // on a consumer's clean base. Reuse the integration handoff shape so the
      // artifact has one transportable first-parent diff while retaining the
      // complete physical repair lineage as its second parent.
      const handoffCommit = await this.options.git.createIntegrationHandoff({
        cwd: worktree.path,
        baseCommit: worktree.baseCommit,
        message: `mh-v2-leaf-handoff: ${input.node.id}`,
        appliedCommitShas: [candidateCommit, repairedCommit]
      });
      const changedFiles = await this.options.git.diffRangeNameOnly({
        cwd: worktree.path,
        from: worktree.baseCommit,
        to: handoffCommit
      });
      const missingArtifactPaths = missingExpectedArtifactPaths(
        input.outputArtifactContract.expectedPaths,
        changedFiles,
        undefined
      );
      if (missingArtifactPaths.length > 0) {
        return {
          kind: "failure",
          reason: `Repaired candidate omitted declared artifact paths: ${missingArtifactPaths.join(", ")}.`,
          usage: usageOf(result),
          repairObservations: [repairObservation]
        };
      }
      const evidenceMatrix = await this.options.validator.validate({
        runId: input.runId,
        attemptId: input.attemptId,
        contract: input.contract,
        ...(prepared === undefined ? {} : { prepared }),
        candidateCommit: handoffCommit,
        baselineCommit: input.graph.baseCommit,
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      return {
        ...successOutcome(handoffCommit, changedFiles, evidenceMatrix, 1),
        usage: usageOf(result),
        repairObservations: [repairObservation]
      };
    } catch (error) {
      return { kind: "failure", reason: `Code repair failed: ${describe(error)}`, repairObservations: [repairObservation] };
    } finally {
      await rm(instructionPath, { force: true }).catch(() => undefined);
    }
  }
}

export interface CanonicalPhysicalNodeExecutionInput extends Omit<
  V2PhysicalNodeExecutionInput,
  "graph" | "node" | "outputArtifactContract"
> {
  graph: GraphRevision;
  node: CanonicalTaskNode;
}

/**
 * Transitional adapter for the existing executor. It receives the canonical
 * graph directly and adds only the target commit required to materialize a
 * worktree; it never constructs a LegacyGraphRevisionV2 or conflict matrix.
 */
export class CanonicalNodeExecutor {
  private readonly delegate: V2NodeExecutor;
  private readonly artifactBuilder: Pick<GitArtifactBuilder, "build" | "buildCandidateTree">;

  constructor(private readonly options: V2NodeExecutorOptions) {
    this.delegate = new V2NodeExecutor({
      ...options,
      allowCommitArtifactTransport: false,
      deferValidationRepair: true
    });
    this.artifactBuilder = options.artifactBuilder ?? new GitArtifactBuilder(options.git);
  }

  async execute(input: CanonicalPhysicalNodeExecutionInput): Promise<V2PhysicalNodeExecutionOutcome & {
    artifactManifests?: Readonly<Record<string, ArtifactManifest>>;
    candidateManifest?: CandidateTreeManifest;
  }> {
    const outputArtifacts = input.contract.artifacts.filter((artifact) => artifact.producerNodeId === input.node.id);
    const outputArtifactContract = outputArtifacts[0]
      ?? {
        schemaVersion: 2 as const,
        id: `artifact:integration:${input.node.id}`,
        revision: input.contract.task.revision,
        provenance: "compiled" as const,
        producerNodeId: input.node.id,
        consumerNodeIds: [],
        artifactType: "integrated_candidate",
        materialization: "manifest" as const,
        expectedPaths: []
      };
    const outcome = await this.delegate.execute({
      ...input,
      graph: {
        graphId: input.graph.graphId,
        revision: input.graph.revision,
        rootId: input.graph.rootId,
        baseCommit: input.target.targetHead,
        nodes: input.graph.nodes
      },
      node: input.node,
      outputArtifactContract
    });
    if (outcome.kind !== "success") return outcome;
    try {
      const taskContract = input.graph.contractRefs.find((ref) =>
        ref.id === input.contract.task.id && ref.revision === Number(input.contract.task.revision)
      );
      if (taskContract === undefined) throw new Error(`Missing canonical task contract ref for ${input.node.id}.`);
      const candidateManifest = await this.artifactBuilder.buildCandidateTree({
        cwd: this.options.repoRoot,
        runId: input.runId,
        nodeId: input.node.id,
        attemptId: input.attemptId,
        contract: taskContract,
        inputFingerprint: input.inputFingerprint,
        repositoryObjectStoreId: `object-store:${input.target.sourceTargetFingerprint}`,
        baseCommit: input.target.targetHead,
        candidateCommit: outcome.candidateCommit
      });
      if (outcome.evidenceMatrix.outcome !== "verified") return { ...outcome, candidateManifest };
      const baseCommit = outcome.artifactBaseCommit;
      if (baseCommit === undefined && outputArtifacts.length > 0) {
        return {
          kind: "failure",
          reason: `Verified attempt ${input.attemptId} did not retain its materialized execution base.`,
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage })
        };
      }
      const evidenceMatrix = this.options.evidenceAuthority === undefined
        ? outcome.evidenceMatrix
        : {
            ...outcome.evidenceMatrix,
            evidenceBindings: bindExactEvidence({
              goal: this.options.evidenceAuthority.goal,
              candidate: candidateManifest,
              baseline: {
                commitOid: input.target.targetHead,
                treeOid: await this.options.git.revParse(this.options.repoRoot, `${input.target.targetHead}^{tree}`)
              },
              validationObligations: this.options.evidenceAuthority.validationObligations,
              proofStrategies: this.options.evidenceAuthority.proofStrategies,
              matrix: outcome.evidenceMatrix
            })
          };
      const manifests = await Promise.all(outputArtifacts.map(async (artifact) => {
        const contract = input.graph.contractRefs.find((ref) =>
          ref.id === artifact.id && ref.revision === Number(artifact.revision)
        );
        if (contract === undefined) throw new Error(`Missing canonical artifact contract ref for ${artifact.id}.`);
        const manifest = await this.artifactBuilder.build({
          cwd: this.options.repoRoot,
          runId: input.runId,
          nodeId: input.node.id,
          attemptId: input.attemptId,
          artifactId: artifact.id,
          contract,
          inputFingerprint: input.inputFingerprint,
          repositoryObjectStoreId: `object-store:${input.target.sourceTargetFingerprint}`,
          baseCommit: baseCommit!,
          candidateCommit: outcome.candidateCommit,
          candidateAllowedPaths: outputArtifacts.flatMap((output) => output.expectedPaths),
          allowedPaths: artifact.expectedPaths
        });
        return [artifact.id, manifest] as const;
      }));
      return { ...outcome, evidenceMatrix, candidateManifest, artifactManifests: Object.fromEntries(manifests) };
    } catch (error) {
      return {
        kind: "failure",
        reason: describe(error),
        ...(outcome.usage === undefined ? {} : { usage: outcome.usage })
      };
    }
  }
}

export function buildV2NodeInstructions(
  input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract" | "consumedArtifacts" | "priorFailure">,
  prepared?: PreparedValidationRecipe
): string {
  const { task, scope, seams } = input.contract;
  const lines = [
    `Implement: ${input.node.title}`,
    "",
    "Objective:",
    task.goal,
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- [${criterion.required ? "required" : "advisory"}] ${criterion.description}`),
    "",
    "Change only these existing paths:",
    ...scope.allowedPaths.map((path) => `- ${path}`),
    "Do not modify sibling work or dependency files outside this scope, even when the implementation appears to need them.",
    "Do not remove, weaken, skip, or reduce assertions in existing tests. Preserve their coverage; add or update tests only when the requested behavior requires it."
  ];
  if (task.sourceContract !== undefined) {
    lines.push(
      "",
      "Inherited source contract (exact; do not paraphrase):",
      `- Goal: ${task.sourceContract.goal}`,
      "- Acceptance criteria:",
      ...task.sourceContract.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
      "- Constraints:",
      ...task.sourceContract.constraints.map((constraint) => `  - ${constraint}`)
    );
  }
  if (input.priorFailure !== undefined) {
    lines.push(
      "",
      "Previous attempt failed; repair that observed failure before finishing:",
      `- Attempt: ${input.priorFailure.attemptId}`,
      `- Failure: ${input.priorFailure.reason}`,
      ...(input.priorFailure.guidance === undefined ? [] : [`- Operator guidance: ${input.priorFailure.guidance}`]),
      ...(input.priorFailure.checkpointCommit === undefined
        ? []
        : [`- Restored checkpoint: ${input.priorFailure.checkpointCommit}`, "Continue from the restored worktree; do not recreate completed work."]),
      "Do not repeat the same implementation without addressing it."
    );
  }
  // Without this the agent has no way to know that a new test file is even
  // permitted, and a correct candidate gets rejected for leaving its scope.
  if (scope.outputRoots.length > 0) {
    lines.push(
      "",
      "You may also CREATE new files, but only directly under these directories:",
      ...scope.outputRoots.map((root) => `- ${root}/`),
      "Creating a file anywhere else, or editing an existing file not listed above, fails this task."
    );
  }
  const producedArtifacts = input.contract.artifacts.filter(
    (artifact) => artifact.producerNodeId === input.node.id && artifact.expectedPaths.length > 0
  );
  if (producedArtifacts.length > 0) {
    lines.push(
      "",
      "You must produce only the following declared artifact paths:",
      ...producedArtifacts.map((artifact) => `- ${artifact.id}@${artifact.revision}: ${artifact.expectedPaths.join(", ")}`),
      "Do not create additional files under an allowed directory unless they are listed above."
    );
  }
  if (scope.forbiddenPaths.length > 0) lines.push("", "Never modify these paths:", ...scope.forbiddenPaths.map((path) => `- ${path}`));
  if (seams.length > 0) {
    lines.push("", "Shared contracts with sibling work (follow these exactly):");
    for (const seam of seams) {
      const role = seam.producerNodeId === input.node.id ? "produce" : "consume";
      lines.push(`- ${role} ${seam.kind} ${seam.id}@${seam.revision}: ${seam.specification}`);
      for (const [key, value] of Object.entries(seam.semanticFacts)) lines.push(`  - ${key}: ${value}`);
    }
  }
  lines.push(...validationProgramInstructions(prepared));
  if (input.consumedArtifacts.length > 0) {
    lines.push("", "Declared upstream artifacts already materialized in this worktree:", ...input.consumedArtifacts.map((artifact) => `- ${artifact.contract.id}@${artifact.contract.revision} (${artifact.digest})`));
  }
  if (task.constraints.length > 0) lines.push("", "Constraints:", ...task.constraints.map((constraint) => `- ${constraint}`));
  lines.push(
    "",
    "Do not redefine shared domain types or invent a competing shape in a consumer leaf. Import the existing symbols and follow the shared contracts exactly; only the contract-owning leaf may define their implementation.",
    "Treat every named interface or type schema in the objective as exact: preserve the listed field names, types, optionality, and return shape; do not rename fields or substitute a richer local shape.",
    "Literal-contract audit: copy every quoted identifier, enum literal, field name, and command from the objective and acceptance criteria verbatim; do not invent a semantically similar name or alias. Before finishing, search the changed tree for the exact literals and correct any synonym substitution.",
    "Update every existing constructor, fixture, probe, and snapshot when the requested change adds a required field; the repository must compile from the canonical shared types before tests run.",
    "Import canonical symbols across layers instead of declaring a second local shape for a domain, application, API, presentation, or probe contract.",
    "Before implementing a consumer leaf, inspect the current canonical producer implementation and its tests; do not reimplement behavior already supplied by that producer.",
    "Use the canonical producer's returned state and exported operations as the only source for shared state; never add a consumer-side exception fallback or duplicate map or store.",
    "Verify the repository using the validation command selected by the orchestrator from the frozen repository snapshot. Do not substitute a package manager, add scripts, or modify configuration to invent a command.",
    ...SANDBOX_VALIDATION_GUIDANCE,
    "",
    AGENT_STATUS_PROTOCOL_INSTRUCTIONS,
    "",
    "Do not commit. The orchestrator will inspect and commit the exact diff."
  );
  return lines.join("\n");
}

function buildV2RepairInstructions(
  input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract" | "priorFailure">,
  repair: {
    artifactId: string;
    conflictFiles: string[];
    conflictOutput: string;
    childArtifacts: IntegrationChildArtifact[];
    cause: "materialization_conflict" | "parent_validation_failed";
    parentValidation?: {
      matrixId: string;
      outcome: "unverified" | "failed";
      failedCriteria: Array<{ criterionId: string; obligationId: string; justification: string }>;
    };
  },
  prepared?: PreparedValidationRecipe
): string {
  const incomingCommit = repair.childArtifacts.find((artifact) => artifact.artifactId === repair.artifactId)?.location;
  const semanticFailure = repair.parentValidation === undefined ? [] : [
    `The exact parent candidate failed validation matrix ${repair.parentValidation.matrixId} with outcome ${repair.parentValidation.outcome}.`,
    "Repair the composed behavior, not the validation command or its configuration.",
    ...repair.parentValidation.failedCriteria.map((criterion) => `- ${criterion.criterionId}/${criterion.obligationId}: ${criterion.justification}`)
  ];
  const previousFailure = input.priorFailure === undefined ? [] : [
    "Previous integration attempt failed; address this observed cause before finishing:",
    `- Attempt: ${input.priorFailure.attemptId}`,
    `- Failure: ${input.priorFailure.reason}`,
    ...(input.priorFailure.guidance === undefined ? [] : [`- Operator guidance: ${input.priorFailure.guidance}`]),
    ""
  ];
  const creationScope = input.contract.scope.outputRoots.length === 0
    ? [
      "No additional files may be created outside those exact patterns.",
      "A listed directory path does not authorize files beneath it.",
      "This contract declares no output roots, so create only exact file paths listed above.",
      "If the only creatable path is a test file, prove the integration in that test without inventing a production module."
    ]
    : [
      "New files may be created only under these declared output roots:",
      ...input.contract.scope.outputRoots.map((outputRoot) => `- ${outputRoot}`)
    ];
  return [
    repair.cause === "parent_validation_failed"
      ? `Repair the semantically invalid integrated candidate for ${input.node.title}.`
      : `Resolve the integration conflict for ${input.node.title}.`,
    "",
    `Parent objective: ${input.contract.task.goal}`,
    `Repair cause: ${repair.cause}`,
    ...previousFailure,
    `Conflicting artifact: ${repair.artifactId}`,
    "Conflict files:",
    ...repair.conflictFiles.map((file) => `- ${file}`),
    "",
    "Change only these declared parent-scope paths:",
    ...input.contract.scope.allowedPaths.map((allowedPath) => `- ${allowedPath}`),
    ...creationScope,
    "Do not modify an upstream child artifact to make the parent integration pass; repair only the parent-owned integration surface.",
    "",
    ...semanticFailure,
    "Preserve every child intent and the shared contracts below:",
    ...input.contract.seams.map((seam) => `- ${seam.id}@${seam.revision}: ${seam.specification}`),
    ...repair.childArtifacts.map((artifact) => `- child ${artifact.nodeId}: ${artifact.contract.id}@${artifact.contract.revision} (${artifact.digest})`),
    "",
    "Child commits are transport, not a semantic proof. Inspect each incoming commit and reconcile overlapping changes against the shared contracts and exact parent objective.",
    "",
    ...(repair.cause === "materialization_conflict"
      ? [
        "The orchestrator has aborted the active cherry-pick before this repair, so the worktree is clean at the already-integrated parent state.",
        ...(incomingCommit === undefined ? [] : [`Incoming commit to apply semantically: ${incomingCommit}`]),
        "Start by inspecting the current files and the incoming commit with git show. Apply the incoming commit's intended changes while retaining the already-integrated sibling behavior."
      ]
      : [
        "The worktree is at the exact integrated candidate that failed the parent evidence matrix.",
        "Inspect the composed implementation and the failed obligations, then make the smallest semantic correction within the declared parent scope."
      ]),
    "Do not use a blanket checkout of only ours or only theirs: that would discard one child's behavior.",
    "Treat the already-integrated canonical producer behavior as authoritative when reconciling a consumer leaf.",
    "Run a literal-contract audit against the parent objective and child acceptance criteria: preserve every quoted identifier, enum literal, field name, and return shape verbatim; do not resolve a mismatch by inventing a semantically similar name or alias.",
    "For every named state that the parent objective says must be observable through a public boundary, inspect the repaired boundary source and expose that state through a named public operation (method, function, route, or getter). A response field or forwarding existing unrelated state through a generic API method does not satisfy this obligation.",
    "Do not add an exception-based fallback or duplicate state to compensate for a changed canonical API; consume its returned state and exported operations instead.",
    "The only accepted repair is a non-empty working-tree diff that applies the incoming intent while preserving the current sibling behavior.",
    "Do not report the conflict resolved from the final summary alone: inspect `git status --short` and `git diff --stat`, and keep editing until the actual diff is present.",
    "Before staging, verify the structural result: the incoming commits were inspected, the worktree contains the intended files, and no sibling contract was discarded. The parent validator will decide semantic retention on the exact candidate.",
    "Before finishing, run git diff --check and verify that no <<<<<<<, =======, or >>>>>>> conflict markers remain.",
    "The orchestrator will run the frozen validation program on the exact candidate; do not invent a build or test command in this repair.",
    ...SANDBOX_VALIDATION_GUIDANCE,
    ...validationProgramInstructions(prepared),
    "Do not create or modify AGENTS.md, CLAUDE.md, CODEX.md, or other agent-instruction files; report a durable lesson in your final summary instead.",
    "",
    "Git conflict output:",
    repair.conflictOutput,
    "",
    "Resolve the files and leave the worktree ready to commit. Do not commit; the orchestrator commits."
  ].join("\n");
}

const SANDBOX_VALIDATION_GUIDANCE = [
  "If the frozen validation command cannot start its test process because the executor sandbox reports `spawn EPERM`, report that exact infrastructure failure and stop rerunning the command.",
  "Do not change product code in response to that infrastructure failure. The orchestrator will still run the frozen validation program outside the agent sandbox on the exact candidate."
] as const;

export function buildV2CodeRepairInstructions(
  input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract">,
  failedMatrix: V2ExecutionEvidenceMatrix,
  prepared?: PreparedValidationRecipe
): string {
  const observableStateTerms = [...new Set([...input.contract.task.goal.matchAll(/\bbackorders?\b/giu)].map((match) => match[0].toLowerCase()))];
  return [
    `Repair the failed candidate for ${input.node.title}.`,
    "",
    `Objective: ${input.contract.task.goal}`,
    "The exact candidate was rejected by these validation obligations:",
    ...failedMatrix.criteria
      .filter((criterion) => criterion.status === "failed")
      .map((criterion) => `- ${criterion.criterionId}: ${criterion.justification}`),
    ...(failedMatrix.integrityFindings ?? []).map((finding) => `- ${finding.code} at ${finding.path}: ${finding.message}`),
    "",
    "Preserve the declared scope and shared contracts. Change only what is required to satisfy the failed evidence.",
    "Re-check every quoted identifier, enum literal, field name, and return shape from the objective before editing; preserve them verbatim and do not replace them with a semantically similar name or alias.",
    "For each named state that must be observable through a public boundary, add or update a named public operation whose identifier contains that state term. A generic method that returns an unrelated aggregate does not satisfy this requirement.",
    ...(observableStateTerms.length === 0 ? [] : [
      `For this repair, the public operation identifier contains ${observableStateTerms.map((term) => `"${term}"`).join(" or ")}.`,
      ...(observableStateTerms.some((term) => term === "backorder" || term === "backorders")
        ? ["For recorded backorder state, expose the exact read operation `currentBackorders()`; do not substitute an events feed or a generic current-orders read."]
        : []),
      "Required concrete change: edit the declared API source to add or update that operation, then exercise it from the focused test.",
      "Do not resolve this by adding only a test, returning the state from a mutation, or relying on an existing generic operation."
    ]),
    "Do not create or modify AGENTS.md, CLAUDE.md, CODEX.md, or other agent-instruction files; they are outside this repair scope.",
    ...validationProgramInstructions(prepared),
    "Do not commit; the orchestrator will revalidate and commit the repair."
  ].join("\n");
}

function validationProgramInstructions(prepared: PreparedValidationRecipe | undefined): string[] {
  if (prepared === undefined) return [];
  return [
    "",
    `Frozen validation program ${prepared.programId} (selected from the repository snapshot ${prepared.repositorySnapshotId}):`,
    ...prepared.steps.map((step) => `- ${step.obligationId}: cwd=${step.command.cwd} argv=${JSON.stringify([step.command.command, ...step.command.args])}`),
    "Use these commands only for repository validation. Inspection commands such as git status and rg remain allowed; do not substitute a package manager or edit scripts/configuration to make a different validation command exist."
  ];
}

function executionArtifactInput(artifact: V2ExecutionArtifact) {
  return {
    artifactId: artifact.artifactId,
    digest: artifact.digest,
    contract: { ...artifact.contract },
    kind: artifact.kind,
    location: artifact.location,
    ...(artifact.manifest === undefined ? {} : { manifest: artifact.manifest }),
    ...(artifact.cherryPickMainline === undefined ? {} : { cherryPickMainline: artifact.cherryPickMainline })
  };
}

function integrationArtifact(artifact: V2ExecutionArtifact): IntegrationChildArtifact {
  return { schemaVersion: 1, ...artifact, contract: { ...artifact.contract } };
}

/**
 * Reads usage off the recorded result. `source` always travels with the
 * numbers: a provider-reported figure and a registry estimate answer different
 * questions and must never be summed as one measurement.
 */
function usageOf(result: {
  tokensIn?: number | undefined;
  tokensTotal?: number | undefined;
  tokensOut?: number | undefined;
  costUsd?: number | undefined;
  usageSource?: "reported" | "estimated" | "unavailable" | undefined;
}): V2AttemptUsage {
  return {
    ...(result.tokensIn !== undefined ? { tokensIn: result.tokensIn } : {}),
    ...(result.tokensTotal !== undefined ? { tokensTotal: result.tokensTotal } : {}),
    ...(result.tokensOut !== undefined ? { tokensOut: result.tokensOut } : {}),
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    source: result.usageSource ?? "unavailable"
  };
}

function successOutcome(candidateCommit: string, changedFiles: string[], evidenceMatrix: V2ExecutionEvidenceMatrix, artifactCherryPickMainline?: 1) {
  return {
    kind: "success" as const,
    candidateCommit,
    outputDigest: digest(candidateCommit),
    changedFiles: [...changedFiles],
    evidenceMatrix,
    artifactLocation: candidateCommit,
    ...(artifactCherryPickMainline === undefined ? {} : { artifactCherryPickMainline })
  };
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function instructionFilePath(input: Pick<V2PhysicalNodeExecutionInput, "runId" | "attemptId">, kind: string): string {
  return join(tmpdir(), `mh-v2-${createHash("sha256").update(`${input.runId}:${input.attemptId}:${kind}`).digest("hex").slice(0, 20)}.txt`);
}

export const executionFailureReasonForTest = executionFailureReason;

function validationFailureReason(candidateCommit: string, matrix: V2ExecutionEvidenceMatrix): string {
  const failedCriteria = matrix.criteria
    .filter((criterion) => criterion.status !== "satisfied")
    .map((criterion) => `${criterion.obligationId}: ${criterion.justification}`);
  const detail = failedCriteria.length === 0
    ? ""
    : ` Failed criteria: ${failedCriteria.join(" | ")}`;
  return `validation_failed: exact candidate ${candidateCommit} failed matrix ${matrix.matrixId}.${detail}`;
}

function executionFailureReason(result: {
  status: string;
  failureKind?: string | undefined;
  stderrTail?: string | undefined;
  stdoutTail?: string | undefined;
  failureHint?: string | undefined;
  scopeCheck?: { violations?: readonly string[]; outOfScope?: readonly string[] } | undefined;
}): string {
  // A scope rejection is explained by the paths that left the contract, not by
  // the agent's diff: dumping the diff here buried the actual cause in the
  // persisted failure reason and made the journal unreadable.
  if (result.status === "scope_violation" || result.status === "scope_gated") {
    // Both halves of the rejection, because they arrive in different places: a
    // forbidden-glob hit lands in `violations`, while a path that is merely
    // outside the allow-list lands in `outOfScope` and only becomes terminal
    // under a non-advisory policy. Reading `violations` alone left every strict
    // rejection with no paths at all, so the decision raised to the operator
    // asked them to retry a violation it would not name — while the answer sat
    // in a `scope_check_failed` trace nobody is pointed at (SP2 rehearsal, run
    // dbb427ca).
    const rejected = [...(result.scopeCheck?.violations ?? []), ...(result.scopeCheck?.outOfScope ?? [])];
    const detail = rejected.length > 0
      ? `changed files outside the declared scope: ${[...new Set(rejected)].join(", ")}`
      : "the agent changed files outside the declared scope";
    return `${result.status}: ${detail}`;
  }
  if (result.status === "timeout" || result.failureKind === "timeout") {
    return [result.failureKind, result.status, result.failureHint]
      .filter((value) => value !== undefined && value.length > 0)
      .join(": ");
  }
  return [result.failureKind, result.status, result.failureHint, result.stderrTail, result.stdoutTail]
    .filter((value) => value !== undefined && value.length > 0)
    .join(": ");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureCauseFor(input: V2PhysicalNodeExecutionInput, error: unknown): V2FailureCause | undefined {
  if (typeof error !== "object" || error === null || !("evidence" in error)) return undefined;
  const evidence = (error as { evidence?: unknown }).evidence;
  if (typeof evidence !== "object" || evidence === null) return undefined;
  const code = (evidence as { code?: unknown }).code;
  const artifactId = (evidence as { artifactId?: unknown }).artifactId;
  if (typeof code !== "string" || typeof artifactId !== "string") return undefined;
  const producerNodeId = input.consumedArtifacts.find((artifact) => artifact.artifactId === artifactId)?.nodeId;
  return {
    source: "artifact",
    code,
    artifactId,
    ...(producerNodeId === undefined ? {} : { producerNodeId })
  };
}

function requiredValidationRecipeDigest(matrix: Pick<V2ExecutionEvidenceMatrix, "validationRecipeDigest">): string {
  if (matrix.validationRecipeDigest === undefined) throw new Error("Verified root evidence has no validation recipe digest.");
  return matrix.validationRecipeDigest;
}

function requiredUnmaterializedObligations(
  contract: TaskContractBundle,
  prepared: PreparedValidationRecipe | undefined
): UnmaterializedObligation[] {
  if (prepared === undefined) return [];
  const required = new Set(contract.validation.obligations
    .filter((obligation) => obligation.severity === "required")
    .map((obligation) => obligation.id));
  // A recipe prepared before this field existed still reports identities, so
  // fall back to them rather than losing the block entirely.
  const detailed = prepared.unmaterialized
    ?? prepared.unmaterializedObligationIds.map((obligationId) => ({
      obligationId,
      cause: "evidence_missing" as const,
      detail: "This obligation produced no command."
    }));
  return detailed.filter(({ obligationId }) => required.has(obligationId));
}

function missingExpectedArtifactPaths(
  expectedPaths: readonly string[],
  changedFiles: readonly string[],
  verifiedBaselinePaths: readonly string[] | undefined
): string[] {
  if (expectedPaths.length === 0) return [];
  const observed = [...new Set([...(changedFiles ?? []), ...(verifiedBaselinePaths ?? [])].map(normalizePath))];
  return expectedPaths.filter((expected) => !observed.some((actual) => pathMatches(expected, actual)));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function pathMatchesLegacy(pattern: string, value: string): boolean {
  const escaped = normalizePath(pattern).replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("**", "§§DOUBLE_STAR§§").replaceAll("*", "[^/]*").replaceAll("§§DOUBLE_STAR§§", ".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function pathMatches(pattern: string, value: string): boolean {
  return pathMatchesLegacy(pattern, value);
}
