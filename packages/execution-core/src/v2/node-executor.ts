import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactContract, TaskContractBundle } from "@manyhands/contracts";
import type { GraphRevision, TaskNodeV2 } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import { ExecutionBaseBuilder, type BuiltExecutionBase } from "../base/execution-base-builder";
import { AGENT_STATUS_PROTOCOL_INSTRUCTIONS } from "../executor/status-channel";
import type { AgentExecutorFactory } from "../executor/factory";
import type { StageSelection } from "../executor/registry";
import { usageSourceForSelection } from "../executor/registry";
import type { GitRunner } from "../git/runner";
import {
  createIntegrationRequestManifest,
  IntegrationManifestExecutor,
  type IntegrationChildArtifact,
  type IntegrationManifest
} from "../integration/manifest";
import { ResultRecorder } from "../result/recorder";
import type { ExecutionConfig, WorktreeRecord } from "../types";
import { WorktreeManager } from "../worktree/manager";

export interface V2ExecutionArtifact {
  artifactId: string;
  runId: string;
  nodeId: string;
  digest: string;
  producerAttemptId: string;
  contract: { id: string; revision: string };
  kind: "commit" | "files" | "manifest" | "logical";
  location: string;
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
}

export interface V2NodeValidationPort {
  validate(input: {
    runId: string;
    attemptId: string;
    contract: TaskContractBundle;
    candidateCommit: string;
    baselineCommit: string;
    signal?: AbortSignal;
  }): Promise<V2ExecutionEvidenceMatrix>;
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
  }): Promise<{ manifestId: string }>;
}

export interface V2PhysicalNodeExecutionInput {
  runId: string;
  attemptId: string;
  inputFingerprint: string;
  graph: GraphRevision;
  node: TaskNodeV2;
  contract: TaskContractBundle;
  consumedArtifacts: V2ExecutionArtifact[];
  outputArtifactContract: ArtifactContract;
  selection: StageSelection;
  repairSelection: StageSelection;
  config: ExecutionConfig;
  target: { sourceTargetFingerprint: string; targetBranch: string; targetHead: string };
  signal?: AbortSignal;
}

