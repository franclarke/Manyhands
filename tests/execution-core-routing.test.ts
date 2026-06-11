import { describe, expect, it } from "vitest";
import {
  ComplexityRoutingPolicy,
  resolveRoutedSelection,
  scoreNodeComplexity,
  type ExecutorSelection,
  type TaskNodeLike
} from "@manyhands/execution-core";

function node(partial: Partial<TaskNodeLike> = {}): TaskNodeLike {
  return {
    id: "leaf-1",
    kind: "leaf",
    goal: "Implement a helper",
    depth: 2,
    dependencies: [],
    metadata: {},
    ...partial
  } as TaskNodeLike;
}

function contractWith(partial: Record<string, unknown>): NonNullable<TaskNodeLike["contract"]> {
  return partial as NonNullable<TaskNodeLike["contract"]>;
}

describe("scoreNodeComplexity", () => {
  it("scores a small self-contained leaf as trivial", () => {
    const scored = scoreNodeComplexity({ node: node(), dependents: 0 });

    expect(scored.tier).toBe("trivial");
    expect(scored.score).toBeLessThanOrEqual(2);
  });

  it("raises the tier when the node produces seams others depend on", () => {
    const base = scoreNodeComplexity({ node: node(), dependents: 0 });
    const producer = scoreNodeComplexity({
      node: node({
        contract: contractWith({
          producedInterfaces: [
            { id: "src/auth/types.ts", kind: "type", signature: "export interface Session { id: string }", description: "session" },
            { id: "AuthApi", kind: "module", signature: "export function login(): Promise<void>", description: "api" }
          ],
          consumedInterfaces: [{ id: "Db", kind: "module", signature: "export const db: unknown", description: "db" }]
        })
      }),
      dependents: 3
    });

    expect(producer.score).toBeGreaterThan(base.score);
    expect(["complex", "critical"]).toContain(producer.tier);
    expect(producer.signals.join(" ")).toMatch(/seam|interface/i);
  });

  it("treats integrator nodes as at least complex", () => {
    const scored = scoreNodeComplexity({ node: node({ kind: "integrator" }), dependents: 0 });

    expect(["complex", "critical"]).toContain(scored.tier);
  });

  it("accumulates signals from goal size, acceptance criteria and scope breadth", () => {
    const wordy = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
    const scored = scoreNodeComplexity({
      node: node({
        goal: wordy,
        acceptanceCriteria: ["a", "b", "c", "d", "e"],
        contract: contractWith({
          executionScope: {
            implementationPaths: ["src/a/**", "src/b/**", "src/c/**"],
            testPaths: ["tests/**"],
            configPaths: []
          },
          expectedOutput: { changedFiles: ["src/a/x.ts", "src/b/y.ts", "src/c/z.ts"] }
        })
      }),
      dependents: 0
    });

    expect(scored.score).toBeGreaterThanOrEqual(5);
    expect(scored.signals.length).toBeGreaterThan(1);
  });
});

describe("ComplexityRoutingPolicy", () => {
  const allAvailable = new Set(["gemini-cli", "claude-code-cli", "codex-cli"] as const);

  it("routes trivial nodes to the fast lane and critical nodes to the strongest model", () => {
    const policy = new ComplexityRoutingPolicy({ available: allAvailable });

    const trivial = policy.route({ node: node(), dependents: 0, attempt: 0 });
    expect(trivial.model).toBe("gemini-2.5-flash");

    const critical = policy.route({
      node: node({
        kind: "integrator",
        contract: contractWith({
          producedInterfaces: [
            { id: "A", kind: "type", signature: "export type A = 1", description: "" },
            { id: "B", kind: "type", signature: "export type B = 2", description: "" },
            { id: "C", kind: "type", signature: "export type C = 3", description: "" }
          ]
        })
      }),
      dependents: 4,
      attempt: 0
    });
    expect(critical).toEqual({ executorId: "claude-code-cli", model: "opus" });
  });

  it("falls back along the ranked list when an executor is unavailable", () => {
    const policy = new ComplexityRoutingPolicy({ available: new Set(["gemini-cli"] as const) });

    const critical = policy.route({ node: node({ kind: "integrator" }), dependents: 4, attempt: 0 });

    expect(critical.executorId).toBe("gemini-cli");
  });

  it("escalates one tier on repair attempts", () => {
    const policy = new ComplexityRoutingPolicy({ available: allAvailable });

    const firstTry = policy.route({ node: node(), dependents: 0, attempt: 0 });
    const repair = policy.route({ node: node(), dependents: 0, attempt: 1 });

    expect(firstTry.model).toBe("gemini-2.5-flash");
    expect(repair.model).not.toBe("gemini-2.5-flash");
  });
});

describe("resolveRoutedSelection", () => {
  const fallback: ExecutorSelection = { executorId: "gemini-cli", model: "gemini-2.5-pro" };

  it("lets an explicit per-node metadata selection win over the router", () => {
    const policy = new ComplexityRoutingPolicy({ available: new Set(["gemini-cli", "claude-code-cli"] as const) });

    const selection = resolveRoutedSelection({
      node: node({ metadata: { executorSelection: { executorId: "claude-code-cli", model: "opus" } } }),
      dependents: 0,
      defaultSelection: fallback,
      router: policy
    });

    expect(selection).toEqual({ executorId: "claude-code-cli", model: "opus" });
  });

  it("uses the router when there is no explicit override", () => {
    const policy = new ComplexityRoutingPolicy({ available: new Set(["gemini-cli"] as const) });

    const selection = resolveRoutedSelection({
      node: node(),
      dependents: 0,
      defaultSelection: fallback,
      router: policy
    });

    expect(selection.executorId).toBe("gemini-cli");
    expect(selection.model).toBe("gemini-2.5-flash");
  });

  it("falls back to the default selection without a router", () => {
    const selection = resolveRoutedSelection({
      node: node(),
      dependents: 0,
      defaultSelection: fallback
    });

    expect(selection).toEqual(fallback);
  });
});
