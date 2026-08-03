import { describe, expect, it } from "vitest";
import {
  createCandidatePlan,
  createPlanningEnvelope,
  selectCandidatePlan,
  selectPlannerCandidate,
  validateCandidatePlanSet,
  type AcceptanceOwnership
} from "@manyhands/decomposer";
import { bookingBreakdown, bookingSnapshot } from "./helpers/target-planning-fixtures";

describe("planning envelope and candidate plans", () => {
  it("freezes the candidate identity, scopes, acceptance criteria, seams and obligations", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });

    const candidate = createCandidatePlan({
      envelope,
      candidateId: "candidate-booking-a",
      breakdown,
      scopes: [
        { unitKey: "domain", paths: ["src/domain/booking.ts"] },
        { unitKey: "api", paths: ["src/api/bookings.ts"] },
        { unitKey: "ui", paths: ["src/ui/BookingForm.tsx"] }
      ],
      acceptanceCriteria: breakdown.acceptanceIntents.map((intent) => ({
        intentId: intent.id,
        kind: "leafAcceptance" as const,
        description: intent.description
      })),
      acceptanceOwnership: breakdown.acceptanceIntents.map((intent) => ({
        intentId: intent.id,
        ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
        role: "local" as const,
        rationale: "The leaf owns and proves its local criterion."
      })),
      seamSpecifications: [{
        seamId: "booking-shape",
        producerUnitKey: "domain",
        consumerUnitKeys: ["api", "ui"],
        compatibility: "Both consumers use the same booking shape revision.",
        materialization: "files" as const,
        validation: "An integration test validates the producer and both consumers."
      }],
      contractObligations: [{
        obligationId: "booking-shape-obligation",
        kind: "cross_layer_contract" as const,
        ownerUnitKey: "domain",
        producerUnitKey: "domain",
        consumerUnitKeys: ["api", "ui"],
        validation: "The contract compatibility test passes."
      }],
      leafValidations: [
        { unitKey: "domain", command: "pnpm test --filter domain", evidenceRefs: ["tests/domain.test.ts"] },
        { unitKey: "api", command: "pnpm test --filter api", evidenceRefs: ["tests/api.test.ts"] },
        { unitKey: "ui", command: "pnpm test --filter ui", evidenceRefs: ["tests/ui.test.ts"] }
      ]
    });

    expect(candidate).toMatchObject({
      candidateId: "candidate-booking-a",
      repositorySnapshotId: envelope.repositorySnapshotId,
      goalDigest: envelope.goalDigest,
      scopes: expect.any(Array),
      candidateHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
    expect(candidate.acceptanceCriteria[0]).toMatchObject({ kind: "leafAcceptance" });
    expect(candidate.seamSpecifications[0]).toMatchObject({
      producerUnitKey: "domain",
      consumerUnitKeys: ["api", "ui"],
      materialization: "files"
    });
    expect(candidate.contractObligations[0]).toMatchObject({ kind: "cross_layer_contract" });
  });

  it("does not select raw WorkBreakdown values without explicit candidate ownership and seams", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });
    const score = () => {
      throw new Error("raw WorkBreakdown must never reach policy scoring");
    };

    const result = selectPlannerCandidate({
      envelope,
      candidates: [breakdown, { ...breakdown, breakdownId: "booking-breakdown-2" }],
      score
    });

    expect(result).toMatchObject({ kind: "replan_required" });
    if (result.kind !== "replan_required") throw new Error("expected raw planner values to be rejected");
    expect(result.diagnosis.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "candidate_not_typed" })
    ]));
  });

  it("rejects a typed candidate when a leaf has no observable validation", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({
      policyVersion: "reliability/1.0.0",
      goal: breakdown.objective,
      repositorySnapshot: bookingSnapshot()
    });

    const validation = validateCandidatePlanSet({
      envelope,
      candidates: [candidateFor(envelope, breakdown, "candidate-without-validation", undefined, [])]
    });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "leaf_validation_incomplete", candidateId: "candidate-without-validation" })
    ]));
  });

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
      candidates: [candidateFor(envelope, breakdown, "candidate-invalid-global-owner", breakdown.acceptanceIntents.map((intent) => ({
        intentId: intent.id,
        ownerUnitKey: "domain",
        role: intent.id === "domain-ready" ? "global" as const : "local" as const,
        rationale: "Fixture ownership"
      })))]
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
    const candidate = (candidateId: string) => candidateFor(envelope, breakdown, candidateId);

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
      candidates: [candidateFor(envelope, breakdown, "candidate-unowned", [])],
      score: () => 1
    });

    expect(result).toMatchObject({
      kind: "replan_required",
      diagnosis: { code: "acceptance_ownership_incomplete", rejectedCandidateIds: ["candidate-unowned"] }
    });
  });

  it("rejects a scope path that is neither grounded evidence nor explicitly planned", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({ policyVersion: "reliability/1.0.0", goal: breakdown.objective, repositorySnapshot: bookingSnapshot() });
    const candidate = candidateFor(envelope, breakdown, "candidate-ungrounded-scope");
    candidate.scopes[0]!.paths.push("src/invented.ts");

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "scope_outside_grounding", candidateId: candidate.candidateId })
    ]));
  });

  it("rejects a criterion kind whose explicit ownership role is incompatible", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({ policyVersion: "reliability/1.0.0", goal: breakdown.objective, repositorySnapshot: bookingSnapshot() });
    const candidate = candidateFor(envelope, breakdown, "candidate-role-mismatch");
    candidate.acceptanceCriteria[0]!.kind = "globalAcceptance";

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "acceptance_role_mismatch", candidateId: candidate.candidateId })
    ]));
  });

  it("rejects a cross-layer seam without a matching contract obligation", () => {
    const breakdown = bookingBreakdown();
    const envelope = createPlanningEnvelope({ policyVersion: "reliability/1.0.0", goal: breakdown.objective, repositorySnapshot: bookingSnapshot() });
    const candidate = candidateFor(envelope, breakdown, "candidate-missing-contract");
    candidate.contractObligations = [];

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "contract_obligation_incomplete", candidateId: candidate.candidateId })
    ]));
  });

  it("rejects a semantic dependency represented only by shared scope paths", () => {
    const breakdown = bookingBreakdown();
    if (breakdown.root.kind !== "composite") throw new Error("Expected composite booking fixture.");
    breakdown.root.children.find((unit) => unit.key === "api")!.evidenceIds.push("domain-path");
    const envelope = createPlanningEnvelope({ policyVersion: "reliability/1.0.0", goal: breakdown.objective, repositorySnapshot: bookingSnapshot() });
    const candidate = candidateFor(envelope, breakdown, "candidate-path-dependency");
    candidate.contractObligations.push({
      obligationId: "domain-before-api",
      kind: "artifact_requirement",
      ownerUnitKey: "domain",
      producerUnitKey: "domain",
      consumerUnitKeys: ["api"],
      validation: "API validation consumes the domain output."
    });

    const validation = validateCandidatePlanSet({ envelope, candidates: [candidate] });

    expect(validation.validCandidates).toEqual([]);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "semantic_dependency_without_seam", candidateId: candidate.candidateId })
    ]));
  });
});

