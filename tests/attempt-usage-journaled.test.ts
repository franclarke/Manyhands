import { describe, expect, it } from "vitest";
import { RunEventSchema } from "@manyhands/run-coordinator";

/**
 * RQ2 asks what a granularity choice costs, so the comparative study cannot
 * answer it unless every attempt records the tokens it consumed. Executor usage
 * reached `AgentExecutionResult` but was dropped before the journal, leaving
 * the durable history — the only evidence a reader can audit — silent about
 * cost.
 *
 * Usage is optional on the event: a provider that reports nothing must still
 * produce a valid journal rather than a fabricated zero, and an absent number
 * has to stay distinguishable from a measured zero.
 */
describe("attempt usage in the durable journal", () => {
  const base = {
    eventId: "run-1:attempt:node-1:1:candidate",
    runId: "run-1",
    sequence: 1,
    occurredAt: "2026-07-24T10:00:00.000Z"
  };

  it("carries the tokens an attempt consumed", () => {
    const parsed = RunEventSchema.safeParse({
      ...base,
      type: "attempt.candidate_created",
      payload: {
        attemptId: "run-1:attempt:node-1:1",
        nodeId: "node-1",
        candidateCommit: "abc123",
        outputDigest: "sha256:abc",
        changedFiles: ["src/a.ts"],
        usage: { tokensIn: 1200, tokensOut: 340, costUsd: 0.02, source: "reported" }
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("records the usage of a failed attempt too", () => {
    // A condition that burns tokens and delivers nothing is exactly the cost
    // the study needs to see; dropping it would flatter the losing condition.
    const parsed = RunEventSchema.safeParse({
      ...base,
      eventId: "run-1:attempt:node-1:1:failed",
      type: "attempt.failed",
      payload: {
        attemptId: "run-1:attempt:node-1:1",
        nodeId: "node-1",
        reason: "scope_violation: changed files outside the declared scope: src/b.ts",
        usage: { tokensIn: 900, tokensOut: 120, source: "reported" }
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("stays valid when the provider reported no usage", () => {
    const parsed = RunEventSchema.safeParse({
      ...base,
      type: "attempt.candidate_created",
      payload: {
        attemptId: "run-1:attempt:node-1:1",
        nodeId: "node-1",
        candidateCommit: "abc123",
        outputDigest: "sha256:abc",
        changedFiles: ["src/a.ts"]
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a usage record that names no provenance", () => {
    // Without `source` a reader cannot tell a provider-reported number from a
    // registry estimate, and the two must never be averaged together.
    const parsed = RunEventSchema.safeParse({
      ...base,
      type: "attempt.candidate_created",
      payload: {
        attemptId: "run-1:attempt:node-1:1",
        nodeId: "node-1",
        candidateCommit: "abc123",
        outputDigest: "sha256:abc",
        changedFiles: ["src/a.ts"],
        usage: { tokensIn: 1200, tokensOut: 340 }
      }
    });

    expect(parsed.success).toBe(false);
  });
});
