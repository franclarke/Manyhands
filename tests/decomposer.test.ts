import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  type AgentTaskContract
} from "@manyhands/contracts";
import {
  FeatureRequestSchema,
  MockDecomposer,
  type DecompositionMode,
  type FeatureRequest
} from "@manyhands/decomposer";
import {
  getLeafNodes,
  getTopologicalOrder,
  validateTaskGraph
} from "@manyhands/task-graph";

const feature: FeatureRequest = FeatureRequestSchema.parse({
  id: "passwordless-login",
  title: "Passwordless Login With Magic Link",
  description: "Implement a magic-link passwordless login flow.",
  targetStack: ["TypeScript", "React", "Node"],
  constraints: ["Do not modify infrastructure."],
  acceptanceCriteria: [
    "The user can request a magic link.",
    "The callback validates a one-use token."
  ]
});

async function decompose(mode: DecompositionMode = "balanced") {
  return new MockDecomposer().decompose(feature, { mode });
}

describe("MockDecomposer", () => {
  it("generates a valid graph in balanced mode", async () => {
    const result = await decompose("balanced");

    expect(result.validation.graphValid).toBe(true);
    expect(result.validation.contractValid).toBe(true);
    expect(result.validation.issues).toEqual([]);
    expect(validateTaskGraph(result.graph)).toEqual([]);
  });

  it("derives V2 executionScope and forbiddenPaths on leaf contracts", async () => {
    const result = await decompose("balanced");
    const leaves = getLeafNodes(result.graph);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(leaf.contract?.executionScope?.implementationPaths.length ?? 0).toBeGreaterThan(0);
      expect(Array.isArray(leaf.contract?.forbiddenPaths)).toBe(true);
    }
  });

  it("gives each leaf exactly one matching AgentTaskContract", async () => {
    const result = await decompose("balanced");
    const leaves = getLeafNodes(result.graph);
    const contractIds = result.contracts.map((contract) => contract.taskId);

    expect(new Set(contractIds).size).toBe(leaves.length);

    for (const leaf of leaves) {
      const matchingContracts = result.contracts.filter((contract) => contract.taskId === leaf.id);

      expect(matchingContracts).toHaveLength(1);
      expect(leaf.contract?.taskId).toBe(leaf.id);
    }
  });

  it("coarse, balanced and fine modes produce different leaf counts", async () => {
    const coarse = await decompose("coarse");
    const balanced = await decompose("balanced");
    const fine = await decompose("fine");

    expect(getLeafNodes(coarse.graph)).toHaveLength(3);
    expect(getLeafNodes(balanced.graph)).toHaveLength(7);
    expect(getLeafNodes(fine.graph)).toHaveLength(10);
  });

  it("generates a graph without cycles", async () => {
    const result = await decompose("balanced");

    expect(() => getTopologicalOrder(result.graph)).not.toThrow();
    expect(validateTaskGraph(result.graph).map((issue) => issue.code)).not.toContain("cycle_detected");
  });

  it("generates dependencies that point to existing nodes", async () => {
    const result = await decompose("fine");
    const nodeIds = new Set(Object.keys(result.graph.nodes));

    for (const dependency of result.graph.dependencies) {
      expect(nodeIds.has(dependency.fromTaskId)).toBe(true);
      expect(nodeIds.has(dependency.toTaskId)).toBe(true);
    }
  });

  it("generates contracts that pass schema validation", async () => {
    const result = await decompose("balanced");

    for (const contract of result.contracts) {
      expect(AgentTaskContractSchema.safeParse(contract).success).toBe(true);
    }

    expect(result.contracts.every((contract: AgentTaskContract) => contract.allowed.paths.length > 0)).toBe(true);
  });
});
