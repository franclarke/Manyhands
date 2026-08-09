import { createHash } from "node:crypto";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import type { GitRunner } from "../git/runner";
import type { IntegrationOperationJournal } from "./operation-journal";

const ContractRefSchema = z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict();
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const IntegrationChildArtifactSchema = z.object({
  schemaVersion: z.literal(1), artifactId: EntityIdSchema, runId: EntityIdSchema,
  nodeId: EntityIdSchema, digest: NonEmptyStringSchema, producerAttemptId: EntityIdSchema,
  contract: ContractRefSchema, kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema, adoptedAt: IsoTimestampSchema,
  evidenceRefs: z.array(NonEmptyStringSchema).optional(), diffRef: NonEmptyStringSchema.optional()
}).strict();
export type IntegrationChildArtifact = z.infer<typeof IntegrationChildArtifactSchema>;

export interface IntegrationRequestManifest {
  schemaVersion: 1;
  manifestId: string;
  runId: string;
  integrationAttemptId: string;
  compositeNode: { id: string; graphRevision: number };
  base: { manifestId: string; resultingCommit: string; inputFingerprint: string };
  childArtifacts: IntegrationChildArtifact[];
  requiredArtifactIds: string[];
  missingRequiredArtifactIds: string[];
  seamRevisions: Array<{ id: string; revision: string }>;
  parentGoal: string;
  validationContract: { id: string; revision: string };
  outputArtifactContract: { id: string; revision: string };
  repairBudget: 1;
  createdAt: string;
}