function candidateFor(
  envelope: ReturnType<typeof createPlanningEnvelope>,
  breakdown: ReturnType<typeof bookingBreakdown>,
  candidateId: string,
  acceptanceOwnership: AcceptanceOwnership[] = breakdown.acceptanceIntents.map((intent) => ({
    intentId: intent.id,
    ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
    role: "local" as const,
    rationale: "Each leaf owns and proves its local acceptance criterion."
  })),
  leafValidations = breakdown.root.kind === "leaf" ? [] : breakdown.root.children.map((unit) => ({
    unitKey: unit.key,
    command: `pnpm test --filter ${unit.key}`,
    evidenceRefs: [`tests/${unit.key}.test.ts`]
  }))
) {
  const evidenceById = new Map(breakdown.repositoryEvidence.map((evidence) => [evidence.id, evidence.reference]));
  const leaves = flatten(breakdown.root).filter((unit) => unit.kind === "leaf");
  return createCandidatePlan({
    envelope,
    candidateId,
    breakdown,
    scopes: leaves.map((unit) => ({
      unitKey: unit.key,
      paths: unit.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter((path): path is string => path !== undefined)
    })),
    acceptanceCriteria: breakdown.acceptanceIntents.map((intent) => ({
      intentId: intent.id,
      kind: "leafAcceptance" as const,
      description: intent.description
    })),
    acceptanceOwnership,
    seamSpecifications: breakdown.candidateSeams.map((seam) => ({
      seamId: seam.id,
      producerUnitKey: seam.producerUnitKey,
      consumerUnitKeys: seam.consumerUnitKeys,
      compatibility: "exact revision and documented semantics",
      materialization: "files" as const,
      validation: "integration test validates producer and every consumer"
    })),
    contractObligations: breakdown.candidateSeams.map((seam) => ({
      obligationId: `${seam.id}-obligation`,
      kind: "cross_layer_contract" as const,
      ownerUnitKey: seam.producerUnitKey,
      producerUnitKey: seam.producerUnitKey,
      consumerUnitKeys: seam.consumerUnitKeys,
      validation: "integration test validates the contract compatibility"
    })),
    leafValidations
  });
}

function flatten(root: ReturnType<typeof bookingBreakdown>["root"]): Array<ReturnType<typeof bookingBreakdown>["root"]> {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flatten)];
}
