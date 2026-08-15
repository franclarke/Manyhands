import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonlRunEventStore } from "@manyhands/run-store";

import { createTransitionalUnsafeProfile } from "../apps/daemon/src/transitional-unsafe-profile.js";

/** The adapter folds the run before planning, so the definition must exist. */
async function seedRun(stateRoot: string, runId: string): Promise<void> {
  const store = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
  const authority = await store.claimAuthority(runId, "seed");
  await store.bind(authority).append(runId, 0, [{
    eventId: `${runId}:created`,
    occurredAt: "2026-08-15T00:00:00.000Z",
    type: "run.created",
    payload: {
      goal: "Adapter failure visibility",
      definition: {
        schemaVersion: 1,
        workspaceId: "workspace:test",
        title: "Adapter failure visibility",
        userPrompt: "Adapter failure visibility",
        acceptanceCriteria: ["it fails visibly"],
        planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
        executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
        repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
        executionConfig: { leafTimeoutMs: 1000, scopePolicy: "strict" },
        targetContext: {
          fingerprint: "test",
          sourceBaseCommit: "a".repeat(40),
          sourceBranch: "main",
          sourceRealPath: stateRoot
        }
      }
    }
  }]);
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-adapter-failure-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * A live Claude run stalled forever with no diagnostic: the planner threw, the
 * run actor pushed the error onto an in-memory queue that only `drainEffects()`
 * reads, and the productive daemon never drains while it serves IPC. The run
 * sat at `effect.requested` with no event, no timeout and no way to recover.
 *
 * The actor is not the place to fix this. `effect.failed` requires a physical
 * receipt observing `failed`, and synthesizing one for every thrown error would
 * make a genuine process crash terminal instead of retryable, which the GD1
 * crash matrix depends on. An adapter's own deterministic failure is the thing
 * that must become a recorded observation.
 */
describe("Physical effect adapter failure visibility", () => {
  it("records a failed observation when the planner throws", async () => {
    const stateRoot = await temporaryDirectory();
    await seedRun(stateRoot, "run:adapter-failure");
    const recorded: Array<{ observation: string; reason?: string }> = [];

    const profile = createTransitionalUnsafeProfile({
      stateRoot,
      nodeExecutable: process.execPath,
      workerScriptPath: path.join(stateRoot, "worker.js"),
      cwd: stateRoot,
      planner: {
        plan: async () => {
          throw new Error("claude-code-cli planning returned unparseable output.");
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } }
    });

    const planning = profile.adapters.find((adapter) => adapter.kind === "model_call");
    expect(planning).toBeDefined();

    const intent = {
      runId: "run:adapter-failure",
      attemptId: "stage3:planning",
      kind: "model_call" as const,
      inputDigest: `sha256:${"a".repeat(64)}`,
      daemonEpoch: "epoch-1",
      idempotency: "reconcile_then_repeat" as const,
      requestedAt: "2026-08-15T00:00:00.000Z",
      effectId: `sha256:${"b".repeat(64)}`
    };

    await expect(planning!.execute(intent as never, {
      observerDaemonEpoch: "epoch-1",
      inputSpec: { payload: {} } as never,
      priorReceipts: [],
      record: async (observation: { observation: string; reason?: string }) => {
        recorded.push(observation);
        return {} as never;
      }
    } as never)).resolves.toBeUndefined();

    // The failure has to reach the journal as an observation. Throwing instead
    // leaves the run at effect.requested with nothing an operator can act on.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.observation).toBe("failed");
    expect(recorded[0]!.reason).toMatch(/unparseable output/u);
  });

  it("records nothing when the effect was invalidated instead of failing", async () => {
    const stateRoot = await temporaryDirectory();
    await seedRun(stateRoot, "run:adapter-crash");
    const recorded: unknown[] = [];

    const profile = createTransitionalUnsafeProfile({
      stateRoot,
      nodeExecutable: process.execPath,
      workerScriptPath: path.join(stateRoot, "worker.js"),
      cwd: stateRoot,
      planner: {
        plan: async () => {
          throw new Error("planner should not run for an invalidated effect");
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } }
    });

    const planning = profile.adapters.find((adapter) => adapter.kind === "model_call");
    const intent = {
      runId: "run:adapter-crash",
      attemptId: "stage3:planning",
      kind: "model_call" as const,
      inputDigest: `sha256:${"c".repeat(64)}`,
      daemonEpoch: "epoch-1",
      idempotency: "reconcile_then_repeat" as const,
      requestedAt: "2026-08-15T00:00:00.000Z",
      effectId: `sha256:${"d".repeat(64)}`
    };

    // A cancelled effect is not a failed one. Synthesizing a failure here would
    // turn an operator's cancellation into a defect in the run's record.
    await expect(planning!.execute(intent as never, {
      observerDaemonEpoch: "epoch-1",
      inputSpec: { payload: {} } as never,
      priorReceipts: [],
      invalidationReason: async () => "cancelled by operator",
      record: async (observation: unknown) => {
        recorded.push(observation);
        return {} as never;
      }
    } as never)).resolves.toBeUndefined();

    expect(recorded).toHaveLength(0);
  });
});
