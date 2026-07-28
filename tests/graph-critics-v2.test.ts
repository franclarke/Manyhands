import { describe, expect, it } from "vitest";
import {
  assertPlanReview,
  compileGraphRevision,
  reviewCompiledPlan
} from "@manyhands/decomposer";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

const criticKinds = [
  "completeness",
  "atomicity",
  "contract_compatibility",
  "dag_validity",
  "scope_isolation",
  "artifact_coverage",
  "risk_uncertainty",
  "validation_coverage"
];

describe("Graph critics V2", () => {
  it("runs every required critic and returns structured findings", () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    expect(compiled.review.checkedCritics).toEqual(criticKinds);
    expect(compiled.review.findings.every((finding) =>
      typeof finding.code === "string"
      && typeof finding.message === "string"
      && typeof finding.repair === "string"
      && Array.isArray(finding.evidenceIds)
    )).toBe(true);
  });

  it("rejects missing validation coverage and an output with no consumer", () => {
    const breakdown = bookingBreakdown();
    breakdown.candidateArtifacts.push({
      id: "orphan-report",
      artifactType: "report",
      producerUnitKey: "domain",
      consumerUnitKeys: ["api"],
      purpose: "Temporary report",
      materializationHint: "logical",
      evidenceIds: ["domain-path"]
    });
    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const domain = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain");
    if (domain === undefined) throw new Error("Missing domain contract");
    domain.validation.obligations = [];
    const orphan = domain.artifacts.find((artifact) => artifact.artifactType === "report");
    if (orphan === undefined) throw new Error("Missing report artifact");
    orphan.consumerNodeIds = [];

    const review = reviewCompiledPlan({
      breakdown,
      repositorySnapshot: bookingSnapshot(),
      graph: compiled.graph,
      contracts: compiled.contracts
    });

    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ critic: "validation_coverage", severity: "error" }),
      expect.objectContaining({ critic: "artifact_coverage", severity: "error", contractId: orphan.id })
    ]));
    expect(() => assertPlanReview(review)).toThrow(/validation|artifact/i);
  });

  /**
   * Wide-graph N=16 is why this exists. The planner gave all sixteen projection
   * leaves the same planned output, `src/analytics/projections.test.ts`. The
   * compiler saw the overlap and emitted a conflict constraint for each of the
   * C(16,2)=120 pairs at `high` risk, and the critic treated those constraints
   * as the remedy, so review passed. A constraint serializes access to a shared
   * path; it cannot reconcile two units that each commit their own full version
   * of one file. Nineteen leaves verified, then bottom-up integration had to
   * cherry-pick sixteen incompatible versions of that file and the run died.
   */
  it("rejects a planned output claimed by more than one unit", () => {
    const breakdown = bookingBreakdown();
    const children = breakdown.root.kind === "composite" ? breakdown.root.children : [];
    const api = children.find((unit) => unit.key === "api");
    const ui = children.find((unit) => unit.key === "ui");
    if (api === undefined || ui === undefined) throw new Error("Missing booking leaves");
    api.plannedPaths = [...(api.plannedPaths ?? []), "src/booking/shared.test.ts"];
    ui.plannedPaths = [...(ui.plannedPaths ?? []), "src/booking/shared.test.ts"];

    expect(() => compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies))
      .toThrow(/contested_planned_output|declare src\/booking\/shared\.test\.ts/u);
  });

  it("allows a composite to summarize planned outputs owned by its descendants", () => {
    const breakdown = bookingBreakdown();
    if (breakdown.root.kind !== "composite") throw new Error("Expected composite booking root");
    for (const child of breakdown.root.children) {
      child.plannedPaths = [`src/booking/${child.key}.test.ts`];
    }
    breakdown.root.plannedPaths = [...new Set(
      breakdown.root.children.flatMap((child) => child.plannedPaths ?? [])
    )];

    const compiled = compileGraphRevision({
      breakdown,
      repositorySnapshot: bookingSnapshot()
    }, compilerDependencies);

    expect(compiled.review.findings.filter((item) => item.code === "contested_planned_output")).toEqual([]);
  });

  /**
   * The overlap was always modelled; treating the constraint as a remedy is what
   * let it through. This pins that the constraint still gets emitted, so the
   * rejection above comes from contested ownership and not from the compiler
   * having stopped seeing the conflict.
   */
  it("still models the pairwise conflict it now refuses to accept as a remedy", () => {
    const breakdown = bookingBreakdown();
    const children = breakdown.root.kind === "composite" ? breakdown.root.children : [];
    const api = children.find((unit) => unit.key === "api");
    const ui = children.find((unit) => unit.key === "ui");
    if (api === undefined || ui === undefined) throw new Error("Missing booking leaves");
    api.plannedPaths = [...(api.plannedPaths ?? []), "src/booking/api-only.test.ts"];
    ui.plannedPaths = [...(ui.plannedPaths ?? []), "src/booking/ui-only.test.ts"];

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    expect(compiled.review.findings.filter((item) => item.code === "contested_planned_output")).toEqual([]);
  });

  it("keeps a plan whose units each own their planned outputs", () => {
    const breakdown = bookingBreakdown();
    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    const review = reviewCompiledPlan({
      breakdown,
      repositorySnapshot: bookingSnapshot(),
      graph: compiled.graph,
      contracts: compiled.contracts
    });

    expect(review.findings.filter((item) => item.critic === "scope_isolation" && item.severity === "error")).toEqual([]);
  });

  it("blocks unresolved consequential questions instead of compiling false certainty", () => {
    const breakdown = bookingBreakdown();
    breakdown.questions.push({
      id: "overlap-policy",
      question: "Can bookings overlap?",
      reason: "It changes validation behavior",
      impact: "behavior",
      options: ["Reject", "Allow"],
      evidenceIds: ["domain-path"]
    });

    expect(() => compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies)).toThrow(/unresolved|question/i);
  });
});
