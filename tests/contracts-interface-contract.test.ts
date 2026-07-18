import { describe, it, expect } from "vitest";
import {
  AgentTaskContractSchema,
  InterfaceContractSchema
} from "@manyhands/contracts";

const VALID_INTERFACE = {
  id: "TaskStore",
  kind: "type" as const,
  signature: "interface TaskStore { get(id: string): Task | undefined }",
  description: "In-memory task store shared by the CRUD leaves.",
  definedAtNodeId: "root"
};

describe("InterfaceContractSchema", () => {
  it("accepts a well-formed interface contract", () => {
    const parsed = InterfaceContractSchema.parse(VALID_INTERFACE);
    expect(parsed.id).toBe("TaskStore");
    expect(parsed.kind).toBe("type");
  });

  it("allows definedAtNodeId to be omitted", () => {
    const withoutNode = {
      id: VALID_INTERFACE.id,
      kind: VALID_INTERFACE.kind,
      signature: VALID_INTERFACE.signature,
      description: VALID_INTERFACE.description
    };
    expect(InterfaceContractSchema.safeParse(withoutNode).success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      InterfaceContractSchema.safeParse({ ...VALID_INTERFACE, kind: "class" }).success
    ).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(
      InterfaceContractSchema.safeParse({ ...VALID_INTERFACE, signature: "" }).success
    ).toBe(false);
  });
});

describe("AgentTaskContract with interface seams", () => {
  const baseContract = {
    taskId: "leaf-a",
    objective: "Implement the store",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    acceptance: [{ kind: "custom" as const, description: "store works" }],
    expectedOutput: { changedFiles: ["src/store.ts"] },
    limits: { maxDurationMs: 1000, maxCostUsd: 0 },
    definitionOfDone: "store works"
  };

  it("parses without interface fields (backward compatible)", () => {
    const parsed = AgentTaskContractSchema.parse(baseContract);
    expect(parsed.consumedInterfaces).toBeUndefined();
    expect(parsed.producedInterfaces).toBeUndefined();
  });

  it("carries consumed and produced interfaces when present", () => {
    const parsed = AgentTaskContractSchema.parse({
      ...baseContract,
      producedInterfaces: [VALID_INTERFACE],
      consumedInterfaces: []
    });
    expect(parsed.producedInterfaces).toHaveLength(1);
    expect(parsed.producedInterfaces?.[0]?.id).toBe("TaskStore");
    expect(parsed.consumedInterfaces).toEqual([]);
  });
});
