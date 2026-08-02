import { describe, expect, it } from "vitest";
import { RunEventSchema, foldRun } from "@manyhands/run-coordinator";

describe("planning candidate decision journal", () => {
  it("reconstructs candidates, diagnostics, scores and the selected winner", () => {
    const state = foldRun([
      event(1, "run.created", { goal: "Build booking" }),
      event(2, "planning.candidates_evaluated", {
        schemaVersion: 1,
        envelope: { repositorySnapshotId: "snapshot-1", goalDigest: "sha256:goal" },
        candidates: [
          {
            candidateId: "candidate-a",
            candidateHash: "sha256:candidate-a",
            candidate: { breakdownId: "breakdown-a" },
            valid: true,
            score: 0.9,
            diagnostics: []
          },
          {
            candidateId: "candidate-b",
            candidateHash: "sha256:candidate-b",
            candidate: { breakdownId: "breakdown-b" },
            valid: false,
            diagnostics: [{ code: "missing_seam_specification", message: "Seam is incomplete.", refs: ["seam-a"] }]
          }
        ],
        selection: { kind: "selected", candidateId: "candidate-a", score: 0.9, rejectedCandidateIds: ["candidate-b"] }
      })
    ]);

    expect(state.planningCandidates).toMatchObject({
      candidates: [
        expect.objectContaining({ candidateId: "candidate-a", valid: true, score: 0.9 }),
        expect.objectContaining({ candidateId: "candidate-b", valid: false, diagnostics: [{ code: "missing_seam_specification" }] })
      ],
      selection: { kind: "selected", candidateId: "candidate-a", rejectedCandidateIds: ["candidate-b"] }
    });
  });

  it("preserves a structured replan diagnosis when no candidate is selectable", () => {
    const eventInput = {
      eventId: "candidates-evaluated",
      runId: "run-replan",
      sequence: 2,
      occurredAt: "2026-08-02T20:00:00.000Z",
      type: "planning.candidates_evaluated" as const,
      payload: {
        schemaVersion: 1 as const,
        envelope: { repositorySnapshotId: "snapshot-1", goalDigest: "sha256:goal" },
        candidates: [{
          candidateId: "candidate-invalid",
          candidateHash: "sha256:candidate-invalid",
          candidate: { breakdownId: "breakdown-invalid" },
          valid: false,
          diagnostics: [{ code: "candidate_not_typed", message: "Candidate metadata is incomplete.", refs: ["candidate"] }]
        }],
        selection: {
          kind: "replan_required" as const,
          reason: "No structurally valid candidate remains.",
          rejectedCandidateIds: ["candidate-invalid"],
          diagnostics: [{ code: "candidate_not_typed", message: "Candidate metadata is incomplete.", refs: ["candidate"] }]
        }
      }
    };

    const parsed = RunEventSchema.parse(eventInput);
    const state = foldRun([
      RunEventSchema.parse({ eventId: "created", runId: "run-replan", sequence: 1, occurredAt: "2026-08-02T20:00:00.000Z", type: "run.created", payload: { goal: "Build booking" } }),
      parsed
    ]);

    expect(state.planningCandidates?.selection).toEqual(eventInput.payload.selection);
    expect(state.planningCandidates?.candidates[0]?.diagnostics[0]?.code).toBe("candidate_not_typed");
  });
});

function event<T extends "run.created" | "planning.candidates_evaluated">(
  sequence: number,
  type: T,
  payload: T extends "run.created"
    ? { goal: string }
    : {
        schemaVersion: 1;
        envelope: Record<string, unknown>;
        candidates: Array<Record<string, unknown>>;
        selection: Record<string, unknown>;
      }
) {
  return RunEventSchema.parse({
    eventId: `${type}-${sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: "2026-08-02T20:00:00.000Z",
    type,
    payload
  });
}
