import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertExecutionAttemptFingerprint,
  ExecutionAttemptFingerprintMismatchError
} from "@manyhands/execution-core";
import { JsonTaskAttemptJournal } from "@/lib/server/runs/task-attempt-journal";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

describe("exact execution attempts", () => {
  it("persists the input fingerprint when the attempt is reserved before invocation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mh-exact-attempt-"));
    try {
      const journal = new JsonTaskAttemptJournal({ directory });
      const attempt = await journal.reserve({
        runId: "run-1",
        nodeId: "node-1",
        operationId: "op-1",
        fencingToken: 1,
        kind: "scheduled",
        baseCommit: "c".repeat(40),
        inputFingerprint: EXPECTED,
        executor: { executorId: "codex-cli", model: "gpt-5" }
      });

      expect(attempt.state).toBe("prepared");
      expect(attempt.inputFingerprint).toBe(EXPECTED);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a result whose observed execution base differs from the reserved attempt", () => {
    expect(() => assertExecutionAttemptFingerprint(EXPECTED, OTHER)).toThrow(
      ExecutionAttemptFingerprintMismatchError
    );
    expect(assertExecutionAttemptFingerprint(EXPECTED, EXPECTED)).toBe(EXPECTED);
  });
});
