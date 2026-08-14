export interface AdoptableIntegrationManifest {
  runId: string;
  integrationAttemptId: string;
  compositeNode: { id: string; graphRevision: number };
  requiredArtifactIds: string[];
  missingRequiredArtifactIds: string[];
  childArtifacts: Array<{ artifactId: string; digest: string }>;
  disposition: "success" | "failed" | "decision_required";
  parentEvidence?: { matrixId: string; outcome: "verified" | "unverified" | "failed" };
  errors: Array<{ code: string; message: string }>;
}

export function decideIntegrationAdoption(
  manifest: AdoptableIntegrationManifest
): { eligible: false; reason: string } {
  if (manifest.disposition !== "success") return { eligible: false, reason: `Integration disposition is ${manifest.disposition}.` };
  if (manifest.errors.length > 0 || manifest.missingRequiredArtifactIds.length > 0) return { eligible: false, reason: "Integration manifest contains omissions or errors." };
  if (manifest.parentEvidence?.outcome !== "verified") return { eligible: false, reason: "Parent validation evidence is not verified." };
  const actual = [...new Set(manifest.childArtifacts.map((artifact) => artifact.artifactId))].sort();
  const required = [...new Set(manifest.requiredArtifactIds)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) return { eligible: false, reason: "Integrated child artifacts do not exactly match required artifacts." };
  return {
    eligible: false,
    reason: "Integration result adoption is retired; the canonical execution driver adopts only exact Git-native manifests."
  };
}
