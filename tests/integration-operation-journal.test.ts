import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IntegrationOperationConflictError,
  IntegrationOperationLeaseError,
  JsonIntegrationOperationJournal
} from "@manyhands/execution-core";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("JsonIntegrationOperationJournal", () => {
  it("rejects a stale compare-and-swap update", async () => {
    const journal = await createJournal();
    const operation = await journal.open(operationInput());

    const updated = await journal.update(operation, { state: "child_pending" });

    expect(updated.version).toBe((operation.version ?? 0) + 1);
    await expect(journal.update(operation, { state: "failed" })).rejects.toBeInstanceOf(
      IntegrationOperationConflictError
    );
  });

  it("fences a different run operation from reopening the same attempt journal", async () => {
    const journal = await createJournal();
    await journal.open(operationInput());

    await expect(
      journal.open(operationInput({ operationId: "operation-new", fencingToken: 8 }))
    ).rejects.toBeInstanceOf(IntegrationOperationLeaseError);
  });
});

async function createJournal(): Promise<JsonIntegrationOperationJournal> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-integration-journal-"));
  tempDirectories.push(directory);
  return new JsonIntegrationOperationJournal(directory, () => "2026-07-15T00:00:00.000Z");
}

function operationInput(overrides: { operationId?: string; fencingToken?: number } = {}) {
  return {
    runId: "run-1",
    parentNodeId: "parent",
    attemptId: "attempt-1",
    operationId: overrides.operationId ?? "operation-1",
    fencingToken: overrides.fencingToken ?? 7,
    worktreePath: "C:/repo/.manyhands/worktrees/run-1/parent",
    baseSha: "BASE",
    children: [{ taskId: "child", commitSha: "CHILD", state: "pending" as const }]
  };
}
