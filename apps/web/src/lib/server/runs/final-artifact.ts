import type { FinalArtifactManifest, RunStatus, RunValidationSummary } from "./schema";

/** True only when final-apply produced an inspectable artifact tree/diff. */
export function artifactEvidenceIsReady(
  manifest: Pick<FinalArtifactManifest, "artifactDisposition" | "finalSha"> | undefined
): boolean {
  return manifest !== undefined && manifest.finalSha.length > 0 && manifest.artifactDisposition !== "failed";
}

export function terminalDispositionForArtifact(input: {
  manifest: Pick<FinalArtifactManifest, "artifactDisposition" | "deliveryDisposition" | "verificationDisposition" | "finalSha"> | undefined;
  acceptedRisk: boolean;
}): RunStatus {
  const manifest = input.manifest;
  if (manifest === undefined || manifest.finalSha.length === 0 || manifest.artifactDisposition === "failed") {
    return "failed_artifact";
  }
  if (manifest.deliveryDisposition === "failed") return "failed_delivery";
  if (input.acceptedRisk || manifest.artifactDisposition === "partial") return "partial";
  if (manifest.verificationDisposition !== "verified") return "unverified";
  if (manifest.deliveryDisposition !== "delivered") return "needs_delivery";
  return "completed";
}

export function applyValidationToManifest(
  manifest: FinalArtifactManifest,
  validation: RunValidationSummary | undefined
): FinalArtifactManifest {
  return {
    ...manifest,
    verificationDisposition:
      validation?.status === "passed" ? "verified" : validation?.status === "failed" ? "failed" : "unverified"
  };
}
