import { describe, expect, it } from "vitest";
import {
  computeAttemptFingerprintInvalidation,
  computeInputFingerprint,
  type InputFingerprintSource
} from "@manyhands/run-coordinator";
import { computeExactAttemptInvalidation } from "@manyhands/execution-core";

/** Node-local inputs the driver folds into an independent leaf's fingerprint. */
function independentLeafSource(): InputFingerprintSource {
  return {
    graphId: "graph-under-amendment",
    nodeId: "independent-leaf",
    contractRevisions: [{ id: "task", revision: "r1" }, { id: "scope", revision: "r1" }, { id: "validation", revision: "r1" }],
    baseCommit: "c".repeat(40),
    consumedArtifacts: [],
    repositoryContextDigest: "sha256:repo",
    executorProfile: { id: "claude-default", revision: "r1" },
    validationContract: { id: "validation", revision: "r1" }
  };
}

describe("amendment fingerprint invalidation", () => {
  it("keeps an independent leaf fresh after a foreign amendment bumps the graph revision", () => {
    // A foreign amendment (e.g. a new ArtifactRequirement between two OTHER nodes)
    // raises the global graph revision but leaves this leaf's node-local inputs
    // untouched. The real fingerprint must not change, so its attempt stays fresh.
    const source = independentLeafSource();
    const beforeAmendment = computeInputFingerprint(source);
    const afterForeignAmendment = computeInputFingerprint(independentLeafSource());
    expect(afterForeignAmendment).toBe(beforeAmendment);

    const result = computeAttemptFingerprintInvalidation({
      attempts: [{ attemptId: "attempt-independent", nodeId: source.nodeId, inputFingerprint: beforeAmendment }],
      currentFingerprints: { [source.nodeId]: afterForeignAmendment }
    });
    expect(result.staleAttemptIds).toEqual([]);
    expect(result.freshAttemptIds).toEqual(["attempt-independent"]);
  });


  it("marks only attempts whose complete input fingerprint changed", () => {
    const result = computeAttemptFingerprintInvalidation({
      attempts: [
        { attemptId: "attempt-a", nodeId: "node-a", inputFingerprint: "fingerprint-a" },
        { attemptId: "attempt-b", nodeId: "node-b", inputFingerprint: "fingerprint-b" },
        { attemptId: "attempt-c", nodeId: "node-c", inputFingerprint: "fingerprint-c" }
      ],
      currentFingerprints: {
        "node-a": "fingerprint-a-v2",
        "node-b": "fingerprint-b",
        "node-c": "fingerprint-c"
      }
    });

    expect(result.staleAttemptIds).toEqual(["attempt-a"]);
    expect(result.staleNodeIds).toEqual(["node-a"]);
    expect(result.freshAttemptIds).toEqual(["attempt-b", "attempt-c"]);
  });

  it("does not invalidate an independent leaf merely because graph ancestry changed", () => {
    const result = computeAttemptFingerprintInvalidation({
      attempts: [{ attemptId: "attempt-independent", nodeId: "independent", inputFingerprint: "same-exact-input" }],
      currentFingerprints: { independent: "same-exact-input" }
    });
    expect(result.staleAttemptIds).toEqual([]);
    expect(result.freshAttemptIds).toEqual(["attempt-independent"]);
    expect(computeExactAttemptInvalidation({
      attempts: [{ attemptId: "attempt-independent", nodeId: "independent", inputFingerprint: "same-exact-input" }],
      currentFingerprints: { independent: "same-exact-input" }
    }).staleNodeIds).toEqual(new Set());
  });
});
