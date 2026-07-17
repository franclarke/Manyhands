import { describe, expect, it } from "vitest";
import { computeAttemptFingerprintInvalidation } from "@manyhands/run-coordinator";
import { computeExactAttemptInvalidation } from "@manyhands/execution-core";

describe("amendment fingerprint invalidation", () => {
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