/** What one attempt consumed, as the executor reported it. */
export interface V2AttemptUsage {
  tokensIn?: number;
  tokensOut?: number;
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
      artifactLocation: string;
      integrationManifestId?: string;
      repairObservations?: Array<{ kind: "code" | "integration"; pass: number; evidenceRefs: string[] }>;
      finalManifestId?: string;
    }
  | {
      kind: "failure";
      reason: string;
      usage?: V2AttemptUsage;
      integrationManifestId?: string;
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
      const hasChildren = Object.values(input.graph.nodes).some((node) => node.parentId === input.node.id);
      return await (
        (input.node.kind === "root" || input.node.kind === "composite") && hasChildren
          ? this.executeComposite(input)
          : this.executeLeaf(input)
      );
    } catch (error) {
      return { kind: "failure", reason: describe(error) };
    }
  }

  private async executeLeaf(input: V2PhysicalNodeExecutionInput): Promise<V2PhysicalNodeExecutionOutcome> {
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
      return { kind: "failure", reason: describe(error) };
    }
    const instructionPath = instructionFilePath(input, "execute");
    let candidateToAnchor: string | undefined;
    try {
      await this.writeInstructions(instructionPath, buildV2NodeInstructions(input));
      const executor = this.options.executorFactory.create(input.selection);
      const executorOutcome = await executor.execute({
        cwd: base.worktree.path,
        instructionFilePath: instructionPath,
        model: input.selection.model,
        timeoutMs: input.config.leafTimeoutMs,
        bypassApprovals: true,
        processOwnerId: input.runId,
        attemptId: stableUuid(input.attemptId),
        ...(input.selection.effort !== undefined ? { reasoningEffort: input.selection.effort } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        onOutput: (chunk) => this.options.traceStore.append({ type: "executor_output", actor: "agent", taskId: input.node.id, payload: chunk }),
        onAgentStatus: (status) => this.options.traceStore.append({ type: "agent_status", actor: "agent", taskId: input.node.id, payload: { ...status } })
      });
      const result = await this.recorder.record({
        worktree: base.worktree,
        executorOutcome,
        scopeContract: input.contract.scope,
        scopePolicy: input.config.scopePolicy,
        unexpectedCommitPolicy: input.config.unexpectedCommitPolicy,
        commitMessage: `mh-v2: ${input.node.id}`,
        usageSource: usageSourceForSelection(input.selection)
      });
      if (result.status !== "success") {
        return { kind: "failure", reason: executionFailureReason(result), usage: usageOf(result) };
      }
      const candidateCommit = result.commitSha ?? result.currentHead;
      candidateToAnchor = candidateCommit;
      const evidenceMatrix = await this.options.validator.validate({
        runId: input.runId,
        attemptId: input.attemptId,
        contract: input.contract,
        candidateCommit,
        baselineCommit: input.graph.baseCommit,
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      let success: Extract<V2PhysicalNodeExecutionOutcome, { kind: "success" }> =
        { ...successOutcome(candidateCommit, result.changedFiles, evidenceMatrix), usage: usageOf(result) };
      if (evidenceMatrix.outcome === "failed") {
        const repaired = await this.repairLeaf(input, base.worktree, candidateCommit, evidenceMatrix);
        if (repaired.kind === "failure") return repaired;
        success = repaired;
        candidateToAnchor = repaired.candidateCommit;
      }
      if (input.node.id !== input.graph.rootId || success.evidenceMatrix.outcome !== "verified") return success;
      if (this.options.finalCandidate === undefined) {
        return { kind: "failure", reason: "Root execution has no final-candidate preparer." };
      }
      const finalManifestId = (await this.options.finalCandidate.prepare({
        runId: input.runId,
        attemptId: input.attemptId,
        candidateCommit: success.candidateCommit,
        evidenceMatrix: success.evidenceMatrix,
        ...input.target
      })).manifestId;
      return { ...success, finalManifestId };
    } catch (error) {
      return { kind: "failure", reason: describe(error) };
    } finally {
      await rm(instructionPath, { force: true }).catch(() => undefined);
      await this.releaseExecutionBase(base, input, candidateToAnchor);
    }
  }

  private async executeComposite(input: V2PhysicalNodeExecutionInput): Promise<V2PhysicalNodeExecutionOutcome> {
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
    try {
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
        validate: async ({ candidateSha }) => {
          evidenceMatrix = await this.options.validator.validate({
            runId: input.runId,
            attemptId: input.attemptId,
            contract: input.contract,
            candidateCommit: candidateSha,
            baselineCommit: input.graph.baseCommit,
            ...(input.signal !== undefined ? { signal: input.signal } : {})
          });
          return { matrixId: evidenceMatrix.matrixId, outcome: evidenceMatrix.outcome };
        },
        repair: async (repair) => this.repairIntegration(input, base.worktree, repair),
        digestCandidate: async ({ candidateSha }) => digest(candidateSha)
      });
      let manifest: IntegrationManifest;
      try {
        manifest = await integrator.integrate({ request, worktreePath: base.worktree.path });
        candidateToAnchor = manifest.candidateSha;
      } catch (error) {
        return {
          kind: "failure",
          integrationManifestId: `integration-result-${request.manifestId}`,
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
          ...(repairObservations !== undefined ? { repairObservations } : {}),
          reason:
            manifest.errors.map((error) => error.message).join("; ") ||
            `Integration ended as ${manifest.disposition}.`
        };
      }
      const changedFiles = await this.options.git.diffRangeNameOnly({
        cwd: base.worktree.path,
        from: base.manifest.resultingCommit,
        to: manifest.candidateSha
      });
      let finalManifestId: string | undefined;
      if (input.node.kind === "root") {
        if (this.options.finalCandidate === undefined) {
          return {
            kind: "failure",
            integrationManifestId: manifest.manifestId,
            reason: "Root execution has no final-candidate preparer."
          };
        }
        finalManifestId = (await this.options.finalCandidate.prepare({
          runId: input.runId,
          attemptId: input.attemptId,
          candidateCommit: manifest.candidateSha,
          evidenceMatrix,
          ...input.target
        })).manifestId;
      }
      return {
        ...successOutcome(manifest.candidateSha, changedFiles, evidenceMatrix),
        integrationManifestId: manifest.manifestId,
        ...(repairObservations !== undefined ? { repairObservations } : {}),
        ...(finalManifestId !== undefined ? { finalManifestId } : {})
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
        // Cleanup authority is reported by the execution outcome below.
      }
      if (candidateCommit !== undefined) throw error;
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
    }
  ): Promise<{ success: boolean; candidateSha?: string; evidenceRefs: string[] }> {
    const instructionPath = instructionFilePath(input, "repair");
    const expectedHead = await this.options.git.head(worktree.path);
    try {
      await this.writeInstructions(instructionPath, buildV2RepairInstructions(input, repair));
      const executor = this.options.executorFactory.create(input.repairSelection);
      const outcome = await executor.execute({
        cwd: worktree.path,
        instructionFilePath: instructionPath,
        model: input.repairSelection.model,
        timeoutMs: input.config.integrationTimeoutMs,
        bypassApprovals: true,
        processOwnerId: input.runId,
        attemptId: stableUuid(`${input.attemptId}:repair:${repair.pass}`),
        ...(input.repairSelection.effort !== undefined ? { reasoningEffort: input.repairSelection.effort } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      const result = await this.recorder.record({
        worktree,
        executorOutcome: outcome,
        expectedHead,
        scopeContract: input.contract.scope,
        scopePolicy: input.config.scopePolicy,
        unexpectedCommitPolicy: input.config.unexpectedCommitPolicy,
        commitMessage: `mh-v2-repair: ${input.node.id}`,
        usageSource: usageSourceForSelection(input.repairSelection)
      });
      const evidenceRefs = [`repair:${input.attemptId}:${repair.pass}`, ...repair.conflictFiles.map((file) => `file:${file}`)];
      return result.status === "success" && result.commitSha !== undefined
        ? { success: true, candidateSha: result.commitSha, evidenceRefs }
        : { success: false, evidenceRefs };
    } catch {
      return { success: false, evidenceRefs: [`repair:${input.attemptId}:${repair.pass}`] };
    } finally {
      await rm(instructionPath, { force: true }).catch(() => undefined);
    }
  }

  private async repairLeaf(
    input: V2PhysicalNodeExecutionInput,
    worktree: WorktreeRecord,
    candidateCommit: string,
    failedMatrix: V2ExecutionEvidenceMatrix
  ): Promise<Extract<V2PhysicalNodeExecutionOutcome, { kind: "success" | "failure" }>> {
    const pass = 1;
    const evidenceRefs = [failedMatrix.matrixId, ...failedMatrix.criteria.flatMap((criterion) => criterion.evidenceRefs)];
    const repairObservation = { kind: "code" as const, pass, evidenceRefs: [...new Set(evidenceRefs)] };
    const instructionPath = instructionFilePath(input, "code-repair");
    try {
      await this.writeInstructions(instructionPath, buildV2CodeRepairInstructions(input, failedMatrix));
      const executor = this.options.executorFactory.create(input.repairSelection);
      const outcome = await executor.execute({
        cwd: worktree.path,
        instructionFilePath: instructionPath,
        model: input.repairSelection.model,
        timeoutMs: input.config.leafTimeoutMs,
        bypassApprovals: true,
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
      const evidenceMatrix = await this.options.validator.validate({
        runId: input.runId,
        attemptId: input.attemptId,
        contract: input.contract,
        candidateCommit: repairedCommit,
        baselineCommit: input.graph.baseCommit,
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      return {
        ...successOutcome(repairedCommit, result.changedFiles, evidenceMatrix),
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

export function buildV2NodeInstructions(input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract" | "consumedArtifacts">): string {
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
    ...scope.allowedPaths.map((path) => `- ${path}`)
  ];
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
  if (scope.forbiddenPaths.length > 0) lines.push("", "Never modify these paths:", ...scope.forbiddenPaths.map((path) => `- ${path}`));
  if (seams.length > 0) {
    lines.push("", "Shared contracts with sibling work (follow these exactly):");
    for (const seam of seams) {
      const role = seam.producerNodeId === input.node.id ? "produce" : "consume";
      lines.push(`- ${role} ${seam.kind} ${seam.id}@${seam.revision}: ${seam.specification}`);
      for (const [key, value] of Object.entries(seam.semanticFacts)) lines.push(`  - ${key}: ${value}`);
    }
  }
  if (input.consumedArtifacts.length > 0) {
    lines.push("", "Declared upstream artifacts already materialized in this worktree:", ...input.consumedArtifacts.map((artifact) => `- ${artifact.contract.id}@${artifact.contract.revision} (${artifact.digest})`));
  }
  if (task.constraints.length > 0) lines.push("", "Constraints:", ...task.constraints.map((constraint) => `- ${constraint}`));
  lines.push("", AGENT_STATUS_PROTOCOL_INSTRUCTIONS, "", "Do not commit. The orchestrator will inspect and commit the exact diff.");
  return lines.join("\n");
}

function buildV2RepairInstructions(
  input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract">,
  repair: { artifactId: string; conflictFiles: string[]; conflictOutput: string; childArtifacts: IntegrationChildArtifact[] }
): string {
  return [
    `Resolve the integration conflict for ${input.node.title}.`,
    "",
    `Parent objective: ${input.contract.task.goal}`,
    `Conflicting artifact: ${repair.artifactId}`,
    "Conflict files:",
    ...repair.conflictFiles.map((file) => `- ${file}`),
    "",
    "Preserve every child intent and the shared contracts below:",
    ...input.contract.seams.map((seam) => `- ${seam.id}@${seam.revision}: ${seam.specification}`),
    ...repair.childArtifacts.map((artifact) => `- child ${artifact.nodeId}: ${artifact.contract.id}@${artifact.contract.revision} (${artifact.digest})`),
    "",
    "Git conflict output:",
    repair.conflictOutput,
    "",
    "Resolve the files and leave the worktree ready to commit. Do not commit; the orchestrator commits."
  ].join("\n");
}

function buildV2CodeRepairInstructions(
  input: Pick<V2PhysicalNodeExecutionInput, "node" | "contract">,
  failedMatrix: V2ExecutionEvidenceMatrix
): string {
  return [
    `Repair the failed candidate for ${input.node.title}.`,
    "",
    `Objective: ${input.contract.task.goal}`,
    "The exact candidate was rejected by these validation obligations:",
    ...failedMatrix.criteria
      .filter((criterion) => criterion.status === "failed")
      .map((criterion) => `- ${criterion.criterionId}: ${criterion.justification}`),
    "",
    "Preserve the declared scope and shared contracts. Change only what is required to satisfy the failed evidence.",
    "Do not commit; the orchestrator will revalidate and commit the repair."
  ].join("\n");
}

function executionArtifactInput(artifact: V2ExecutionArtifact) {
  return { artifactId: artifact.artifactId, digest: artifact.digest, contract: { ...artifact.contract }, kind: artifact.kind, location: artifact.location };
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
  tokensOut?: number | undefined;
  costUsd?: number | undefined;
  usageSource?: "reported" | "estimated" | "unavailable" | undefined;
}): V2AttemptUsage {
  return {
    ...(result.tokensIn !== undefined ? { tokensIn: result.tokensIn } : {}),
    ...(result.tokensOut !== undefined ? { tokensOut: result.tokensOut } : {}),
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    source: result.usageSource ?? "unavailable"
  };
}

function successOutcome(candidateCommit: string, changedFiles: string[], evidenceMatrix: V2ExecutionEvidenceMatrix) {
  return {
    kind: "success" as const,
    candidateCommit,
    outputDigest: digest(candidateCommit),
    changedFiles: [...changedFiles],
    evidenceMatrix,
    artifactLocation: candidateCommit
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

function executionFailureReason(result: {
  status: string;
  stderrTail?: string | undefined;
  stdoutTail?: string | undefined;
  failureHint?: string | undefined;
  scopeCheck?: { violations?: readonly string[]; outOfScope?: readonly string[] } | undefined;
}): string {
  // A scope rejection is explained by the paths that left the contract, not by
  // the agent's diff: dumping the diff here buried the actual cause in the
  // persisted failure reason and made the journal unreadable.
  if (result.status === "scope_violation") {
    const violations = result.scopeCheck?.violations ?? [];
    const detail = violations.length > 0
      ? `changed files outside the declared scope: ${violations.join(", ")}`
      : "the agent changed files outside the declared scope";
    return `${result.status}: ${detail}`;
  }
  return [result.status, result.failureHint, result.stderrTail, result.stdoutTail].filter((value) => value !== undefined && value.length > 0).join(": ");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
