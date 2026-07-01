/**
 * Gate copy by failure class — an infra failure (npm missing, exit 127) must
 * never be presented as "conflictos que el Composer no pudo resolver" (the
 * postmortem run had 0 conflicts and a misleading gate question).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistExecutionPause } from "@/lib/server/runs/execution-host";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-gate-copy-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Build counter",
    title: "Build counter",
    version: 0,
    status: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: []
  } as RunRecord;
}

async function pauseWith(
  runId: string,
  gate: Partial<NonNullable<RunRecord["pendingDecision"]>>
): Promise<RunRecord> {
  await getRunRepository().save(makeRun(runId));
  await persistExecutionPause(runId, {
    gate: "merge_conflict",
    gateId: `merge_conflict:build-ui:test0001`,
    taskId: "build-ui",
    ...gate
  } as NonNullable<RunRecord["pendingDecision"]>);
  return getRunRepository().get(runId);
}

describe("persistExecutionPause — merge_conflict copy by failure class", () => {
  it("infra: says environment failure, never 'conflictos', and leads with retry", async () => {
    const run = await pauseWith("run-infra", {
      integrationStatus: "validation_failed",
      failureClass: "infra",
      validationExitCode: 127
    });
    const question = run.pendingQuestion?.question ?? "";
    expect(question).toContain("fallo del entorno");
    expect(question).toContain("exit 127");
    expect(question).toContain("No hubo conflictos de merge");
    expect(question).not.toMatch(/falló con conflictos/);
    expect(run.pendingQuestion?.options?.[0]).toBe("Reintentar integración");
  });

  it("code_validation: says validation failed without conflicts, leads with accept", async () => {
    const run = await pauseWith("run-codeval", {
      integrationStatus: "validation_failed",
      failureClass: "code_validation",
      validationExitCode: 1
    });
    const question = run.pendingQuestion?.question ?? "";
    expect(question).toContain("se aplicó sin conflictos");
    expect(question).toContain("exit 1");
    expect(run.pendingQuestion?.options?.[0]).toBe("Aceptar conflicto y continuar");
  });

  it("merge_conflict: keeps the Composer copy", async () => {
    const run = await pauseWith("run-merge", {
      integrationStatus: "cherry_pick_conflict",
      failureClass: "merge_conflict"
    });
    expect(run.pendingQuestion?.question).toContain("el Composer no pudo resolver");
  });

  it("persists the actionable decision event before returning the paused run", async () => {
    const run = await pauseWith("run-decision-event", {
      integrationStatus: "cherry_pick_conflict",
      failureClass: "merge_conflict"
    });

    const events = await readRunModelEvents(run.runId);
    expect(events.map((event) => event.type)).toEqual(["run.status.changed", "decision.raised"]);
    expect(events[1]?.payload).toMatchObject({
      decisionId: "clarify:build-ui",
      kind: "clarify",
      blocking: true,
      context: { nodeIds: ["build-ui"], gate: "merge_conflict" }
    });
  });

  it("legacy gate without failureClass falls back to a generic message with the status", async () => {
    const run = await pauseWith("run-legacy", { integrationStatus: "internal_error" });
    const question = run.pendingQuestion?.question ?? "";
    expect(question).toContain("internal_error");
    expect(question).not.toMatch(/falló con conflictos/);
  });
});
