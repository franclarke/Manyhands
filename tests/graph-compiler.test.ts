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
  it("preserves the exact source contract in every compiled bundle", () => {
    const sourceContract = {
      goal: 'OrderPriority = "standard" | "express"; Backorder has orderId, skuId and missing; listBackorders(state) returns every recorded Backorder.',
      acceptanceCriteria: ["The exact source contract reaches every executable leaf."],
      constraints: ["Do not rename the quoted literals or fields."]
    };
    const compiled = compileGraphRevision({
      breakdown: bookingBreakdown(),
      repositorySnapshot: bookingSnapshot(),
      sourceContract
    }, compilerDependencies);

    expect(compiled.contracts.every((bundle) => bundle.task.sourceContract !== undefined)).toBe(true);
    expect(compiled.contracts.map((bundle) => bundle.task.sourceContract)).toEqual(
      compiled.contracts.map(() => sourceContract)
    );
  });

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

  it("accepts the planner's bare sha256 digest when the repository uses the canonical prefix", () => {
    const snapshot = bookingSnapshot();
    const breakdown = bookingBreakdown();
    breakdown.repositorySnapshotId = snapshot.snapshotId.replace(/^sha256:/u, "");

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: snapshot }, compilerDependencies);

    expect(compiled.graph.repositorySnapshotId).toBe(snapshot.snapshotId);
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

  it("propagates materialized producer inputs to downstream consumers", () => {
    const breakdown = bookingBreakdown();
    breakdown.candidateArtifacts.push(
      {
        id: "domain-files-for-api",
        artifactType: "source-module",
        producerUnitKey: "domain",
        consumerUnitKeys: ["api"],
        purpose: "The API compiles against the domain module",
        materializationHint: "files",
        evidenceIds: ["domain-path", "api-path"]
      },
      {
        id: "api-files-for-ui",
        artifactType: "source-module",
        producerUnitKey: "api",
        consumerUnitKeys: ["ui"],
        purpose: "The UI consumes the API module",
        materializationHint: "files",
        evidenceIds: ["api-path", "ui-path"]
      }
    );

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const executionRequirements = compiled.graph.artifactRequirements.filter((requirement) => requirement.requiredFor === "execution");

    expect(executionRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ producerNodeId: "node-domain", consumerNodeId: "node-api" }),
      expect.objectContaining({ producerNodeId: "node-api", consumerNodeId: "node-ui" }),
      expect.objectContaining({ producerNodeId: "node-domain", consumerNodeId: "node-ui" })
    ]));
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
      "src/ui/BookingForm.tsx",
      "tests/api.test.ts"
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
    expect(() => compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies)).toThrow(/existing path|planned path/i);
  });

  it("compiles honest scopes for a greenfield repository from explicitly declared planned paths", () => {
    const breakdown = bookingBreakdown();
    if (breakdown.root.kind !== "composite") throw new Error("Expected a composite fixture root.");
    breakdown.repositoryEvidence = [];
    breakdown.root.evidenceIds = [];
    const plannedPaths = [
      ["src/domain/booking.ts"],
      ["src/api/bookings.ts"],
      ["src/ui/BookingForm.tsx"]
    ];
    breakdown.root.children.forEach((unit, index) => {
      unit.evidenceIds = [];
      unit.plannedPaths = plannedPaths[index]!;
    });
    breakdown.candidateSeams[0]!.evidenceIds = [];
    const snapshot = bookingSnapshot();
    snapshot.inspectionDisposition = "partial";
    snapshot.index!.files = [];
    snapshot.index!.metadata.fileCount = 0;
    snapshot.diagnostics = [{
      code: "no_supported_source_files",
      severity: "warning",
      message: "No supported source files were found in this repository."
    }];

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: snapshot }, compilerDependencies);

    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")?.scope.allowedPaths).toEqual([
      "src/domain/booking.ts"
    ]);
    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === compiled.graph.rootId)?.scope.allowedPaths).toEqual([
      "src/api/bookings.ts",
      "src/domain/booking.ts",
      "src/ui/BookingForm.tsx"
    ]);
    expect(compiled.review.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("accepts a grounded configuration path that the structural source index omits", () => {
    const breakdown = bookingBreakdown();
    const domain = leaf(breakdown, "domain");
    breakdown.repositoryEvidence.push({
      id: "config-package-json",
      kind: "path",
      reference: "package.json",
      observation: "Repository package manifest defining scripts",
      confidence: 1
    });
    domain.evidenceIds.push("config-package-json");

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")?.scope.allowedPaths)
      .toContain("package.json");
    expect(compiled.review.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("matches grounded evidence when Windows index paths use backslashes", () => {
    const breakdown = bookingBreakdown();
    const snapshot = bookingSnapshot();
    const indexedDomain = snapshot.index?.files.find((file) => file.path === "src/domain/booking.ts");
    if (indexedDomain === undefined || snapshot.index === undefined) throw new Error("Missing domain fixture path.");
    indexedDomain.path = "src\\domain\\booking.ts";

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: snapshot }, compilerDependencies);

    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")?.scope.allowedPaths)
      .toContain("src/domain/booking.ts");
  });

  it("normalizes absolute path evidence against the inspected repository root", () => {
    const breakdown = bookingBreakdown();
    const domainEvidence = breakdown.repositoryEvidence.find((item) => item.id === "domain-path");
    if (domainEvidence === undefined) throw new Error("Expected domain path evidence.");
    domainEvidence.reference = "C:\\repo\\booking\\src\\domain\\booking.ts";

    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    expect(compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")?.scope.allowedPaths).toEqual([
      "src/domain/booking.ts"
    ]);
  });
});

function leaf(breakdown: WorkBreakdown, key: string) {
  const candidate = breakdown.root.kind === "composite"
    ? breakdown.root.children.find((unit) => unit.key === key)
    : undefined;
  if (candidate?.kind !== "leaf") throw new Error(`Missing leaf ${key}`);
  return candidate;
}
