import { describe, expect, it } from "vitest";
import { computeInputFingerprint, type InputFingerprintSource } from "@manyhands/run-coordinator";

const source: InputFingerprintSource = {
  graphId: "graph-1",
  nodeId: "node-1",
  contractRevisions: [{ id: "task", revision: "r2" }, { id: "scope", revision: "r4" }, { id: "artifact", revision: "r1" }],
  baseCommit: "a".repeat(40),
  consumedArtifacts: [{ id: "schema", digest: "sha256:111" }, { id: "types", digest: "sha256:222" }],
  repositoryContextDigest: "sha256:repo",
  executorProfile: { id: "claude-default", revision: "r5" },
  validationContract: { id: "validation-1", revision: "r2" }
};

describe("InputFingerprint", () => {
  it("changes when any node-local eligibility input changes", () => {
    const baseline = computeInputFingerprint(source);
    const variants: InputFingerprintSource[] = [
      { ...source, graphId: "graph-2" },
      { ...source, nodeId: "node-2" },
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

  it("does not fold the global graph revision into node identity", () => {
    // A11/A6: a foreign amendment bumps the graph revision but leaves an
    // independent node's inputs untouched. The fingerprint must therefore be a
    // pure function of node-local inputs — the revision is provenance, not input.
    // The source shape deliberately has no revision field to make this structural.
    expect(Object.keys(source)).not.toContain("graph");
    expect(computeInputFingerprint(source)).toBe(computeInputFingerprint({ ...source }));
  });

  it("is stable when set-like inputs are reordered", () => {
    expect(computeInputFingerprint(source)).toBe(computeInputFingerprint({
      ...source,
      contractRevisions: [...source.contractRevisions].reverse(),
      consumedArtifacts: [...source.consumedArtifacts].reverse()
    }));
  });
});
