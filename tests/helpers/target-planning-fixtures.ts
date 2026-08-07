import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import { RecursivePlanner, type CutRequest, type WorkBreakdown } from "@manyhands/decomposer";

export function bookingBreakdown(): WorkBreakdown {
  return {
    schemaVersion: 2,
    breakdownId: "booking-breakdown",
    objective: "Allow visitors to create bookings",
    repositorySnapshotId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    acceptanceIntents: [
      { id: "domain-ready", description: "Booking rules are represented", required: true },
      { id: "api-ready", description: "Bookings can be created through the API", required: true },
      { id: "ui-ready", description: "Visitors can submit the booking form", required: true }
    ],
    root: {
      key: "booking",
      kind: "composite",
      title: "Booking creation",
      objective: "Deliver booking creation",
      concerns: ["product-flow"],
      expectedOutcomes: ["A working booking flow"],
      acceptanceIntentIds: ["domain-ready", "api-ready", "ui-ready"],
      evidenceIds: ["domain-path", "api-path", "ui-path"],
      cut: { criterion: "cohesion", rationale: "Separate cohesive increments around an explicit shared contract." },
      children: [
        leaf("domain", "Booking domain", "Represent booking rules", "domain", "domain-ready", "domain-path"),
        leaf("api", "Booking API", "Create bookings", "api", "api-ready", ["api-path", "api-test-path"]),
        leaf("ui", "Booking form", "Submit bookings", "ui", "ui-ready", "ui-path")
      ]
    },
    candidateArtifacts: [],
    candidateSeams: [{
      id: "booking-shape",
      kind: "type",
      specification: "Booking has an id, start time, end time and visitor name",
      producerUnitKey: "domain",
      consumerUnitKeys: ["api", "ui"],
      evidenceIds: ["domain-path", "api-path", "ui-path"]
    }],
    repositoryEvidence: [
      evidence("domain-path", "src/domain/booking.ts", "Existing domain module"),
      evidence("api-path", "src/api/bookings.ts", "Existing API route"),
      evidence("api-test-path", "tests/api.test.ts", "Focused API acceptance tests"),
      evidence("ui-path", "src/ui/BookingForm.tsx", "Existing booking UI")
    ],
    uncertainties: [],
    questions: []
  };
}

export function bookingSnapshot(): RepositorySnapshot {
  const rootPath = "C:/repo/booking";
  const capturedAt = "2026-07-17T00:00:00.000Z";
  return RepositorySnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    repositoryId: "booking-repo",
    rootPath,
    targetFingerprint: "target-1",
    baseCommit: "1111111111111111111111111111111111111111",
    indexSchemaVersion: 1,
    capturedAt,
    inspectionDisposition: "complete",
    capabilities: {
      packageManager: { name: "pnpm", evidence: "pnpm-lock.yaml" },
      scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
      baselineCommands: [
        { kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" },
        { kind: "typecheck", command: "pnpm", args: ["typecheck"], sourceScript: "typecheck" }
      ],
      languages: [{ language: "typescript", coverage: "structural", confidence: 1, evidence: ["src/domain/booking.ts"] }],
      stack: [{ name: "typescript", confidence: 1, evidence: ["package.json dependency typescript"] }]
    },
    diagnostics: [],
    indexHash: "index-hash-1",
    index: {
      repositoryId: "booking-repo",
      rootPath,
      indexedAt: capturedAt,
      files: ["src/domain/booking.ts", "src/api/bookings.ts", "src/ui/BookingForm.tsx", "tests/api.test.ts"].map((filePath) => ({
        path: filePath,
        kind: filePath.includes(".test.") ? "test" : "source",
        contentHash: "a".repeat(64),
        exportedSymbols: [],
        importedSymbols: [],
        declaredSymbols: []
      })),
      symbols: [],
      imports: [],
      exports: [],
      diagnostics: [],
      metadata: {
        indexer: "test-indexer",
        deterministic: true,
        fileCount: 4,
        symbolCount: 0,
        importCount: 0,
        exportCount: 0
      }
    }
  }) as RepositorySnapshot;
}

/**
 * The cut a planner is expected to answer for the booking fixture: three leaves
 * with disjoint writes, each proving its own criterion with its own test. Its
 * shape is what makes the derived relations `files`, never `logical`.
 */
export function bookingCut(): Record<string, unknown> {
  return {
    root: {
      rationale: "Domain, API and UI are separately verifiable",
      children: [
        { key: "domain", objective: "Represent booking rules", criterion: "The domain represents booking rules", reads: ["src/domain/booking.ts"], writes: ["tests/domain.test.ts"] },
        { key: "api", objective: "Create bookings through the API", criterion: "The API creates bookings", reads: ["src/api/bookings.ts"], writes: ["tests/api-create.test.ts"] },
        { key: "ui", objective: "Submit the booking form", criterion: "The form submits a booking", reads: ["src/ui/BookingForm.tsx"], writes: ["tests/ui.test.ts"] }
      ]
    }
  };
}

/**
 * A planner scripted per unit key. `seen` records every request so a test can
 * assert on repair prompts without reaching into the planner.
 */
export function scriptedPlanner(
  script: Record<string, unknown> = bookingCut(),
  options: { budget?: number; maxAttemptsPerUnit?: number } = {}
): { planner: RecursivePlanner; seen: CutRequest[] } {
  const seen: CutRequest[] = [];
  const planner = new RecursivePlanner({
    model: {
      async proposeCut(request) {
        seen.push(request);
        const answer = script[request.unit.key];
        if (answer === undefined) throw new Error(`no scripted cut for ${request.unit.key}`);
        return JSON.stringify(answer);
      }
    },
    budget: { maxScopePaths: options.budget ?? 2 },
    maxAttemptsPerUnit: options.maxAttemptsPerUnit ?? 2
  });
  return { planner, seen };
}

export const compilerDependencies = {
  idFor: (kind: string, key: string) => `${kind}-${key}`.replace(/[^A-Za-z0-9._:-]/gu, "-"),
  now: () => "2026-07-17T01:00:00.000Z"
};

function leaf(key: string, title: string, objective: string, concern: string, intentId: string, evidenceId: string | string[]) {
  return {
    key,
    kind: "leaf" as const,
    title,
    objective,
    concerns: [concern, "tests"],
    expectedOutcomes: [`${title} works and is verified`],
    acceptanceIntentIds: [intentId],
    evidenceIds: Array.isArray(evidenceId) ? evidenceId : [evidenceId]
  };
}

function evidence(id: string, reference: string, observation: string) {
  return { id, kind: "path" as const, reference, observation, confidence: 1 };
}

function flatten(root: WorkBreakdown["root"]): WorkBreakdown["root"][] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flatten)];
}
