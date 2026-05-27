import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMockExecutionFlow } from "@manyhands/core";
import { buildRepositoryIndex } from "@manyhands/repository-index";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");
const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

describe("mock execution flow", () => {
  it("executes every scheduled leaf task", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });

    expect(result.summary.execution.executedTasks).toBe(result.planning.summary.leafCount);
    expect(result.results).toHaveLength(result.planning.summary.leafCount);
  });

  it("respects the scheduler batch order", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const scheduledOrder = result.planning.schedule.batches.flatMap((batch) => batch.taskIds);
    const executedOrder = result.results.map((run) => run.taskId);

    expect(executedOrder).toEqual(scheduledOrder);
  });

  it("records simulated execution trace events", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const eventTypes = result.traces.map((event) => event.type);

    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "execution_started",
        "batch_execution_started",
        "task_execution_started",
        "mock_worktree_created",
        "agent_run_started",
        "agent_run_completed",
        "scope_validated",
        "batch_execution_completed",
        "execution_completed"
      ])
    );
  });

  it("returns execution metrics in the summary", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });

    expect(result.summary.execution).toEqual(
      expect.objectContaining({
        totalTasks: 7,
        executedTasks: 7,
        succeededTasks: 7,
        failedTasks: 0,
        scopeValidTasks: 7,
        scopeViolationCount: 0,
        batchesExecuted: result.planning.summary.batchCount,
        simulatedDiffCount: 7
      })
    );
    expect(result.summary.traceEventCount).toBe(result.traces.length);
  });

  it("reflects scope violations in results and summary", async () => {
    const result = await runMockExecutionFlow({
      fixturePath,
      mode: "balanced",
      runnerOptions: {
        overrides: {
          "passwordless-login:balanced:login-ui": {
            changedFiles: ["src/admin/evil.ts"],
            reportedSymbols: ["MagicLinkRequestForm"],
            executedValidationCommands: ["pnpm test"]
          }
        }
      }
    });

    expect(result.summary.execution.failedTasks).toBe(1);
    expect(result.summary.execution.scopeViolationCount).toBeGreaterThan(0);
    expect(result.results.find((run) => run.taskId.endsWith(":login-ui"))?.success).toBe(false);
  });

  it("can run with static repository conflict signals", async () => {
    const repositoryIndex = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced", repositoryIndex });

    expect(result.planning.staticConflictSignals.length).toBeGreaterThan(0);
    expect(result.planning.repositoryIndexHash).toBeDefined();
    expect(result.summary.execution.executedTasks).toBe(result.planning.summary.leafCount);
  });
});
