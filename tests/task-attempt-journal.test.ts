import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonTaskAttemptJournal,
  TaskAttemptConflictError,
  TaskAttemptLeaseError
} from "@/lib/server/runs/task-attempt-journal";

const lease = { operationId: "op-1", fencingToken: 4 };

async function makeJournal() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-attempt-journal-"));
  const journal = new JsonTaskAttemptJournal({ directory });
  return { journal, directory };
}

describe("JsonTaskAttemptJournal", () => {
  it("persists one durable attempt and advances its state monotonically", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const attempt = await journal.reserve({
        runId: "run-1",
        nodeId: "node-1",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "scheduled",
        baseCommit: "a".repeat(40),
        worktreePath: "C:/worktree/node-1",
        targetFingerprint: "target-1",
        contractHash: "contract-1",
        promptHash: "prompt-1",
        executorConfigHash: "executor-1",
        executor: { executorId: "claude-code-cli", model: "sonnet" },
        idempotencyKey: "run-1:node-1:r1:attempt-1"
      });
      expect(attempt.state).toBe("prepared");

      const reserved = await journal.transition(attempt.attemptId, {
        expectedVersion: attempt.version,
        lease,
        state: "invocation_reserved"
      });
      const running = await journal.transition(attempt.attemptId, {
        expectedVersion: reserved.version,
        lease,
        state: "executor_running",
        process: { ownerId: "run-1", pid: 1234, registeredAt: new Date().toISOString() }
      });
      expect(running.state).toBe("executor_running");

      await expect(
        journal.transition(attempt.attemptId, {
          expectedVersion: running.version,
          lease,
          state: "prepared"
        })
      ).rejects.toBeInstanceOf(TaskAttemptConflictError);

      const reloaded = new JsonTaskAttemptJournal({ directory });
      expect((await reloaded.get(attempt.attemptId))?.state).toBe("executor_running");
      const file = JSON.parse(await readFile(path.join(directory, "run-1.json"), "utf8"));
      expect(file.attempts[0].attemptId).toBe(attempt.attemptId);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("is idempotent by key and rejects stale CAS and fencing writers", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const input = {
        runId: "run-2",
        nodeId: "node-2",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "manual" as const,
        baseCommit: "b".repeat(40),
        executor: { executorId: "codex-cli", model: "gpt" },
        idempotencyKey: "same-attempt"
      };
      const first = await journal.reserve(input);
      expect((await journal.reserve(input)).attemptId).toBe(first.attemptId);

      await expect(
        journal.transition(first.attemptId, {
          expectedVersion: 99,
          lease,
          state: "invocation_reserved"
        })
      ).rejects.toBeInstanceOf(TaskAttemptConflictError);
      await expect(
        journal.transition(first.attemptId, {
          expectedVersion: first.version,
          lease: { operationId: "stale", fencingToken: 3 },
          state: "invocation_reserved"
        })
      ).rejects.toBeInstanceOf(TaskAttemptLeaseError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent reservations for the same idempotency key", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const input = {
        runId: "run-concurrent",
        nodeId: "node-concurrent",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "scheduled" as const,
        baseCommit: "e".repeat(40),
        executor: { executorId: "claude-code-cli", model: "sonnet" },
        idempotencyKey: "concurrent-key"
      };
      const attempts = await Promise.all([journal.reserve(input), journal.reserve(input), journal.reserve(input)]);
      expect(new Set(attempts.map((attempt) => attempt.attemptId)).size).toBe(1);
      expect(await journal.list("run-concurrent")).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discards an invalid attempt with durable evidence and makes a second discard a no-op only by CAS", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const attempt = await journal.reserve({
        runId: "run-discard",
        nodeId: "node-discard",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "repair",
        baseCommit: "f".repeat(40),
        executor: { executorId: "claude-code-cli", model: "sonnet" }
      });
      const discarded = await journal.discard(attempt.attemptId, {
        expectedVersion: attempt.version,
        lease,
        reason: "worktree no longer matches target"
      });
      expect(discarded.state).toBe("discarded");
      expect(discarded.error?.message).toContain("worktree");
      const repeated = await journal.discard(attempt.attemptId, {
        expectedVersion: discarded.version,
        lease,
        reason: "duplicate discard"
      });
      expect(repeated.attemptId).toBe(discarded.attemptId);
      expect(repeated.version).toBe(discarded.version);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows only one concurrent recovery claimant", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const attempt = await journal.reserve({
        runId: "run-recoverers",
        nodeId: "node-recoverers",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "scheduled",
        baseCommit: "1".repeat(40),
        executor: { executorId: "claude-code-cli", model: "sonnet" }
      });
      const ambiguous = await journal.transition(attempt.attemptId, {
        expectedVersion: attempt.version,
        lease,
        state: "recovery_required",
        error: { code: "ambiguous", message: "unknown external outcome" }
      });
      const claims = await Promise.allSettled([
        journal.claimRecovery(ambiguous.attemptId, {
          expectedVersion: ambiguous.version,
          lease: { operationId: "recover-a", fencingToken: 5 },
          reason: "recover-a"
        }),
        journal.claimRecovery(ambiguous.attemptId, {
          expectedVersion: ambiguous.version,
          lease: { operationId: "recover-b", fencingToken: 6 },
          reason: "recover-b"
        })
      ]);
      expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows idempotent adoption and records conservative recovery required", async () => {
    const { journal, directory } = await makeJournal();
    try {
      const attempt = await journal.reserve({
        runId: "run-3",
        nodeId: "node-3",
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
        kind: "integrator",
        baseCommit: "c".repeat(40),
        executor: { executorId: "claude-code-cli", model: "sonnet" }
      });
      const recovered = await journal.transition(attempt.attemptId, {
        expectedVersion: attempt.version,
        lease,
        state: "recovery_required",
        error: { code: "ambiguous_external_call", message: "executor may have run" }
      });
      expect(recovered.state).toBe("recovery_required");
      const recoveryLease = { operationId: "op-recovery", fencingToken: 5 };
      const claimed = await journal.claimRecovery(attempt.attemptId, {
        expectedVersion: recovered.version,
        lease: recoveryLease,
        reason: "new runner owns recovery"
      });
      const adopted = await journal.adopt(attempt.attemptId, {
        expectedVersion: claimed.version,
        lease: recoveryLease,
        reason: "verified orchestrator commit exists",
        commitSha: "d".repeat(40),
        verifyCommit: async () => true
      });
      expect(adopted.state).toBe("adopted");
      expect((await journal.adopt(attempt.attemptId, {
        expectedVersion: adopted.version,
        lease: recoveryLease,
        reason: "verified orchestrator commit exists",
        commitSha: "d".repeat(40)
      })).attemptId).toBe(attempt.attemptId);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
