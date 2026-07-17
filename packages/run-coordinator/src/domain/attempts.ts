import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import type { AdoptedArtifact } from "./artifacts.js";
import type { RunEventDraft } from "./events.js";

export const AttemptRecordSchema = z.object({
  schemaVersion: z.literal(1), attemptId: EntityIdSchema, runId: EntityIdSchema, nodeId: EntityIdSchema,
  inputFingerprint: NonEmptyStringSchema, retryOfAttemptId: EntityIdSchema.optional(), createdAt: IsoTimestampSchema,
  status: z.enum(["created", "running", "finished", "stale", "adopted", "failed"]).default("created"),
  outputDigest: NonEmptyStringSchema.optional()
}).strict();
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;

export type AttemptAdoptionDecision =
  | { eligible: false; reason: string; event: RunEventDraft }
  | { eligible: true; artifact: AdoptedArtifact; event: RunEventDraft };

export function decideAttemptAdoption(input: {
  attempt: AttemptRecord;
  currentFingerprint: string;
  artifact: { artifactId: string; contract: { id: string; revision: number }; kind: AdoptedArtifact["kind"]; location: string };
  adoptedAt?: string;
}): AttemptAdoptionDecision {
  const attempt = AttemptRecordSchema.parse(input.attempt);
  if (attempt.status !== "finished" || attempt.outputDigest === undefined) throw new Error(`Attempt ${attempt.attemptId} has no finished result to adopt.`);
  if (attempt.inputFingerprint !== input.currentFingerprint) {
    const reason = `Attempt fingerprint ${attempt.inputFingerprint} is stale; current input is ${input.currentFingerprint}.`;
    return { eligible: false, reason, event: { type: "attempt.stale", payload: { attemptId: attempt.attemptId, nodeId: attempt.nodeId, attemptedFingerprint: attempt.inputFingerprint, currentFingerprint: input.currentFingerprint, reason } } };
  }
  const artifact: AdoptedArtifact = { schemaVersion: 1, artifactId: input.artifact.artifactId, runId: attempt.runId, nodeId: attempt.nodeId, digest: attempt.outputDigest, producerAttemptId: attempt.attemptId, contract: input.artifact.contract, kind: input.artifact.kind, location: input.artifact.location, adoptedAt: input.adoptedAt ?? new Date().toISOString() };
  return { eligible: true, artifact, event: { type: "artifact.adopted", payload: { artifact } } };
}

/** The only productive artifact-adoption gate: stale results never reach the registry. */
export async function adoptAttemptResult(
  input: Parameters<typeof decideAttemptAdoption>[0],
  artifacts: { adopt(artifact: AdoptedArtifact): Promise<AdoptedArtifact> }
): Promise<AttemptAdoptionDecision> {
  const decision = decideAttemptAdoption(input);
  if (decision.eligible) await artifacts.adopt(decision.artifact);
  return decision;
}
