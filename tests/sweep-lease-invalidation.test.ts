/**
 * RU2 (F2B-2 / invariante I3) — el sweep de un run stale invalida su operation
 * lease en la MISMA mutación CAS que lo transiciona a `interrupted`.
 *
 * Antes de RU2, sweepRunIfStale copiaba el record con spread preservando
 * `activeOperation`/`mutationFence`: un worker congelado que despertaba después
 * del sweep seguía pasando el fence y escribía sobre un run ya interrumpido
 * hasta que un restart posterior hacía takeover.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepRunIfStale } from "@/lib/server/runs/interrupted";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import {
  claimRunOperation,
  renewRunOperation,
  updateRunForOperation
} from "@/lib/server/runs/run-operation-lease";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-sweep-lease-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-test",
    userPrompt: "goal",
    title: "goal",
    version: 0,
    planRevision: 1,
    status: "running",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    patches: []
  };
}

function pastIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/**
 * Persist a run whose on-disk timestamps are `minutesAgo` old (the repository
 * stamps updatedAt with its injected clock), then claim an execution lease
 * also stamped in the past — the exact frozen-worker shape the sweeper sees.
 */
async function saveStaleRunWithLease(runId: string, minutesAgo = 60) {
  const directory = process.env.MANYHANDS_RUNS_DIR!;
  const oldIso = pastIso(minutesAgo);
  const oldStore = new JsonRunRecordStore({ directory, clock: () => oldIso });
  await oldStore.save(makeRun(runId));
  const { lease } = await claimRunOperation(runId, "execution", {
    expectedStatuses: ["running"],
    now: oldIso
  });
  // The claim went through the default repository (fresh clock); restamp the
  // record timestamps into the past so the run is genuinely stale on disk.
  await oldStore.update(runId, (current) => ({ ...current, heartbeatAt: oldIso }));
  return { lease, oldIso };
}

describe("RU2 — sweep invalidates the operation lease", () => {
  it("a write with the pre-sweep lease fails with RunMutationConflictError", async () => {
    const { lease } = await saveStaleRunWithLease("run-ru2-1");

    const swept = await sweepRunIfStale(await getRunRepository().get("run-ru2-1"));
    expect(swept.status).toBe("interrupted");

    await expect(
      updateRunForOperation("run-ru2-1", lease, (current) => ({
        ...current,
        heartbeatAt: new Date().toISOString()
      }))
    ).rejects.toBeInstanceOf(RunMutationConflictError);
  });

  it("the swept record has no activeOperation and a strictly larger fence", async () => {
    const { lease } = await saveStaleRunWithLease("run-ru2-2");

    const swept = await sweepRunIfStale(await getRunRepository().get("run-ru2-2"));

    expect(swept.status).toBe("interrupted");
    expect(swept.activeOperation).toBeUndefined();
    expect(swept.mutationFence ?? 0).toBeGreaterThan(lease.fencingToken);
  });

  it("a concurrent fresh heartbeat prevents the sweep (stale snapshot, fresh disk)", async () => {
    const { lease } = await saveStaleRunWithLease("run-ru2-3");
    const staleSnapshot = await getRunRepository().get("run-ru2-3");

    // Heartbeat lands AFTER the sweeper read its snapshot.
    await renewRunOperation("run-ru2-3", lease);

    const swept = await sweepRunIfStale(staleSnapshot);
    expect(swept.status).toBe("running");

    // The lease is still perfectly valid.
    await expect(
      updateRunForOperation("run-ru2-3", lease, (current) => ({ ...current }))
    ).resolves.toMatchObject({ status: "running" });
  });

  it("two concurrent sweeps produce exactly one transition and one interrupted event", async () => {
    await saveStaleRunWithLease("run-ru2-4");
    const snapshot = await getRunRepository().get("run-ru2-4");

    const [first, second] = await Promise.all([
      sweepRunIfStale(snapshot),
      sweepRunIfStale(snapshot)
    ]);
    expect(first.status).toBe("interrupted");
    expect(second.status).toBe("interrupted");

    const interruptedEvents = (await readRunModelEvents("run-ru2-4")).filter(
      (event) =>
        event.type === "run.status.changed" &&
        (event.payload as { status?: string }).status === "interrupted"
    );
    expect(interruptedEvents).toHaveLength(1);
  });

  it("repeating the sweep after the transition is a no-op (idempotent)", async () => {
    await saveStaleRunWithLease("run-ru2-5");
    const swept = await sweepRunIfStale(await getRunRepository().get("run-ru2-5"));
    expect(swept.status).toBe("interrupted");

    const again = await sweepRunIfStale(await getRunRepository().get("run-ru2-5"));
    expect(again.status).toBe("interrupted");
    expect(again.version).toBe(swept.version);

    const interruptedEvents = (await readRunModelEvents("run-ru2-5")).filter(
      (event) =>
        event.type === "run.status.changed" &&
        (event.payload as { status?: string }).status === "interrupted"
    );
    expect(interruptedEvents).toHaveLength(1);
  });

  it("a later restart-style takeover acquires a valid lease with a higher fence", async () => {
    const { lease: oldLease } = await saveStaleRunWithLease("run-ru2-6");
    await sweepRunIfStale(await getRunRepository().get("run-ru2-6"));

    const { run, lease } = await claimRunOperation("run-ru2-6", "execution", {
      expectedStatuses: ["interrupted"],
      allowTakeover: true
    });
    expect(run.status).toBe("interrupted");
    expect(lease.fencingToken).toBeGreaterThan(oldLease.fencingToken);

    // The new lease writes; the old one stays fenced.
    await expect(
      updateRunForOperation("run-ru2-6", lease, (current) => ({ ...current }))
    ).resolves.toMatchObject({ runId: "run-ru2-6" });
    await expect(
      updateRunForOperation("run-ru2-6", oldLease, (current) => ({ ...current }))
    ).rejects.toBeInstanceOf(RunMutationConflictError);
  });

  it("interrupts an orphaned created record whose planning task never started", async () => {
    const directory = process.env.MANYHANDS_RUNS_DIR!;
    const oldIso = pastIso(60);
    const oldStore = new JsonRunRecordStore({ directory, clock: () => oldIso });
    await oldStore.save({ ...makeRun("run-created-orphan"), status: "created" });

    const swept = await sweepRunIfStale(await getRunRepository().get("run-created-orphan"));

    expect(swept).toMatchObject({
      status: "interrupted",
      interruptedDuring: "generating"
    });
    const events = await readRunModelEvents("run-created-orphan");
    expect(events.some(
      (event) => event.type === "run.status.changed" && event.payload.status === "interrupted"
    )).toBe(true);
  });
});
