import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await new EventStoreCompactor(store, { threshold: 1 }).compact("run-recovery", authority);
    await store.appendFenced("run-recovery", 1, authority, [{
      eventId: "started",
      occurredAt: at,
      type: "operation.cancel_requested",
      payload: { invalidationReceiptId: "cancel-receipt", reason: "recovery-check" }
    }]);
    await writeFile(store.eventLogPath("run-recovery"), `${await readFile(store.eventLogPath("run-recovery"), "utf8")}{"schemaVersion":4`, "utf8");

    const report = await verifyAndRecoverRunStore("run-recovery", { store });

    expect(report.status).toBe("recovered");
    expect(report.repairedTrailingBytes).toBeGreaterThan(0);
    expect(report.eventCount).toBe(2);
    expect(report.projection?.lifecycle).toBe("cancelling");
    expect(await store.load("run-recovery")).toHaveLength(2);
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

  it("persists redacted traces across a new store instance", async () => {
    const directory = await tempRoot("mh-traces-");
    const first = new JsonlTraceStore({ runId: "run-traces", directory });
    first.append({
      type: "executor_output",
      actor: "agent",
      payload: {
        authorization: "Bearer super-secret-token",
        nested: { password: "do-not-persist" },
        message: "token=visible-only-as-redacted"
      }
    });

    const second = new JsonlTraceStore({ runId: "run-traces", directory });
    const traces = second.list();
    const serialized = JSON.stringify(traces);
    expect(traces).toHaveLength(1);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("do-not-persist");
    expect(serialized).toContain("[REDACTED]");
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
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