export function createIntegrationRequestManifest(input: {
  runId: string;
  integrationAttemptId: string;
  compositeNode: IntegrationRequestManifest["compositeNode"];
  base: IntegrationRequestManifest["base"];
  availableArtifacts: IntegrationChildArtifact[];
  requiredArtifactIds: string[];
  seamRevisions: IntegrationRequestManifest["seamRevisions"];
  parentGoal: string;
  validationContract: IntegrationRequestManifest["validationContract"];
  outputArtifactContract: IntegrationRequestManifest["outputArtifactContract"];
  createdAt: string;
}): IntegrationRequestManifest {
  FingerprintSchema.parse(input.base.inputFingerprint);
  const available = new Map(input.availableArtifacts.map((artifact) => {
    const parsed = IntegrationChildArtifactSchema.parse(artifact);
    return [parsed.artifactId, parsed] as const;
  }));
  if (available.size !== input.availableArtifacts.length) throw new Error("Available integration artifacts must have unique ids.");
  // The execution driver has already put these artifacts in producer-before-
  // consumer order. Sorting ids here can make a downstream patch apply before
  // the upstream source it was authored against.
  const requiredArtifactIds = [...new Set(input.requiredArtifactIds)];
  const childArtifacts = requiredArtifactIds.flatMap((id) => available.get(id) ?? []);
  const missingRequiredArtifactIds = requiredArtifactIds.filter((id) => !available.has(id));
  const identity = JSON.stringify({ runId: input.runId, attempt: input.integrationAttemptId, compositeNode: input.compositeNode, base: input.base, requiredArtifactIds, childArtifacts: childArtifacts.map(({ artifactId, digest }) => ({ artifactId, digest })), seams: input.seamRevisions, validation: input.validationContract, output: input.outputArtifactContract });
  return {
    schemaVersion: 1,
    manifestId: `integration-request-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
    runId: input.runId,
    integrationAttemptId: input.integrationAttemptId,
    compositeNode: { ...input.compositeNode },
    base: { ...input.base },
    childArtifacts,
    requiredArtifactIds,
    missingRequiredArtifactIds,
    seamRevisions: [...input.seamRevisions].sort((left, right) => left.id.localeCompare(right.id)),
    parentGoal: input.parentGoal,
    validationContract: { ...input.validationContract },
    outputArtifactContract: { ...input.outputArtifactContract },
    repairBudget: 1,
    createdAt: input.createdAt
  };
}

export interface IntegrationManifest {
  schemaVersion: 1;
  manifestId: string;
  requestManifestId: string;
  compositeNode: IntegrationRequestManifest["compositeNode"];
  base: IntegrationRequestManifest["base"];
  childArtifacts: IntegrationChildArtifact[];
  seamRevisions: IntegrationRequestManifest["seamRevisions"];
  operations: Array<{ artifactId: string; operation: "cherry_pick"; preSha: string; resultSha?: string; outcome: "applied" | "conflict" | "error" }>;
  repairAttempt?: {
    pass: 1;
    cause: "materialization_conflict" | "parent_validation_failed";
    artifactId: string;
    outcome: "succeeded" | "failed";
    candidateSha?: string;
    evidenceRefs: string[];
  };
  candidateSha?: string;
  parentEvidence?: { matrixId: string; outcome: "verified" | "unverified" | "failed" };
  outputArtifacts: Array<{ artifactId: string; digest: string; contract: { id: string; revision: string }; kind: "commit"; location: string }>;
  disposition: "success" | "failed" | "decision_required";
  errors: Array<{ code: "missing_required_artifact" | "unsupported_artifact" | "base_mismatch" | "materialization_failed" | "child_intent_not_retained" | "parent_validation_failed"; artifactId?: string; message: string }>;
}

export interface IntegrationManifestExecutorDeps {
  git: GitRunner;
  validate(input: { request: IntegrationRequestManifest; candidateSha: string; worktreePath: string }): Promise<{
    matrixId: string;
    outcome: "verified" | "unverified" | "failed";
    failedCriteria?: Array<{ criterionId: string; obligationId: string; justification: string }>;
  }>;
  repair?(input: {
    requestManifestId: string;
    artifactId: string;
    parentGoal: string;
    seamRevisions: IntegrationRequestManifest["seamRevisions"];
    childArtifacts: IntegrationChildArtifact[];
    conflictFiles: string[];
    conflictOutput: string;
    worktreePath: string;
    pass: 1;
    cause: "materialization_conflict" | "parent_validation_failed";
    parentValidation?: { matrixId: string; outcome: "unverified" | "failed"; failedCriteria: Array<{ criterionId: string; obligationId: string; justification: string }> };
  }): Promise<{ success: boolean; candidateSha?: string; evidenceRefs: string[] }>;
  digestCandidate(input: { candidateSha: string; worktreePath: string }): Promise<string>;
}

export class IntegrationManifestExecutor {
  constructor(private readonly deps: IntegrationManifestExecutorDeps) {}

  async integrate(input: {
    request: IntegrationRequestManifest;
    worktreePath: string;
    signal?: AbortSignal;
    integrationOperation?: {
      journal: IntegrationOperationJournal;
      runId: string;
      operationId?: string;
      fencingToken?: number;
      allowTakeover?: boolean;
    };
  }): Promise<IntegrationManifest> {
    const { request, worktreePath, signal } = input;
    signal?.throwIfAborted();
    const base = manifestBase(request);
    if (request.missingRequiredArtifactIds.length > 0) {
      return { ...base, disposition: "failed", errors: request.missingRequiredArtifactIds.map((artifactId) => ({ code: "missing_required_artifact", artifactId, message: `Required artifact ${artifactId} was not adopted.` })) };
    }
    let journalOperation = input.integrationOperation === undefined
      ? undefined
      : await input.integrationOperation.journal.open({
          runId: input.integrationOperation.runId,
          parentNodeId: request.compositeNode.id,
          attemptId: request.integrationAttemptId,
          requestManifestId: request.manifestId,
          worktreePath,
          baseSha: request.base.resultingCommit,
          children: request.childArtifacts.map((artifact) => ({
            taskId: artifact.artifactId,
            commitSha: artifact.location,
            state: "pending" as const
          })),
          ...(input.integrationOperation.operationId !== undefined ? { operationId: input.integrationOperation.operationId } : {}),
          ...(input.integrationOperation.fencingToken !== undefined ? { fencingToken: input.integrationOperation.fencingToken } : {}),
          ...(input.integrationOperation.allowTakeover === true ? { allowTakeover: true } : {})
        });
    if (journalOperation?.state === "completed" && journalOperation.resultManifest !== undefined) return journalOperation.resultManifest;

    const initialHead = await this.deps.git.head(worktreePath);
    if (initialHead !== request.base.resultingCommit && journalOperation !== undefined) {
      const startedChild = journalOperation.children.find((child) => child.state === "started" && child.startedFromSha !== undefined);
      const startedFromSha = startedChild?.startedFromSha;
      if (startedChild !== undefined && startedFromSha !== undefined && startedFromSha !== initialHead) {
        const sourceParent = await this.deps.git.revParse(worktreePath, `${startedChild.commitSha}^1`);
        const clean = (await this.deps.git.statusPorcelain(worktreePath)).length === 0
          && (await this.deps.git.unmergedFiles(worktreePath)).length === 0
          && (await this.deps.git.cherryPickHead(worktreePath)) === undefined;
        const sourceDiff = await this.deps.git.diffRange({ cwd: worktreePath, from: sourceParent, to: startedChild.commitSha });
        const appliedDiff = await this.deps.git.diffRange({ cwd: worktreePath, from: startedFromSha, to: initialHead });
        const currentParent = await this.deps.git.revParse(worktreePath, `${initialHead}^1`);
        if (clean
          && currentParent === startedFromSha
          && await this.deps.git.isAncestor({ cwd: worktreePath, ancestor: startedFromSha, descendant: initialHead })
          && sourceDiff === appliedDiff) {
          journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
            state: "child_applied",
            currentChildId: startedChild.taskId,
            children: journalOperation.children.map((child) => child.taskId === startedChild.taskId
              ? { ...child, state: "applied" as const, resultSha: initialHead, application: "cherry_picked" as const }
              : child)
          });
        }
      }
    }
    const lastAppliedSha = [...(journalOperation?.children ?? [])]
      .filter((child) => (child.state === "applied" || child.state === "repaired") && child.resultSha !== undefined)
      .at(-1)?.resultSha;
    const recoverableRepairSha = journalOperation?.repairAttempt?.candidateSha ?? journalOperation?.finalSha;
    if (initialHead !== request.base.resultingCommit && initialHead !== lastAppliedSha && initialHead !== recoverableRepairSha) {
      return { ...base, disposition: "failed", errors: [{ code: "base_mismatch", message: `Integration base is ${initialHead}, expected ${request.base.resultingCommit}.` }] };
    }

    const operations: IntegrationManifest["operations"] = [];
    let repairAttempt: IntegrationManifest["repairAttempt"] = journalOperation?.repairAttempt;
    for (const artifact of request.childArtifacts) {
      signal?.throwIfAborted();
      if (artifact.kind !== "commit") return { ...base, operations, disposition: "failed", errors: [{ code: "unsupported_artifact", artifactId: artifact.artifactId, message: `Artifact ${artifact.artifactId} requires a ${artifact.kind} materializer.` }] };
      const preSha = await this.deps.git.head(worktreePath);
      const recordedChild = journalOperation?.children.find((child) => child.taskId === artifact.artifactId);
      if ((recordedChild?.state === "applied" || recordedChild?.state === "repaired") && recordedChild.resultSha !== undefined) {
        if (preSha !== recordedChild.resultSha) {
          return { ...base, operations, disposition: "failed", errors: [{ code: "base_mismatch", artifactId: artifact.artifactId, message: `Recovered child ${artifact.artifactId} expected HEAD ${recordedChild.resultSha}, found ${preSha}.` }] };
        }
        operations.push({
          artifactId: artifact.artifactId,
          operation: "cherry_pick",
          preSha: recordedChild.startedFromSha ?? request.base.resultingCommit,
          resultSha: recordedChild.resultSha,
          outcome: "applied"
        });
        continue;
      }
      if (journalOperation !== undefined) {
        journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
          state: "cherry_pick_started",
          currentChildId: artifact.artifactId,
          children: journalOperation.children.map((child) => child.taskId === artifact.artifactId
            ? { ...child, state: "started" as const, startedFromSha: preSha }
            : child)
        });
      }
      const outcome = await this.deps.git.cherryPick({ cwd: worktreePath, commitSha: artifact.location });
      signal?.throwIfAborted();
      if (outcome.ok) {
        const resultSha = await this.deps.git.head(worktreePath);
        operations.push({ artifactId: artifact.artifactId, operation: "cherry_pick", preSha, resultSha, outcome: "applied" });
        if (journalOperation !== undefined) {
          journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
            state: "child_applied",
            currentChildId: artifact.artifactId,
            children: journalOperation.children.map((child) => child.taskId === artifact.artifactId
              ? { ...child, state: "applied" as const, startedFromSha: preSha, resultSha, application: "cherry_picked" as const }
              : child)
          });
        }
        continue;
      }
      operations.push({ artifactId: artifact.artifactId, operation: "cherry_pick", preSha, outcome: "conflict" });
      if (this.deps.repair === undefined) {
        await this.deps.git.cherryPickAbort(worktreePath).catch(() => undefined);
        return { ...base, operations, disposition: "decision_required", errors: [{ code: "materialization_failed", artifactId: artifact.artifactId, message: outcome.output }] };
      }
      if (journalOperation !== undefined) {
        journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
          state: "conflict_detected",
          currentChildId: artifact.artifactId,
          children: journalOperation.children.map((child) => child.taskId === artifact.artifactId
            ? { ...child, state: "conflict" as const }
            : child)
        });
        journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "repair_started" });
      }
      const repaired = await this.deps.repair({ requestManifestId: request.manifestId, artifactId: artifact.artifactId, parentGoal: request.parentGoal, seamRevisions: request.seamRevisions, childArtifacts: request.childArtifacts, conflictFiles: outcome.conflictFiles, conflictOutput: outcome.output, worktreePath, pass: 1, cause: "materialization_conflict" });
      signal?.throwIfAborted();
      repairAttempt = { pass: 1, cause: "materialization_conflict", artifactId: artifact.artifactId, outcome: repaired.success ? "succeeded" : "failed", ...(repaired.candidateSha === undefined ? {} : { candidateSha: repaired.candidateSha }), evidenceRefs: repaired.evidenceRefs };
      if (journalOperation !== undefined) {
        const repairedSha = repaired.candidateSha;
        const repairedChildren: typeof journalOperation.children = repaired.success && repairedSha !== undefined
          ? journalOperation.children.map((child) => child.taskId === artifact.artifactId
            ? { ...child, state: "repaired" as const, resultSha: repairedSha, application: "repaired" as const }
            : child)
          : journalOperation.children;
        journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
          state: "repair_finished",
          ...(repairedSha === undefined ? {} : { finalSha: repairedSha }),
          repairAttempt,
          currentChildId: artifact.artifactId,
          children: repairedChildren
        });
      }
      if (!repaired.success || repaired.candidateSha === undefined) {
        await this.deps.git.cherryPickAbort(worktreePath).catch(() => undefined);
        return { ...base, operations, repairAttempt, disposition: "decision_required", errors: [{ code: "materialization_failed", artifactId: artifact.artifactId, message: "The single semantic repair attempt failed." }] };
      }
      operations[operations.length - 1] = { ...operations.at(-1)!, resultSha: repaired.candidateSha, outcome: "applied" };
    }

    let candidateSha = await this.deps.git.head(worktreePath);
    // A child commit is transport, not a semantic proof. A later child may
    // legitimately supersede an intermediate line while preserving the
    // behavior. The exact candidate validation below is the authority for
    // semantic retention; structural provenance is checked by the journal and
    // operation receipts above.
    if (journalOperation !== undefined) {
      journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "validation_started" });
    }
    let parentEvidence = await this.deps.validate({ request, candidateSha, worktreePath });
    signal?.throwIfAborted();
    if (parentEvidence.outcome !== "verified") {
      if (this.deps.repair !== undefined && repairAttempt === undefined) {
        const parentValidation = {
          matrixId: parentEvidence.matrixId,
          outcome: parentEvidence.outcome,
          failedCriteria: parentEvidence.failedCriteria ?? []
        } as const;
        if (journalOperation !== undefined) {
          journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "validation_failed", finalSha: candidateSha });
          journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "repair_started" });
        }
        const repaired = await this.deps.repair({
          requestManifestId: request.manifestId,
          artifactId: "parent-validation",
          parentGoal: request.parentGoal,
          seamRevisions: request.seamRevisions,
          childArtifacts: request.childArtifacts,
          conflictFiles: [],
          conflictOutput: `Parent validation ${parentEvidence.outcome}: ${parentEvidence.matrixId}`,
          worktreePath,
          pass: 1,
          cause: "parent_validation_failed",
          parentValidation
        });
        signal?.throwIfAborted();
        repairAttempt = {
          pass: 1,
          cause: "parent_validation_failed",
          artifactId: "parent-validation",
          outcome: repaired.success ? "succeeded" : "failed",
          ...(repaired.candidateSha === undefined ? {} : { candidateSha: repaired.candidateSha }),
          evidenceRefs: repaired.evidenceRefs
        };
        if (journalOperation !== undefined) {
          journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "repair_finished", finalSha: repaired.candidateSha ?? candidateSha, repairAttempt });
        }
        if (repaired.success && repaired.candidateSha !== undefined) {
          candidateSha = repaired.candidateSha;
          if (journalOperation !== undefined) {
            journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "validation_started", finalSha: candidateSha });
          }
          parentEvidence = await this.deps.validate({ request, candidateSha, worktreePath });
          signal?.throwIfAborted();
        }
      }
      if (parentEvidence.outcome !== "verified") {
        const failed = { ...base, operations, ...(repairAttempt !== undefined ? { repairAttempt } : {}), candidateSha, parentEvidence, disposition: "failed" as const, errors: [{ code: "parent_validation_failed" as const, message: `Parent validation outcome is ${parentEvidence.outcome}.` }] };
        if (journalOperation !== undefined) await input.integrationOperation!.journal.update(journalOperation, { state: "failed", finalSha: candidateSha });
        return failed;
      }
    }
    if (journalOperation !== undefined) {
      journalOperation = await input.integrationOperation!.journal.update(journalOperation, { state: "validation_finished" });
    }
    const digest = await this.deps.digestCandidate({ candidateSha, worktreePath });
    signal?.throwIfAborted();
    const result: IntegrationManifest = {
      ...base, operations, ...(repairAttempt !== undefined ? { repairAttempt } : {}), candidateSha, parentEvidence,
      outputArtifacts: [{ artifactId: `${request.compositeNode.id}:r${request.compositeNode.graphRevision}`, digest, contract: request.outputArtifactContract, kind: "commit" as const, location: candidateSha }],
      disposition: "success", errors: []
    };
    if (journalOperation !== undefined) {
      journalOperation = await input.integrationOperation!.journal.update(journalOperation, {
        state: "result_persisted",
        resultManifestId: result.manifestId,
        finalSha: candidateSha,
        resultManifest: result
      });
      await input.integrationOperation!.journal.update(journalOperation, { state: "completed" });
    }
    return result;
  }

}

function manifestBase(request: IntegrationRequestManifest): Omit<IntegrationManifest, "operations" | "disposition" | "errors"> & { operations: []; outputArtifacts: [] } {
  return {
    schemaVersion: 1,
    manifestId: `integration-result-${request.manifestId}`,
    requestManifestId: request.manifestId,
    compositeNode: request.compositeNode,
    base: request.base,
    childArtifacts: request.childArtifacts,
    seamRevisions: request.seamRevisions,
    operations: [],
    outputArtifacts: []
  };
}
