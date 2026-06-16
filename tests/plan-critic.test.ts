import { describe, expect, it } from "vitest";
import { runPlanCritic, runSeamCritic } from "@/lib/plan-critic";
import type { AgentTaskContract } from "@manyhands/core";
import type { TaskGraph } from "@manyhands/task-graph";

function leafGraph(leafIds: string[]): TaskGraph {
  const nodes: Record<string, unknown> = {
    root: {
      id: "root",
      parentId: null,
      kind: "root",
      title: "Root",
      goal: "root",
      status: "planned",
      granularity: "auto",
      depth: 0,
      childrenIds: leafIds,
      dependencies: []
    }
  };
  for (const id of leafIds) {
    nodes[id] = {
      id,
      parentId: "root",
      kind: "leaf",
      title: id.toUpperCase(),
      goal: id,
      status: "planned",
      granularity: "auto",
      depth: 1,
      childrenIds: [],
      dependencies: []
    };
  }
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-05-26T00:00:00.000Z",
    dependencies: [],
    nodes
  } as unknown as TaskGraph;
}

function contract(taskId: string, overrides: Partial<AgentTaskContract> = {}): AgentTaskContract {
  return {
    taskId,
    allowed: { paths: ["src/feature.ts"] },
    acceptance: [{ kind: "behavioral", description: "works" }],
    expectedOutput: { changedFiles: ["src/feature.ts"], producedSymbols: [], consumedSymbols: [] },
    validationCommands: [{ kind: "unit", command: "pnpm test", blocking: true }],
    ...overrides
  } as unknown as AgentTaskContract;
}

const iface = (id: string, signature: string, kind: "function" | "type" | "module" = "function") => ({
  id,
  kind,
  signature,
  description: `${id} seam`
});

describe("runSeamCritic", () => {
  it("passes when every consumed seam has a matching producer", () => {
    const contracts = [
      contract("a", { producedInterfaces: [iface("TaskStore", "createTaskStore(): TaskStore")] }),
      contract("b", { consumedInterfaces: [iface("TaskStore", "createTaskStore(): TaskStore")] })
    ];
    const result = runSeamCritic({ graph: leafGraph(["a", "b"]), contracts });
    expect(result.status).toBe("clean");
    expect(result.seamCount).toBe(1);
  });

  it("flags a consumed seam with no producer", () => {
    const contracts = [contract("b", { consumedInterfaces: [iface("TaskStore", "createTaskStore(): TaskStore")] })];
    const result = runSeamCritic({ graph: leafGraph(["b"]), contracts });
    expect(result.status).toBe("errors");
    expect(result.findings.map((f) => f.code)).toContain("orphan_consumed_seam");
  });

  it("flags a producer/consumer signature mismatch as a warning, not a blocking error", () => {
    const contracts = [
      contract("a", { producedInterfaces: [iface("TaskStore", "createTaskStore(): TaskStore")] }),
      contract("b", { consumedInterfaces: [iface("TaskStore", "createTaskStore(opts): TaskStore")] })
    ];
    const result = runSeamCritic({ graph: leafGraph(["a", "b"]), contracts });
    const finding = result.findings.find((f) => f.code === "seam_signature_mismatch");
    expect(finding?.severity).toBe("warning");
    expect(result.status).not.toBe("errors");
  });

  it("does not flag concrete signatures as vague", () => {
    const contracts = [
      contract("a", { producedInterfaces: [iface("Handler", "() => void")] }),
      contract("b", { consumedInterfaces: [iface("Handler", "() => void")] })
    ];
    const result = runSeamCritic({ graph: leafGraph(["a", "b"]), contracts });
    expect(result.findings.map((f) => f.code)).not.toContain("vague_seam_signature");
    expect(result.status).toBe("clean");
  });

  it("warns on an unconsumed produced seam and a vague signature", () => {
    const contracts = [contract("a", { producedInterfaces: [iface("Foo", "Foo")] })];
    const result = runSeamCritic({ graph: leafGraph(["a"]), contracts });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("unconsumed_seam");
    expect(codes).toContain("vague_seam_signature");
  });
});

describe("runPlanCritic", () => {
  it("suggests a detected validation command for leaves that lack one", () => {
    const contracts = [contract("a", { validationCommands: [] })];
    const result = runPlanCritic({
      graph: leafGraph(["a"]),
      contracts,
      detectedCommands: { packageManager: "pnpm", test: "pnpm run test" }
    });
    const finding = result.findings.find((f) => f.code === "missing_validation_commands");
    expect(finding?.suggestion).toContain("pnpm run test");
  });

  it("announces when run-level validation will be backfilled", () => {
    const contracts = [contract("a")];
    const result = runPlanCritic({
      graph: leafGraph(["a"]),
      contracts,
      detectedCommands: { packageManager: "pnpm", test: "pnpm run test" }
    });
    const finding = result.findings.find((f) => f.code === "run_validation_backfilled");
    expect(finding).toMatchObject({
      severity: "info",
      message: "Run-level validation will run `pnpm run test` on the integrated result."
    });
  });

  it("flags broad-scope leaves and missing expected files", () => {
    const contracts = [
      contract("a", {
        allowed: { paths: Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`) },
        expectedOutput: { changedFiles: [], producedSymbols: [], consumedSymbols: [] }
      } as Partial<AgentTaskContract>)
    ];
    const result = runPlanCritic({ graph: leafGraph(["a"]), contracts });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("broad_scope");
    expect(codes).toContain("missing_expected_files");
  });
});
