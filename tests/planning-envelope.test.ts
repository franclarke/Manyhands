import { describe, expect, it } from "vitest";
import {
  createPlanningEnvelope,
  selectCandidatePlan,
  validateCandidatePlanSet
} from "@manyhands/decomposer";
import { bookingBreakdown, bookingSnapshot } from "./helpers/target-planning-fixtures";

describe("planning envelope and candidate plans", () => {
  it("creates a deterministic bounded envelope without inventing semantic units", () => {
    const input = {
      policyVersion: "reliability/1.0.0",
      goal: "Deliver the booking flow",
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 3
    };

    const first = createPlanningEnvelope(input);
    const second = createPlanningEnvelope(input);

    expect(second).toEqual(first);
    expect(first.candidateBudget).toEqual({ minimum: 2, maximum: 3 });
    expect(first).not.toHaveProperty("units");
    expect(first).not.toHaveProperty("paths");
    expect(first).not.toHaveProperty("seams");
  });

  it("rejects a candidate that assigns a global criterion to a leaf", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });

    const validation = validateCandidatePlanSet({
      envelope,
      candidates: [{
        candidateId: "candidate-invalid-global-owner",
        breakdown,
        acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
          intentId: intent.id,
          ownerUnitKey: "domain",
          role: intent.id === "domain-ready" ? "global" : "local",
          rationale: "Fixture ownership"
        })),
        seamSpecifications: []
      }]
    });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "candidate_budget_not_met" }),
      expect.objectContaining({ code: "global_owner_must_integrate", candidateId: "candidate-invalid-global-owner" })
    ]));
  });

  it("selects deterministically only among structurally valid candidates", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });
    const candidate = (candidateId: string) => ({
      candidateId,
      breakdown,
      acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
        intentId: intent.id,
        ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
        role: "local" as const,
        rationale: "Fixture ownership"
      })),
      seamSpecifications: [{
        seamId: "booking-shape",
        compatibility: "exact revision and documented semantics",
        validation: "integration test validates producer and both consumers"
      }]
    });

    const result = selectCandidatePlan({
      envelope,
      candidates: [candidate("candidate-b"), candidate("candidate-a")],
      score(candidatePlan) {
        return candidatePlan.candidateId === "candidate-a" ? 0.8 : 0.6;
      }
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("expected a selected candidate");
    expect(result.candidate.candidateId).toBe("candidate-a");
    expect(result.rejectedCandidateIds).toEqual(["candidate-b"]);
  });

  it("returns a preserved, concrete replan diagnosis when every candidate fails ownership", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });

    const result = selectCandidatePlan({
      envelope,
      candidates: [{
        candidateId: "candidate-unowned",
        breakdown,
        acceptanceOwnership: [],
        seamSpecifications: []
      }],
      score: () => 1
    });

    expect(result).toMatchObject({
      kind: "replan_required",
      diagnosis: { code: "acceptance_ownership_incomplete", rejectedCandidateIds: ["candidate-unowned"] }
    });
  });
});
