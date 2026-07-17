import { describe, expect, it } from "vitest";
import {
  compileGraphRevision,
  type WorkBreakdown
} from "@manyhands/decomposer";
import { TaskContractBundleSchema } from "@manyhands/contracts";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

describe("Graph Compiler V2", () => {
  it("compiles identical semantic input deterministically with injected identity and clock", () => {
    const input = { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() };
    const first = compileGraphRevision(input, compilerDependencies);
    const second = compileGraphRevision(input, compilerDependencies);

    expect(second).toEqual(first);
    expect(first.graph.revision).toBe(1);
    expect(first.graph.repositorySnapshotId).toBe(input.breakdown.repositorySnapshotId);
    expect(first.contracts).toHaveLength(4);
    expect(first.contracts.every((bundle) => TaskContractBundleSchema.safeParse(bundle).success)).toBe(true);
    expect(first.review.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("compiles a seam across three siblings without turning it into artifact readiness", () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );

    expect(compiled.graph.seamBindings).toHaveLength(2);
    expect(compiled.graph.seamBindings.map((binding) => binding.consumerNodeId).sort()).toEqual(["node-api", "node-ui"]);
    expect(compiled.graph.artifactRequirements.filter((requirement) => requirement.requiredFor === "execution")).toEqual([]);
    expect(compiled.trace.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "candidate_seam", sourceId: "booking-shape", evidenceIds: ["domain-path", "api-path", "ui-path"] })
      ])
    );
  });

  it("creates artifact readiness only for a materialized producer output", () => {
    const breakdown = bookingBreakdown();
    breakdown.candidateArtifacts.push({
      id: "booking-model-files",
      artifactType: "source-module",
      producerUnitKey: "domain",
      consumerUnitKeys: ["api"],
      purpose: "The API compiles against the domain module",
      materializationHint: "files",
      evidenceIds: ["domain-path", "api-path"]
    });

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    expect(compiled.graph.artifactRequirements.filter((requirement) => requirement.requiredFor === "execution")).toEqual([
      expect.objectContaining({ producerNodeId: "node-domain", consumerNodeId: "node-api", requiredFor: "execution" })
    ]);
    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")?.task.produces).toHaveLength(2);
    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-api")?.task.consumes).toHaveLength(1);
  });

  it("compiles executable contracts and explicit bottom-up artifacts for composites", () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );

    const root = compiled.contracts.find((bundle) => bundle.task.nodeId === compiled.graph.rootId);
    expect(root).toBeDefined();
    expect(root?.scope.allowedPaths).toEqual([
      "src/api/bookings.ts",
      "src/domain/booking.ts",
      "src/ui/BookingForm.tsx"
    ]);
    expect(root?.task.consumes).toHaveLength(3);
    expect(root?.task.produces).toEqual([
      expect.objectContaining({ id: "artifact-contract-booking-output" })
    ]);

    const integrationRequirements = compiled.graph.artifactRequirements.filter(
      (requirement) => requirement.requiredFor === "integration"
    );
    expect(integrationRequirements).toHaveLength(3);
    expect(integrationRequirements.map((requirement) => requirement.consumerNodeId)).toEqual([
      compiled.graph.rootId,
      compiled.graph.rootId,
      compiled.graph.rootId
    ]);
    expect(new Set(integrationRequirements.map((requirement) => requirement.producerNodeId))).toEqual(
      new Set(["node-domain", "node-api", "node-ui"])
    );
  });

  it("compiles a genuinely atomic request as one executable root leaf", () => {
    const breakdown = bookingBreakdown();
    const domain = leaf(breakdown, "domain");
    breakdown.root = domain;
    breakdown.acceptanceIntents = breakdown.acceptanceIntents.filter((intent) => intent.id === "domain-ready");
    breakdown.candidateSeams = [];

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    expect(compiled.graph.rootId).toBe("node-domain");
    expect(compiled.graph.nodes[compiled.graph.rootId]?.kind).toBe("leaf");
    expect(compiled.contracts).toHaveLength(1);
  });

  it("rejects a leaf whose repository evidence cannot produce an honest scope", () => {
    const breakdown = bookingBreakdown();
    const api = leaf(breakdown, "api");
    api.evidenceIds = [];
    expect(() => compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies)).toThrow(/scope/i);
  });
});

function leaf(breakdown: WorkBreakdown, key: string) {
  const candidate = breakdown.root.kind === "composite"
    ? breakdown.root.children.find((unit) => unit.key === key)
    : undefined;
  if (candidate?.kind !== "leaf") throw new Error(`Missing leaf ${key}`);
  return candidate;
}
