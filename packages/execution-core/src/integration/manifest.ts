import { createHash } from "node:crypto";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import type { GitRunner } from "../git/runner";

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
  const requiredArtifactIds = [...new Set(input.requiredArtifactIds)].sort();
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
  repairAttempt?: { pass: 1; artifactId: string; outcome: "succeeded" | "failed"; evidenceRefs: string[] };
  candidateSha?: string;
  parentEvidence?: { matrixId: string; outcome: "verified" | "unverified" | "failed" };
  outputArtifacts: Array<{ artifactId: string; digest: string; contract: { id: string; revision: string }; kind: "commit"; location: string }>;
  disposition: "success" | "failed" | "decision_required";
  errors: Array<{ code: "missing_required_artifact" | "unsupported_artifact" | "base_mismatch" | "materialization_failed" | "parent_validation_failed"; artifactId?: string; message: string }>;
}

export interface IntegrationManifestExecutorDeps {
  git: GitRunner;
  validate(input: { request: IntegrationRequestManifest; candidateSha: string; worktreePath: string }): Promise<{ matrixId: string; outcome: "verified" | "unverified" | "failed" }>;
  repair?(input: { requestManifestId: string; artifactId: string; parentGoal: string; seamRevisions: IntegrationRequestManifest["seamRevisions"]; childArtifacts: IntegrationChildArtifact[]; conflictFiles: string[]; conflictOutput: string; worktreePath: string; pass: 1 }): Promise<{ success: boolean; candidateSha?: string; evidenceRefs: string[] }>;
  digestCandidate(input: { candidateSha: string; worktreePath: string }): Promise<string>;
}

export class IntegrationManifestExecutor {
  constructor(private readonly deps: IntegrationManifestExecutorDeps) {}

  async integrate(input: { request: IntegrationRequestManifest; worktreePath: string }): Promise<IntegrationManifest> {
    const { request, worktreePath } = input;
    const base = manifestBase(request);
    if (request.missingRequiredArtifactIds.length > 0) {
      return { ...base, disposition: "failed", errors: request.missingRequiredArtifactIds.map((artifactId) => ({ code: "missing_required_artifact", artifactId, message: `Required artifact ${artifactId} was not adopted.` })) };
    }
    const initialHead = await this.deps.git.head(worktreePath);
    if (initialHead !== request.base.resultingCommit) return { ...base, disposition: "failed", errors: [{ code: "base_mismatch", message: `Integration base is ${initialHead}, expected ${request.base.resultingCommit}.` }] };

    const operations: IntegrationManifest["operations"] = [];
    let repairAttempt: IntegrationManifest["repairAttempt"];
    for (const artifact of request.childArtifacts) {
      if (artifact.kind !== "commit") return { ...base, operations, disposition: "failed", errors: [{ code: "unsupported_artifact", artifactId: artifact.artifactId, message: `Artifact ${artifact.artifactId} requires a ${artifact.kind} materializer.` }] };
      const preSha = await this.deps.git.head(worktreePath);
      const outcome = await this.deps.git.cherryPick({ cwd: worktreePath, commitSha: artifact.location });
      if (outcome.ok) {
        operations.push({ artifactId: artifact.artifactId, operation: "cherry_pick", preSha, resultSha: await this.deps.git.head(worktreePath), outcome: "applied" });
        continue;
      }
      operations.push({ artifactId: artifact.artifactId, operation: "cherry_pick", preSha, outcome: "conflict" });
      await this.deps.git.cherryPickAbort(worktreePath).catch(() => undefined);
      if (this.deps.repair === undefined) return { ...base, operations, disposition: "decision_required", errors: [{ code: "materialization_failed", artifactId: artifact.artifactId, message: outcome.output }] };
      const repaired = await this.deps.repair({ requestManifestId: request.manifestId, artifactId: artifact.artifactId, parentGoal: request.parentGoal, seamRevisions: request.seamRevisions, childArtifacts: request.childArtifacts, conflictFiles: outcome.conflictFiles, conflictOutput: outcome.output, worktreePath, pass: 1 });
      repairAttempt = { pass: 1, artifactId: artifact.artifactId, outcome: repaired.success ? "succeeded" : "failed", evidenceRefs: repaired.evidenceRefs };
      if (!repaired.success || repaired.candidateSha === undefined) return { ...base, operations, repairAttempt, disposition: "decision_required", errors: [{ code: "materialization_failed", artifactId: artifact.artifactId, message: "The single semantic repair attempt failed." }] };
      operations[operations.length - 1] = { ...operations.at(-1)!, resultSha: repaired.candidateSha, outcome: "applied" };
    }

    const candidateSha = await this.deps.git.head(worktreePath);
    const parentEvidence = await this.deps.validate({ request, candidateSha, worktreePath });
    if (parentEvidence.outcome !== "verified") return { ...base, operations, ...(repairAttempt !== undefined ? { repairAttempt } : {}), candidateSha, parentEvidence, disposition: "failed", errors: [{ code: "parent_validation_failed", message: `Parent validation outcome is ${parentEvidence.outcome}.` }] };
    const digest = await this.deps.digestCandidate({ candidateSha, worktreePath });
    return {
      ...base, operations, ...(repairAttempt !== undefined ? { repairAttempt } : {}), candidateSha, parentEvidence,
      outputArtifacts: [{ artifactId: `${request.compositeNode.id}:r${request.compositeNode.graphRevision}`, digest, contract: request.outputArtifactContract, kind: "commit", location: candidateSha }],
      disposition: "success", errors: []
    };
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
