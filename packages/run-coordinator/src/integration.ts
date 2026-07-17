import type { AdoptedArtifact } from "./domain/artifacts.js";
import type { RunEventDraft } from "./domain/events.js";

export interface AdoptableIntegrationManifest {
  runId: string;
  integrationAttemptId: string;
  compositeNode: { id: string; graphRevision: number };
  requiredArtifactIds: string[];
  missingRequiredArtifactIds: string[];
  childArtifacts: Array<{ artifactId: string; digest: string }>;
  disposition: "success" | "failed" | "decision_required";
  parentEvidence?: { matrixId: string; outcome: "verified" | "unverified" | "failed" };
  outputArtifacts: Array<{ artifactId: string; digest: string; contract: { id: string; revision: string }; kind: "commit"; location: string }>;
  errors: Array<{ code: string; message: string }>;
}

export function decideIntegrationAdoption(
  manifest: AdoptableIntegrationManifest,
  adoptedAt: string
): { eligible: true; artifacts: AdoptedArtifact[]; events: RunEventDraft[] } | { eligible: false; reason: string } {
  if (manifest.disposition !== "success") return { eligible: false, reason: `Integration disposition is ${manifest.disposition}.` };
  if (manifest.errors.length > 0 || manifest.missingRequiredArtifactIds.length > 0) return { eligible: false, reason: "Integration manifest contains omissions or errors." };
  if (manifest.parentEvidence?.outcome !== "verified") return { eligible: false, reason: "Parent validation evidence is not verified." };
  const actual = [...new Set(manifest.childArtifacts.map((artifact) => artifact.artifactId))].sort();
  const required = [...new Set(manifest.requiredArtifactIds)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) return { eligible: false, reason: "Integrated child artifacts do not exactly match required artifacts." };
  if (manifest.outputArtifacts.length === 0) return { eligible: false, reason: "Successful integration produced no output artifact." };
  const artifacts = manifest.outputArtifacts.map((artifact): AdoptedArtifact => ({
    schemaVersion: 1,
    artifactId: artifact.artifactId,
    runId: manifest.runId,
    nodeId: manifest.compositeNode.id,
    digest: artifact.digest,
    producerAttemptId: manifest.integrationAttemptId,
    contract: artifact.contract,
    kind: artifact.kind,
    location: artifact.location,
    adoptedAt
  }));
  return { eligible: true, artifacts, events: artifacts.map((artifact) => ({ type: "artifact.adopted", payload: { artifact } })) };
}
