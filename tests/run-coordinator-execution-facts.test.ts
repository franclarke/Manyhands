import { describe, expect, it } from "vitest";
import {
  RunEventSchema,
  foldRun,
  type RunEvent
} from "@manyhands/run-coordinator";

const at = "2026-07-17T12:00:00.000Z";

function event(sequence: number, type: string, payload: Record<string, unknown>): RunEvent {
  return RunEventSchema.parse({
    eventId: `event-${sequence}`,
    runId: "run-v2",
    sequence,
    occurredAt: at,
    type,
    payload
  });
}

function approvedPrefix(): RunEvent[] {
  return [
    event(1, "run.created", { goal: "Build booking" }),
    event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
    event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 })
  ];
}

describe("canonical V2 execution facts", () => {
  it("folds an attempt, exact validation and artifact adoption without a second status writer", () => {
    const matrix = {
      matrixId: "matrix-node-a",
      candidateCommit: "a".repeat(40),
      validationContract: { id: "validation-node-a", revision: "revision-1" },
      criteria: [{
        criterionId: "criterion-a",
        obligationId: "obligation-a",
        status: "satisfied",
        justification: "The exact candidate passed.",
        evidenceRefs: ["evidence-a"]
      }],
      outcome: "verified"
    };
    const artifact = {
      schemaVersion: 1,
      artifactId: "artifact-node-a",
      runId: "run-v2",
      nodeId: "node-a",
      digest: "sha256:artifact-a",
      producerAttemptId: "attempt-a",
      contract: { id: "artifact-contract-a", revision: "revision-1" },
      kind: "commit",
      location: "a".repeat(40),
      adoptedAt: at
    };
    const state = foldRun([
      ...approvedPrefix(),
      event(4, "attempt.started", {
        attemptId: "attempt-a",
        nodeId: "node-a",
        inputFingerprint: "sha256:input-a",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" }
      }),
      event(5, "attempt.candidate_created", {
        attemptId: "attempt-a",
        nodeId: "node-a",
        candidateCommit: "a".repeat(40),
        outputDigest: "sha256:artifact-a",
        changedFiles: ["src/a.ts"]
      }),
      event(6, "validation.completed", { attemptId: "attempt-a", nodeId: "node-a", matrix }),
      event(7, "artifact.adopted", { artifact })
    ]);

    expect(state.attempts["attempt-a"]).toMatchObject({ status: "adopted", candidateCommit: "a".repeat(40) });
    expect(state.adoptedArtifacts["artifact-node-a"]).toEqual(artifact);
    expect(state.nodeEvidenceMatrixIds["node-a"]).toBe("matrix-node-a");
    expect(state.lifecycle).toBe("running");
  });

  it("records a non-convergent integration as a local decision instead of failing the run", () => {
    const decision = {
      id: "decision-integration-a",
      kind: "resolve_conflict",
      question: "How should the integration conflict be resolved?",
      options: [
        { id: "retry", label: "Retry with guidance" },
        { id: "stop", label: "Stop this integration" }
      ],
      affectedNodeIds: ["composite-a"],
      evidenceRefs: ["integration-manifest-a"],
      impact: "behavior"
    };
    const state = foldRun([
      ...approvedPrefix(),
      event(4, "integration.started", {
        attemptId: "attempt-integration-a",
        nodeId: "composite-a",
        inputFingerprint: "sha256:integration-input-a",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" },
        requiredArtifactIds: ["artifact-child-a", "artifact-child-b"]
      }),
      event(5, "integration.failed", {
        attemptId: "attempt-integration-a",
        nodeId: "composite-a",
        manifestId: "integration-manifest-a",
        reason: "Semantic repair did not converge.",
        decisionRequired: true
      }),
      event(6, "decision.raised", { decision })
    ]);

    expect(state.integrations["composite-a"]).toMatchObject({ status: "decision_required" });
    expect(state.decisions[decision.id]?.status).toBe("pending");
    expect(state.lifecycle).toBe("running");
  });
});
