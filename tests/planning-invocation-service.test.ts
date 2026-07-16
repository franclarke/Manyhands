import { describe, expect, it, vi } from "vitest";
import type { DecomposerSelection } from "@/lib/decomposer-policy";
import {
  invokePlanning,
  type PlanningInvocationDependencies
} from "@/lib/server/runs/planning-invocation-service";
import type { RunRecord } from "@/lib/server/runs/schema";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-planning-invocation",
    workspaceId: "workspace-1",
    userPrompt: "Implement the feature",
    title: "Feature",
    model: "gpt-5.5",
    planningExecutorId: "codex-cli",
    planningModel: "gpt-5.5",
    planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "high" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    granularity: "balanced",
    status: "generating",
    version: 3,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides
  } as RunRecord;
}

function dependencies(selection: DecomposerSelection): PlanningInvocationDependencies {
  return {
    pickDecomposer: vi.fn(() => selection),
    runPlanningFlow: vi.fn(async () => ({ decomposition: { graph: { nodes: {}, dependencies: [], rootId: "root" } } })) as never,
    createSupervisedSpawn: vi.fn(() => vi.fn()) as never,
    inspectCapabilities: vi.fn(async () => ({
      executors: [{
        executorId: "codex-cli",
        label: "Codex CLI",
        provider: "OpenAI",
        enabled: true,
        readiness: {
          executorId: "codex-cli",
          label: "Codex CLI",
          status: "ready",
          binaryPath: "codex",
          quota: "unknown",
          checks: [{ id: "cli", status: "pass", label: "Codex CLI", message: "Detected" }]
        },
        models: []
      }]
    }))
  };
}

describe("PlanningInvocationService", () => {
  it("uses the canonical planning selection, effort, budgets and supervised operation", async () => {
    const selection = {
      provider: "codex-cli",
      model: "gpt-5.5",
      decomposer: { decompose: vi.fn() }
    } as unknown as DecomposerSelection;
    const deps = dependencies(selection);

    await invokePlanning({
      run: run(),
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Implement the feature",
        repositoryPath: "C:/repo",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Works"]
      },
      mode: "balanced",
      runLabel: "run-planning-invocation:planning",
      workspace: {
        id: "workspace-1",
        slug: "repo",
        name: "Repo",
        repoPath: "C:/repo",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z"
      },
      operationLease: { operationId: "operation-1" },
      limits: {
        maxParallelSteps: 2,
        maxPlanningDepth: 4,
        maxChildrenPerNode: 5,
        maxDecomposerCalls: 12,
        maxPromptBytes: 20_000
      }
    }, deps);

    expect(deps.createSupervisedSpawn).toHaveBeenCalledWith({
      runId: "run-planning-invocation",
      label: "planning-decomposer",
      operationId: "operation-1"
    });
    expect(deps.pickDecomposer).toHaveBeenCalledWith(expect.objectContaining({
      executorId: "codex-cli",
      model: "gpt-5.5",
      reasoningEffort: "high",
      maxParallelSteps: 2,
      maxPlanningDepth: 4,
      maxChildrenPerNode: 5,
      maxDecomposerCalls: 12,
      maxPromptBytes: 20_000
    }));
    expect(deps.runPlanningFlow).toHaveBeenCalledWith(expect.objectContaining({
      decomposer: selection.decomposer,
      schedulerPolicy: "risk_aware",
      runLabel: "run-planning-invocation:planning"
    }));
  });

  it("rejects deterministic fallback without invoking the planning harness", async () => {
    const deps = dependencies({
      provider: "deterministic",
      model: "gpt-5.5",
      fallbackReason: "no_api_key",
      decomposer: { decompose: vi.fn() }
    } as unknown as DecomposerSelection);

    await expect(invokePlanning({
      run: run(),
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Implement the feature",
        repositoryPath: "C:/repo",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Works"]
      },
      mode: "balanced",
      runLabel: "run-planning-invocation:regen"
    }, deps)).rejects.toThrow("requires codex-cli");

    expect(deps.runPlanningFlow).not.toHaveBeenCalled();
  });
});
