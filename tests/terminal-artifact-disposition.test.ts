import { describe, expect, it } from "vitest";
import { terminalDispositionForArtifact } from "@/lib/server/runs/final-artifact";

const manifest = {
  artifactDisposition: "ready" as const,
  deliveryDisposition: "needs_delivery" as const,
  verificationDisposition: "verified" as const,
  finalSha: "a".repeat(40)
};

describe("terminal artifact disposition", () => {
  it("never calls an artifact without delivery completed", () => {
    expect(terminalDispositionForArtifact({ manifest, acceptedRisk: false })).toBe("needs_delivery");
  });
  it("classifies accepted failures/conflicts as partial", () => {
    expect(terminalDispositionForArtifact({ manifest, acceptedRisk: true })).toBe("partial");
  });
  it("classifies missing/failed artifacts and validation honestly", () => {
    expect(terminalDispositionForArtifact({ manifest: undefined, acceptedRisk: false })).toBe("failed_artifact");
    expect(terminalDispositionForArtifact({ manifest: { ...manifest, verificationDisposition: "unverified" }, acceptedRisk: false })).toBe("unverified");
  });
  it("only permits completed for a verified delivered artifact", () => {
    expect(terminalDispositionForArtifact({
      manifest: { ...manifest, deliveryDisposition: "delivered" }, acceptedRisk: false
    })).toBe("completed");
  });
});
