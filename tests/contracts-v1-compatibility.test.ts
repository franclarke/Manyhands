import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  adaptLegacyAgentTaskContract
} from "@manyhands/contracts";

describe("legacy AgentTaskContract adapter", () => {
  it("converts V1 obligations into an explicit V2 bundle with provenance", () => {
    const legacy = legacyContract();
    const result = adaptLegacyAgentTaskContract(legacy);

    expect(result.bundle.task).toMatchObject({
      schemaVersion: 2,
      nodeId: "booking-api",
      goal: "Implement booking API",
      provenance: "legacy_inferred"
    });
    expect(result.bundle.scope).toMatchObject({
      provenance: "legacy_inferred",
      allowedPaths: ["src/booking/**", "tests/booking/**", "package.json"],
      forbiddenPaths: [".env", "secrets/**"]
    });
    expect(result.bundle.artifacts).toEqual([
      expect.objectContaining({
        provenance: "legacy_inferred",
        producerNodeId: "booking-api",
        expectedPaths: ["src/booking/service.ts"]
      })
    ]);
    expect(result.bundle.validation.obligations).toEqual([
      expect.objectContaining({
        criterionId: result.bundle.task.acceptanceCriteria[0]?.id,
        layer: "unit"
      })
    ]);
    expect(result.migrationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unresolved_consumed_seam", seamId: "Clock" }),
        expect.objectContaining({ code: "legacy_validation_command_not_promoted" })
      ])
    );
  });

  it("derives stable revisions from canonical legacy content", () => {
    const first = adaptLegacyAgentTaskContract(legacyContract());
    const same = adaptLegacyAgentTaskContract(legacyContract());
    const changed = adaptLegacyAgentTaskContract(
      legacyContract({ objective: "Implement booking API with cancellation" })
    );

    expect(first.bundle.task.revision).toBe(same.bundle.task.revision);
    expect(first.bundle.scope.revision).toBe(same.bundle.scope.revision);
    expect(first.bundle.task.revision).not.toBe(changed.bundle.task.revision);
  });

  it("rejects invalid legacy input instead of inventing a partial contract", () => {
    expect(() => adaptLegacyAgentTaskContract({ taskId: "booking-api" })).toThrow(
      /Invalid legacy AgentTaskContract/u
    );
  });
});

function legacyContract(overrides: Record<string, unknown> = {}) {
  return AgentTaskContractSchema.parse({
    taskId: "booking-api",
    objective: "Implement booking API",
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: { paths: ["src/booking/**"] },
    forbidden: { paths: [".env"] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [
      {
        kind: "test",
        description: "Booking the same slot twice is rejected"
      }
    ],
    validationCommands: [
      {
        kind: "integration",
        command: "pnpm test -- booking",
        blocking: true
      }
    ],
    expectedOutput: {
      changedFiles: ["src/booking/service.ts"],
      producedSymbols: ["bookAppointment"],
      consumedSymbols: ["Clock"]
    },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "Booking API works",
    executionScope: {
      implementationPaths: ["src/booking/**"],
      testPaths: ["tests/booking/**"],
      configPaths: ["package.json"]
    },
    forbiddenPaths: ["secrets/**"],
    consumedInterfaces: [
      {
        id: "Clock",
        kind: "type",
        signature: "interface Clock { now(): Date }",
        description: "Clock used to evaluate availability"
      }
    ],
    producedInterfaces: [
      {
        id: "BookingApi",
        kind: "function",
        signature: "bookAppointment(input: BookingInput): Promise<Booking>",
        description: "Books one available slot"
      }
    ],
    ...overrides
  });
}
