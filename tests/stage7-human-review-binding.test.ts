import { describe, expect, it } from "vitest";
import { RunEventSchema, foldRun } from "@manyhands/run-coordinator";

const at = "2026-08-14T12:00:00.000Z";

describe("Stage 7 human review binding", () => {
  it("marks a review stale when its node produces a later exact candidate", () => {
    const firstCandidate = "a".repeat(40);
    const secondCandidate = "b".repeat(40);
    const state = foldRun([
      event(1, "run.created", { goal: "Review the candidate" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "attempt.started", { attemptId: "attempt-1", nodeId: "node-1", inputFingerprint: "sha256:one", executorProfile: { id: "fake", revision: "1" } }),
      event(5, "attempt.candidate_created", {
        attemptId: "attempt-1", nodeId: "node-1", candidateCommit: firstCandidate, outputDigest: "sha256:one", changedFiles: ["src/a.ts"],
        candidate: { manifestDigest: "sha256:manifest-one", commitOid: firstCandidate, treeOid: "c".repeat(40) }
      }),
      event(6, "human_review.recorded", {
        review: {
          reviewId: "review-1",
          attemptId: "attempt-1",
          nodeId: "node-1",
          candidate: { manifestDigest: "sha256:manifest-one", commitOid: firstCandidate, treeOid: "c".repeat(40) },
          rubricDigest: "sha256:rubric",
          authority: "operator",
          reviewerId: "operator:franc",
          decision: "approved",
          reviewedAt: at
        }
      }),
      event(7, "attempt.started", { attemptId: "attempt-2", nodeId: "node-1", inputFingerprint: "sha256:two", executorProfile: { id: "fake", revision: "1" } }),
      event(8, "attempt.candidate_created", {
        attemptId: "attempt-2", nodeId: "node-1", candidateCommit: secondCandidate, outputDigest: "sha256:two", changedFiles: ["src/a.ts"],
        candidate: { manifestDigest: "sha256:manifest-two", commitOid: secondCandidate, treeOid: "d".repeat(40) }
      })
    ]);

    expect(state.humanReviews["review-1"]).toMatchObject({
      decision: "approved",
      status: "stale",
      candidate: expect.objectContaining({ commitOid: firstCandidate })
    });
  });

  it("requires operator authority for a persisted review", () => {
    expect(() => event(1, "human_review.recorded", {
      review: {
        reviewId: "review-1",
        attemptId: "attempt-1",
        nodeId: "node-1",
        candidate: { manifestDigest: "sha256:manifest-one", commitOid: "a".repeat(40), treeOid: "c".repeat(40) },
        rubricDigest: "sha256:rubric",
        reviewerId: "operator:franc",
        decision: "approved",
        reviewedAt: at
      }
    })).toThrow(/authority/);
  });

  it("rejects a review that changes the retained manifest or tree behind an unchanged commit", () => {
    expect(() => foldRun([
      event(1, "run.created", { goal: "Review the candidate" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "attempt.started", { attemptId: "attempt-1", nodeId: "node-1", inputFingerprint: "sha256:one", executorProfile: { id: "fake", revision: "1" } }),
      event(5, "attempt.candidate_created", {
        attemptId: "attempt-1", nodeId: "node-1", candidateCommit: "a".repeat(40), outputDigest: "sha256:one", changedFiles: ["src/a.ts"],
        candidate: { manifestDigest: "sha256:manifest-one", commitOid: "a".repeat(40), treeOid: "c".repeat(40) }
      }),
      event(6, "human_review.recorded", {
        review: {
          reviewId: "review-1", attemptId: "attempt-1", nodeId: "node-1",
          candidate: { manifestDigest: "sha256:other-manifest", commitOid: "a".repeat(40), treeOid: "d".repeat(40) },
          rubricDigest: "sha256:rubric", authority: "operator", reviewerId: "operator:franc", decision: "approved", reviewedAt: at
        }
      })
    ])).toThrow(/candidate/i);
  });
});

function event(sequence: number, type: string, payload: Record<string, unknown>) {
  return RunEventSchema.parse({
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: at,
    type,
    payload
  });
}
