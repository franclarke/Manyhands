import { describe, expect, it } from "vitest";
import { computeInputFingerprint, type InputFingerprintSource } from "@manyhands/run-coordinator";

const source: InputFingerprintSource = {
  graph: { id: "graph-1", revision: 3 },
  nodeId: "node-1",
  contractRevisions: [{ id: "task", revision: "r2" }, { id: "scope", revision: "r4" }, { id: "artifact", revision: "r1" }],
  baseCommit: "a".repeat(40),
  consumedArtifacts: [{ id: "schema", digest: "sha256:111" }, { id: "types", digest: "sha256:222" }],
  repositoryContextDigest: "sha256:repo",
  executorProfile: { id: "claude-default", revision: "r5" },
  validationContract: { id: "validation-1", revision: "r2" }
};

describe("InputFingerprint", () => {
  it("changes when any eligibility input changes", () => {
    const baseline = computeInputFingerprint(source);
    const variants: InputFingerprintSource[] = [
      { ...source, nodeId: "node-2" },
      { ...source, graph: { ...source.graph, revision: 4 } },
      { ...source, contractRevisions: source.contractRevisions.map((item, index) => index === 0 ? { ...item, revision: "r3" } : item) },
      { ...source, baseCommit: "b".repeat(40) },
      { ...source, consumedArtifacts: source.consumedArtifacts.map((item, index) => index === 0 ? { ...item, digest: "sha256:changed" } : item) },
      { ...source, repositoryContextDigest: "sha256:changed" },
      { ...source, executorProfile: { ...source.executorProfile, revision: "r6" } },
      { ...source, validationContract: { ...source.validationContract, revision: "r3" } }
    ];
    expect(new Set(variants.map(computeInputFingerprint))).not.toContain(baseline);
    expect(new Set(variants.map(computeInputFingerprint)).size).toBe(variants.length);
  });

  it("is stable when set-like inputs are reordered", () => {
    expect(computeInputFingerprint(source)).toBe(computeInputFingerprint({
      ...source,
      contractRevisions: [...source.contractRevisions].reverse(),
      consumedArtifacts: [...source.consumedArtifacts].reverse()
    }));
  });
});
