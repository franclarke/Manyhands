import { describe, expect, it } from "vitest";
import {
  ArtifactContractSchema,
  ScopeContractSchema,
  SeamContractSchema,
  TaskContractBundleSchema,
  TaskContractSchema,
  ValidationContractSchema
} from "@manyhands/contracts";

describe("versioned V2 contracts", () => {
  it("parses a complete task contract bundle", () => {
    const parsed = TaskContractBundleSchema.parse(validBundle());

    expect(parsed.task.schemaVersion).toBe(2);
    expect(parsed.task.revision).toBe("task-r1");
    expect(parsed.scope.allowedPaths).toEqual(["src/appointments/**", "tests/appointments/**"]);
    expect(parsed.seams[0]?.consumerNodeIds).toEqual(["web-booking"]);
    expect(parsed.artifacts[0]?.materialization).toBe("files");
    expect(parsed.validation.obligations[0]?.criterionId).toBe("criterion:booking-api");
  });

  it("requires identity, revision and provenance on every contract", () => {
    const bundle = validBundle();
    const contracts: Array<{ schema: { safeParse(value: unknown): { success: boolean } }; value: Record<string, unknown> }> = [
      { schema: TaskContractSchema, value: bundle.task },
      { schema: ScopeContractSchema, value: bundle.scope },
      { schema: SeamContractSchema, value: bundle.seams[0]! },
      { schema: ArtifactContractSchema, value: bundle.artifacts[0]! },
      { schema: ValidationContractSchema, value: bundle.validation }
    ];

    for (const { schema, value } of contracts) {
      const { revision: _revision, ...withoutRevision } = value;
      expect(schema.safeParse(withoutRevision).success).toBe(false);
      const { provenance: _provenance, ...withoutProvenance } = value;
      expect(schema.safeParse(withoutProvenance).success).toBe(false);
    }
  });

  it("rejects unsafe scope paths at the contract boundary", () => {
    const scope = validBundle().scope;

    expect(ScopeContractSchema.safeParse({ ...scope, allowedPaths: ["../secrets/**"] }).success).toBe(false);
    expect(ScopeContractSchema.safeParse({ ...scope, forbiddenPaths: ["C:\\Users\\secret"] }).success).toBe(false);
  });

  it("rejects seams that connect a node to itself or repeat consumers", () => {
    const seam = validBundle().seams[0]!;

    expect(
      SeamContractSchema.safeParse({ ...seam, consumerNodeIds: [seam.producerNodeId] }).success
    ).toBe(false);
    expect(
      SeamContractSchema.safeParse({ ...seam, consumerNodeIds: ["web-booking", "web-booking"] }).success
    ).toBe(false);
  });

  it("keeps validation obligations independent from exact commands", () => {
    const validation = validBundle().validation;
    expect(ValidationContractSchema.safeParse(validation).success).toBe(true);
    expect(
      ValidationContractSchema.safeParse({
        ...validation,
        command: "pnpm test"
      }).success
    ).toBe(false);
  });

  it("rejects bundles whose references or criterion obligations do not resolve", () => {
    const bundle = validBundle();
    const badScopeRef = {
      ...bundle,
      task: { ...bundle.task, scope: { id: "scope:other", revision: "scope-r1" } }
    };
    const badCriterion = {
      ...bundle,
      validation: {
        ...bundle.validation,
        obligations: [{ ...bundle.validation.obligations[0]!, criterionId: "criterion:missing" }]
      }
    };

    expect(TaskContractBundleSchema.safeParse(badScopeRef).success).toBe(false);
    expect(TaskContractBundleSchema.safeParse(badCriterion).success).toBe(false);
  });
});

function validBundle() {
  return {
    schemaVersion: 2 as const,
    task: {
      schemaVersion: 2 as const,
      id: "task-contract:booking-api",
      revision: "task-r1",
      provenance: "compiled" as const,
      nodeId: "booking-api",
      goal: "Expose appointment availability and booking",
      acceptanceCriteria: [
        {
          id: "criterion:booking-api",
          kind: "integration" as const,
          description: "A free slot can be booked exactly once",
          required: true
        }
      ],
      scope: { id: "scope:booking-api", revision: "scope-r1" },
      consumes: [],
      produces: [{ id: "artifact:booking-api", revision: "artifact-r1" }],
      seams: [{ id: "seam:booking-api", revision: "seam-r1" }],
      validation: { id: "validation:booking-api", revision: "validation-r1" },
      constraints: []
    },
    scope: {
      schemaVersion: 2 as const,
      id: "scope:booking-api",
      revision: "scope-r1",
      provenance: "compiled" as const,
      nodeId: "booking-api",
      allowedPaths: ["src/appointments/**", "tests/appointments/**"],
      forbiddenPaths: [".env"],
      coordinationPaths: ["package.json"]
    },
    seams: [
      {
        schemaVersion: 2 as const,
        id: "seam:booking-api",
        revision: "seam-r1",
        provenance: "compiled" as const,
        kind: "api" as const,
        specification: "POST /api/bookings returns Booking or ALREADY_BOOKED",
        producerNodeId: "booking-api",
        consumerNodeIds: ["web-booking"],
        semanticFacts: { "time.zone": "UTC" },
        compatibility: { mode: "exact" as const, rules: ["Preserve ALREADY_BOOKED"] }
      }
    ],
    artifacts: [
      {
        schemaVersion: 2 as const,
        id: "artifact:booking-api",
        revision: "artifact-r1",
        provenance: "compiled" as const,
        producerNodeId: "booking-api",
        consumerNodeIds: ["web-booking"],
        artifactType: "source-change-set",
        materialization: "files" as const,
        expectedPaths: ["src/appointments/**"]
      }
    ],
    validation: {
      schemaVersion: 2 as const,
      id: "validation:booking-api",
      revision: "validation-r1",
      provenance: "compiled" as const,
      nodeId: "booking-api",
      obligations: [
        {
          id: "obligation:booking-api",
          criterionId: "criterion:booking-api",
          layer: "integration" as const,
          severity: "required" as const,
          acceptableEvidence: ["test_result" as const],
          baselinePolicy: "required" as const,
          negativeControl: "when_feasible" as const,
          flakyPolicy: "forbid" as const
        }
      ]
    }
  };
}
