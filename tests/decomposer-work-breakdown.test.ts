import { describe, expect, it, vi } from "vitest";
import {
  WorkBreakdownPlanner,
  WorkBreakdownSchema,
  buildWorkBreakdownPrompt,
  type WorkBreakdown
} from "@manyhands/decomposer";

describe("WorkBreakdown", () => {
  it("accepts a hybrid vertical leaf that crosses UI, API and tests", () => {
    const breakdown = fixture();
    expect(WorkBreakdownSchema.parse(breakdown).root.children[0]).toMatchObject({
      kind: "leaf",
      concerns: ["ui", "api", "tests"]
    });
  });

  it.each(["targetDepth", "maxChildren", "dependencies", "worktreePath", "commands", "executorProfile"])(
    "rejects executable or template field %s",
    (field) => {
      const breakdown = fixture() as WorkBreakdown & Record<string, unknown>;
      breakdown[field] = field === "commands" ? ["pnpm test"] : 3;
      expect(WorkBreakdownSchema.safeParse(breakdown).success).toBe(false);
    }
  );

  it("preserves a relevant human question and the repository evidence behind it", () => {
    const breakdown = WorkBreakdownSchema.parse(fixture());
    expect(breakdown.repositoryEvidence).toContainEqual(
      expect.objectContaining({ id: "route-evidence", kind: "path", reference: "src/routes/bookings.ts" })
    );
    expect(breakdown.questions).toContainEqual(
      expect.objectContaining({
        id: "booking-policy",
        question: "Can a booking overlap an existing booking?",
        evidenceIds: ["route-evidence"],
        impact: "behavior"
      })
    );
  });

  it("uses bounded schema repair and cache without falling back to a synthetic plan", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 2, objective: "incomplete" })
      .mockResolvedValueOnce(fixture());
    const cache = new Map<string, WorkBreakdown>();
    const planner = new WorkBreakdownPlanner({ model: { generate }, maxAttempts: 2, cache, retryDelayMs: 0 });
    const input = plannerInput();

    const first = await planner.plan(input);
    const second = await planner.plan(input);

    expect(first).toEqual(fixture());
    expect(second).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toMatchObject({ repairIssues: expect.arrayContaining([expect.stringContaining("root")]) });

    const failing = new WorkBreakdownPlanner({
      model: { generate: vi.fn().mockResolvedValue({ not: "a breakdown" }) },
      maxAttempts: 2,
      retryDelayMs: 0
    });
    await expect(failing.plan(input)).rejects.toThrow(/after 2 attempts/i);
  });

  it("prompts for semantic cuts without imposing graph shape or executable details", () => {
    const prompt = buildWorkBreakdownPrompt(plannerInput());
    expect(prompt.system).toContain("hybrid vertical slice");
    expect(prompt.system).toContain("Do not emit worktrees, exact commands, executor profiles, or generic dependency edges");
    expect(prompt.system).toContain("Do not target a fixed depth, child count, or layer template");
    expect(prompt.system).toContain('"candidateArtifacts"');
    expect(prompt.user).toContain("src/routes/bookings.ts");
    expect(prompt.user).toContain("repository snapshot snapshot-1");
  });
});

function plannerInput() {
  return {
    goal: "Add booking creation",
    acceptanceCriteria: ["A visitor can create a valid booking"],
    constraints: ["Keep the existing route structure"],
    repositorySnapshot: {
      snapshotId: "snapshot-1",
      inspectionDisposition: "complete" as const,
      evidence: [{ id: "route-evidence", kind: "path" as const, reference: "src/routes/bookings.ts", observation: "Existing booking route", confidence: 1 }]
    }
  };
}

function fixture(): WorkBreakdown {
  return {
    schemaVersion: 2,
    breakdownId: "booking-breakdown",
    objective: "Allow a visitor to create a booking",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [{ id: "booking-created", description: "A valid booking is stored and shown", required: true }],
    root: {
      key: "booking-feature",
      kind: "composite",
      title: "Booking creation",
      objective: "Deliver booking creation end to end",
      concerns: ["product-flow"],
      expectedOutcomes: ["A usable booking flow"],
      acceptanceIntentIds: ["booking-created"],
      cut: { criterion: "cohesion", rationale: "Keep the observable flow together while isolating policy." },
      children: [
        {
          key: "booking-flow",
          kind: "leaf",
          title: "Create a booking",
          objective: "Implement the cohesive booking flow",
          concerns: ["ui", "api", "tests"],
          expectedOutcomes: ["The form submits and renders the stored booking"],
          acceptanceIntentIds: ["booking-created"]
        },
        {
          key: "booking-policy",
          kind: "leaf",
          title: "Booking policy",
          objective: "Define overlap behavior after the user decides it",
          concerns: ["domain"],
          expectedOutcomes: ["Overlap rules are explicit"],
          acceptanceIntentIds: ["booking-created"]
        }
      ]
    },
    candidateArtifacts: [{
      id: "booking-record",
      artifactType: "domain-model",
      producerUnitKey: "booking-policy",
      consumerUnitKeys: ["booking-flow"],
      purpose: "Share the booking representation",
      materializationHint: "logical",
      evidenceIds: ["route-evidence"]
    }],
    candidateSeams: [{
      id: "booking-contract",
      kind: "type",
      specification: "Booking data required by the flow",
      producerUnitKey: "booking-policy",
      consumerUnitKeys: ["booking-flow"],
      evidenceIds: ["route-evidence"]
    }],
    repositoryEvidence: [{
      id: "route-evidence",
      kind: "path",
      reference: "src/routes/bookings.ts",
      observation: "Existing booking route",
      confidence: 1
    }],
    uncertainties: [{
      id: "overlap-unknown",
      description: "Overlap policy is unspecified",
      impact: "Changes validation and persistence behavior",
      requiresHumanDecision: true,
      evidenceIds: ["route-evidence"]
    }],
    questions: [{
      id: "booking-policy",
      question: "Can a booking overlap an existing booking?",
      reason: "The answer changes observable validation behavior",
      impact: "behavior",
      options: ["Reject overlap", "Allow overlap"],
      evidenceIds: ["route-evidence"]
    }]
  };
}
