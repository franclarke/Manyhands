import { describe, expect, it } from "vitest";
import {
  CandidatePlanSchema,
  createPlanningEnvelope,
  selectCandidatePlan,
  validateCandidatePlanSet
} from "@manyhands/decomposer";
import { bookingBreakdown, bookingSnapshot } from "./helpers/target-planning-fixtures";

describe("planning envelope and candidate plans", () => {
  it("keeps acceptance ownership and seam specifications inside the canonical breakdown", () => {
    const breakdown = {
      ...bookingBreakdown(),
      acceptanceOwnership: [{
        intentId: "domain-ready",
        ownerUnitKey: "domain",
        role: "local" as const,
        rationale: "The domain leaf proves the booking rules."
      }],
      seamSpecifications: [{
        seamId: "booking-shape",
        delivery: "contract_only" as const,
        compatibility: "All participants bind the same exact contract revision.",
        validation: "Integration tests exercise producer and consumers."
      }]
    };

    const parsed = CandidatePlanSchema.parse({
      candidateId: "candidate-canonical",
      breakdown
    });

    expect(parsed.breakdown.acceptanceOwnership).toEqual(breakdown.acceptanceOwnership);
    expect(parsed.breakdown.seamSpecifications).toEqual(breakdown.seamSpecifications);
    expect(parsed).not.toHaveProperty("acceptanceOwnership");
    expect(parsed).not.toHaveProperty("seamSpecifications");
  });

  it("creates a deterministic bounded envelope without inventing semantic units", () => {
    const input = {
      policyVersion: "reliability/1.0.0",
      goal: "Deliver the booking flow",
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 3,
      maxLeafPlannedPaths: 12
    };

    const first = createPlanningEnvelope(input);
    const second = createPlanningEnvelope(input);

    expect(second).toEqual(first);
    expect(first.candidateBudget).toEqual({ minimum: 2, maximum: 3 });
    expect(first.executionBudget.maxLeafPlannedPaths).toBe(12);
    expect(first).not.toHaveProperty("units");
    expect(first).not.toHaveProperty("paths");
    expect(first).not.toHaveProperty("seams");
  });

  it("fails closed when deduplication leaves fewer than the requested candidate minimum", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 3
    });

    const validation = validateCandidatePlanSet({
      envelope,
      candidates: [validCandidate("only-candidate", breakdown)]
    });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: "candidate_budget_not_met"
    }));
  });

  it("rejects a producer-files seam without a materialized artifact for every consumer", () => {
    const breakdown = bookingBreakdown();
    const candidate = validCandidate("missing-materialization", breakdown);
    candidate.breakdown.seamSpecifications![0]!.delivery = "producer_files";
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "missing-materialization",
      code: "missing_materialized_seam_artifact",
      refs: ["booking-shape", "api", "ui"]
    }));
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
        breakdown: {
          ...breakdown,
          acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
            intentId: intent.id,
            ownerUnitKey: "domain",
            role: intent.id === "domain-ready" ? "global" as const : "local" as const,
            rationale: "Fixture ownership"
          })),
          seamSpecifications: []
        }
      }]
    });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "global_owner_must_integrate", candidateId: "candidate-invalid-global-owner" })
    ]));
  });

  it("rejects an acceptance intent with owners in more than one role", () => {
    const breakdown = bookingBreakdown();
    const candidate = validCandidate("candidate-duplicate-owner", breakdown);
    candidate.breakdown.acceptanceOwnership!.push({
      intentId: "domain-ready",
      ownerUnitKey: "booking",
      role: "global",
      rationale: "The integration root also claims the same intent."
    });
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "candidate-duplicate-owner",
      code: "duplicate_acceptance_owner",
      refs: ["domain-ready"]
    }));
  });

  it("rejects explicit ownership when the owner unit does not declare the intent", () => {
    const breakdown = bookingBreakdown();
    const candidate = validCandidate("candidate-owner-mismatch", breakdown);
    const ownership = candidate.breakdown.acceptanceOwnership!.find((item) => item.intentId === "domain-ready");
    if (ownership === undefined) throw new Error("expected domain ownership fixture");
    ownership.ownerUnitKey = "api";
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "candidate-owner-mismatch",
      code: "acceptance_owner_missing_intent",
      refs: ["domain-ready", "api"]
    }));
  });

  it("rejects seam ownership that references an unknown seam", () => {
    const breakdown = bookingBreakdown();
    const candidate = validCandidate("candidate-unknown-seam", breakdown);
    const ownership = candidate.breakdown.acceptanceOwnership!.find((item) => item.intentId === "domain-ready");
    if (ownership === undefined) throw new Error("expected domain ownership fixture");
    ownership.ownerUnitKey = "booking";
    ownership.role = "seam";
    ownership.seamId = "missing-seam";
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "candidate-unknown-seam",
      code: "unknown_acceptance_seam",
      refs: ["domain-ready", "missing-seam"]
    }));
  });

  it("rejects seam ownership outside the seam's lowest common ancestor", () => {
    const breakdown = bookingBreakdown();
    const candidate = validCandidate("candidate-wrong-seam-owner", breakdown);
    const ownership = candidate.breakdown.acceptanceOwnership!.find((item) => item.intentId === "domain-ready");
    if (ownership === undefined) throw new Error("expected domain ownership fixture");
    ownership.ownerUnitKey = "domain";
    ownership.role = "seam";
    ownership.seamId = "booking-shape";
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "candidate-wrong-seam-owner",
      code: "seam_owner_must_be_lca",
      refs: ["booking-shape", "booking"]
    }));
  });

  it("rejects a global integration criterion copied into a descendant leaf", () => {
    const breakdown = bookingBreakdown();
    breakdown.acceptanceIntents.push({
      id: "booking-integrated",
      description: "The assembled flow preserves the end-to-end invariant",
      required: true
    });
    breakdown.root.acceptanceIntentIds.push("booking-integrated");
    if (breakdown.root.kind !== "composite") throw new Error("expected composite fixture root");
    breakdown.root.children[0]!.acceptanceIntentIds.push("booking-integrated");
    const candidate = validCandidate("leaked-global", breakdown);
    candidate.breakdown.acceptanceOwnership = candidate.breakdown.acceptanceOwnership!.filter(
      (ownership) => ownership.intentId !== "booking-integrated"
    );
    candidate.breakdown.acceptanceOwnership!.push({
      intentId: "booking-integrated",
      ownerUnitKey: "booking",
      role: "global",
      rationale: "The root integrates the complete flow."
    });
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 1
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "leaked-global",
      code: "global_acceptance_leaked_to_leaf",
      refs: ["booking-integrated", "domain"]
    }));
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
      breakdown: {
        ...breakdown,
        acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
          intentId: intent.id,
          ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
          role: "local" as const,
          rationale: "Fixture ownership"
        })),
        seamSpecifications: [{
          seamId: "booking-shape",
          delivery: "contract_only" as const,
          compatibility: "exact revision and documented semantics",
          validation: "integration test validates producer and both consumers"
        }]
      }
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

  it("never lets a higher policy score override Graph Compiler rejection", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot(),
      maxCandidatePlans: 2
    });
    const rejected = validCandidate("candidate-high-invalid", breakdown);
    const selected = validCandidate("candidate-lower-valid", breakdown);

    const result = selectCandidatePlan({
      envelope,
      candidates: [rejected, selected],
      compilerResults: {
        "candidate-high-invalid": {
          approvable: false,
          diagnostics: ["contested_planned_output: two leaves own the same file"]
        },
        "candidate-lower-valid": { approvable: true, diagnostics: [] }
      },
      score(candidatePlan) {
        return candidatePlan.candidateId === "candidate-high-invalid" ? 0.9 : 0.4;
      }
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("expected a selected candidate");
    expect(result.candidate.candidateId).toBe("candidate-lower-valid");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      candidateId: "candidate-high-invalid",
      code: "compiler_rejected"
    }));
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
        breakdown: { ...breakdown, acceptanceOwnership: [], seamSpecifications: [] }
      }],
      score: () => 1
    });

    expect(result).toMatchObject({
      kind: "replan_required",
      diagnosis: { code: "acceptance_ownership_incomplete", rejectedCandidateIds: ["candidate-unowned"] }
    });
  });
});

function validCandidate(candidateId: string, breakdown: ReturnType<typeof bookingBreakdown>) {
  return {
    candidateId,
    breakdown: {
      ...breakdown,
      acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
        intentId: intent.id,
        ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
        role: "local" as const,
        rationale: "Fixture ownership"
      })),
      seamSpecifications: [{
        seamId: "booking-shape",
        delivery: "contract_only" as const,
        compatibility: "exact revision and documented semantics",
        validation: "integration test validates producer and both consumers"
      }]
    }
  };
}
