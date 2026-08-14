import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlAttemptStore } from "@manyhands/run-store";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-attempts-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 7 attempt identity", () => {
  it("rejects a second active attempt with the same InputFingerprint after a restart", async () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const first = new JsonlAttemptStore({ directory });
    await first.create({
      attemptId: "attempt-1",
      runId: "run-1",
      nodeId: "node-1",
      inputFingerprint: fingerprint,
      createdAt: "2026-08-14T00:00:00.000Z"
    });

    const restarted = new JsonlAttemptStore({ directory });
    await expect(restarted.create({
      attemptId: "attempt-2",
      runId: "run-1",
      nodeId: "node-1",
      inputFingerprint: fingerprint,
      createdAt: "2026-08-14T00:01:00.000Z"
    })).rejects.toThrow("already has an active attempt for InputFingerprint");
  });
});
