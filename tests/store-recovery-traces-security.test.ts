import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EventStoreCompactor,
  JsonlRunEventStore,
  acquireDurableLock,
  verifyAndRecoverRunStore
} from "@manyhands/run-store";
import { JsonlTraceStore } from "@manyhands/trace-store";
import { RepositorySnapshotBuilder, TypeScriptRepositoryIndexer } from "@manyhands/repository-index";

const at = "2026-07-29T12:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable recovery, traces and bounded grounding", () => {
  it("counts canonical events rather than physical batch records for compaction", async () => {
    const directory = await tempRoot("mh-run-batch-compaction-");
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "batch-compaction", fencingToken: 1 };
    await store.advanceFence("run-batch-compaction", authority);
    await store.appendFenced("run-batch-compaction", 0, authority, [{
      eventId: "created",
      occurredAt: at,
      type: "run.created",
      payload: { goal: "compact exact event count" }
    }]);
    await store.appendFenced("run-batch-compaction", 1, authority, [
      {
        eventId: "graph",
        occurredAt: at,
        type: "graph.revision.proposed",
        payload: { graphId: "graph:1", revision: 1 }
      },
      {
        eventId: "approved",
        occurredAt: at,
        type: "graph.revision.approved",
        payload: { graphId: "graph:1", revision: 1 }
      }
    ]);

    const result = await new EventStoreCompactor(store, { threshold: 2 })
      .compactIfNeeded("run-batch-compaction", authority);

    expect(result?.compactedEventCount).toBe(3);
    await store.appendFenced("run-batch-compaction", 3, authority, [{
      eventId: "cancel",
      occurredAt: at,
      type: "operation.cancel_requested",
      payload: { invalidationReceiptId: "receipt:cancel", reason: "stop" }
    }]);
    await expect(new EventStoreCompactor(store, { threshold: 2 })
      .compactIfNeeded("run-batch-compaction", authority)).resolves.toBeNull();
  });

  it("rebuilds a run from a compacted generation plus active journal and repairs a torn tail", async () => {
    const directory = await tempRoot("mh-run-recovery-");
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "recovery-op", fencingToken: 1 };
    await store.advanceFence("run-recovery", authority);
    await store.appendFenced("run-recovery", 0, authority, [{
      eventId: "created",
      occurredAt: at,
      type: "run.created",
      payload: { goal: "recover" }
    }]);
    const preCompactionJournal = await readFile(store.eventLogPath("run-recovery"), "utf8");
    await new EventStoreCompactor(store, { threshold: 1 }).compact("run-recovery", authority);
    // Simulate a crash after publishing the generation manifest but before the
    // active journal was cleared. Recovery must accept the duplicate prefix.
    await writeFile(store.eventLogPath("run-recovery"), preCompactionJournal, "utf8");
    await store.appendFenced("run-recovery", 1, authority, [{
      eventId: "started",
      occurredAt: at,
      type: "operation.cancel_requested",
      payload: { invalidationReceiptId: "cancel-receipt", reason: "recovery-check" }
    }]);
    await writeFile(store.eventLogPath("run-recovery"), `${await readFile(store.eventLogPath("run-recovery"), "utf8")}{"schemaVersion":4`, "utf8");

    const report = await verifyAndRecoverRunStore("run-recovery", { store, authority });

    expect(report.status).toBe("recovered");
    expect(report.repairedTrailingBytes).toBeGreaterThan(0);
    expect(report.eventCount).toBe(2);
    expect(report.projection?.lifecycle).toBe("cancelling");
    expect(await store.load("run-recovery")).toHaveLength(2);
  });

  it("requires current fencing authority before repairing a journal", async () => {
    const directory = await tempRoot("mh-run-stale-recovery-");
    const store = new JsonlRunEventStore({ directory });
    const stale = { operationId: "recovery:old", fencingToken: 1 };
    const current = { operationId: "recovery:new", fencingToken: 2 };
    await store.advanceFence("run-stale-recovery", stale);
    await store.appendFenced("run-stale-recovery", 0, stale, [{
      eventId: "created",
      occurredAt: at,
      type: "run.created",
      payload: { goal: "fence recovery" }
    }]);
    await store.advanceFence("run-stale-recovery", current);
    const journalPath = store.eventLogPath("run-stale-recovery");
    await writeFile(journalPath, `${await readFile(journalPath, "utf8")}{"schemaVersion":4`, "utf8");
    const before = await readFile(journalPath);

    await expect(verifyAndRecoverRunStore("run-stale-recovery", { store, authority: stale }))
      .rejects.toThrow(/no longer owns/i);

    expect(await readFile(journalPath)).toEqual(before);
  });

  it("renews a durable lock lease before its stale deadline", async () => {
    const directory = await tempRoot("mh-lock-renew-");
    const lock = await acquireDurableLock(path.join(directory, "run.lock"), {
      staleAfterMs: 20,
      timeoutMs: 15
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await lock.renew();
      await expect(acquireDurableLock(path.join(directory, "run.lock"), {
        staleAfterMs: 20,
        timeoutMs: 5
      })).rejects.toThrow(/Timed out/iu);
    } finally {
      await lock();
    }
  });

  it("never reclaims another lock after its own acquisition deadline expires", async () => {
    const directory = await tempRoot("mh-lock-deadline-");
    const lockPath = path.join(directory, "run.lock");
    const lock = await acquireDurableLock(lockPath, { renewIntervalMs: 0 });
    try {
      const ownerPath = path.join(lockPath, "owner.json");
      const ownerBefore = await readFile(ownerPath, "utf8");
      const expired = new Date(Date.now() - 60_000);
      await utimes(lockPath, expired, expired);

      await expect(acquireDurableLock(lockPath, {
        staleAfterMs: 1,
        timeoutMs: 0,
        renewIntervalMs: 0
      })).rejects.toThrow(/Timed out/iu);

      expect(await readFile(ownerPath, "utf8")).toBe(ownerBefore);
      expect((await readdir(directory)).filter((entry) => entry.startsWith("run.lock.stale."))).toEqual([]);
    } finally {
      await lock();
    }
  });

  it("automatically renews a durable lock during a long operation", async () => {
    const directory = await tempRoot("mh-lock-heartbeat-");
    const lockPath = path.join(directory, "run.lock");
    const lock = await acquireDurableLock(lockPath, {
      staleAfterMs: 25,
      timeoutMs: 15,
      renewIntervalMs: 5
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await expect(acquireDurableLock(lockPath, {
        staleAfterMs: 25,
        timeoutMs: 5
      })).rejects.toThrow(/Timed out/iu);
    } finally {
      await lock();
    }
  });

  it("persists redacted traces across a new store instance", async () => {
    const directory = await tempRoot("mh-traces-");
    const first = new JsonlTraceStore({ runId: "run-traces", directory });
    first.append({
      type: "executor_output",
      actor: "agent",
      payload: {
        authorization: "Bearer super-secret-token",
        nested: { password: "do-not-persist" },
        message: "token=visible-only-as-redacted secret=embedded-secret"
      }
    });

    const second = new JsonlTraceStore({ runId: "run-traces", directory });
    const traces = second.list();
    const serialized = JSON.stringify(traces);
    expect(traces).toHaveLength(1);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("do-not-persist");
    expect(serialized).not.toContain("embedded-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("repairs an incomplete trailing trace record on read", async () => {
    const directory = await tempRoot("mh-traces-tail-");
    const store = new JsonlTraceStore({ runId: "run-traces-tail", directory });
    store.append({ type: "executor_output", actor: "agent", payload: { message: "complete" } });
    const tracePath = store.tracePath();
    await writeFile(tracePath, `${await readFile(tracePath, "utf8")}incomplete`, "utf8");

    expect(store.list()).toHaveLength(1);
    expect(await readFile(tracePath, "utf8")).toMatch(/\n$/u);
  });

  it("marks bounded grounding partial and does not claim omitted files", async () => {
    const directory = await tempRoot("mh-grounding-");
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "bounded" }), "utf8");
    await writeFile(path.join(directory, "a.ts"), "export const a = true;\n", "utf8");
    await writeFile(path.join(directory, "b.ts"), "export const b = true;\n", "utf8");

    const snapshot = await new RepositorySnapshotBuilder({
      indexer: new TypeScriptRepositoryIndexer()
    }).build({
      rootPath: directory,
      repositoryId: "bounded",
      targetFingerprint: "target",
      baseCommit: "commit",
      capturedAt: at,
      limits: { maxFiles: 1 }
    });

    expect(snapshot.inspectionDisposition).toBe("partial");
    expect(snapshot.index?.files).toHaveLength(1);
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "repository index file budget reached", severity: "warning" })
    ]));
    expect(snapshot.index?.files.map((file) => file.path)).not.toContain("b.ts");
    expect(createHash("sha256").update(JSON.stringify(snapshot.index)).digest("hex")).toHaveLength(64);
  });

  it("diagnoses symbol truncation instead of presenting a complete index", async () => {
    const directory = await tempRoot("mh-grounding-symbols-");
    await writeFile(path.join(directory, "a.ts"), "export const a = true;\nexport const aa = true;\n", "utf8");

    const index = await new TypeScriptRepositoryIndexer().index({
      rootPath: directory,
      repositoryId: "bounded-symbols",
      indexedAt: at,
      limits: { maxSymbols: 1 }
    });

    expect(index.symbols).toHaveLength(1);
    expect(index.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "repository index symbol budget reached", severity: "warning" })
    ]));
  });

  it("keeps recovery and durable traces on the productive V2 route", async () => {
    const pipeline = await readFile(path.resolve("apps/web/src/lib/server/runs/v2/execution-pipeline.ts"), "utf8");
    const commandHost = await readFile(path.resolve("apps/web/src/lib/server/runs/v2/command-host.ts"), "utf8");

    expect(pipeline).toContain("verifyAndRecoverRunStore");
    expect(pipeline).toContain("new JsonlTraceStore");
    expect(pipeline).toContain("compactIfNeeded");
    expect(pipeline).toContain("granularityPolicy");
    expect(commandHost).toContain("verifyAndRecoverRunStore");
    expect(commandHost).toContain("compactIfNeeded");
    const planningHost = await readFile(path.resolve("apps/web/src/lib/server/runs/v2/planning-host.ts"), "utf8");
    expect(planningHost).toContain("maxLeafPlannedPaths: strategy.config.maxLeafPlannedPaths");
  });
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
