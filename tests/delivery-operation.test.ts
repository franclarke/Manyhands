import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { deliverRunBranch } from "@/lib/server/runs/delivery";
import type { RunRecord } from "@/lib/server/runs/schema";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function git(cwd: string, ...args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }

async function fixture(): Promise<{ run: RunRecord; base: string }> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "mh-delivery-operation-"));
  dirs.push(repo);
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.name", "test"); git(repo, "config", "user.email", "test@mh.local"); git(repo, "commit", "--allow-empty", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "manyhands/run-1"); git(repo, "commit", "--allow-empty", "-m", "artifact");
  const finalSha = git(repo, "rev-parse", "HEAD"); git(repo, "checkout", "main");
  return {
    base,
    run: {
      runId: "run-1", workspaceId: "ws", granularity: "balanced", model: "claude", userPrompt: "x", title: "x", version: 4, status: "needs_delivery",
      createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z", patches: [], finalApplicationStatus: "applied", appliedToRepoPath: repo,
      finalBranchName: "manyhands/run-1", finalCommitSha: finalSha, baseCommit: base,
      finalArtifactManifest: { version: 1, manifestId: "00000000-0000-4000-8000-000000000001", runId: "run-1", sourceTargetFingerprint: "fingerprint", sourceBranch: "main", sourceBaseSha: base, executionBaseSha: base, finalSha, finalRef: "manyhands/run-1", addedFiles: [], modifiedFiles: [], deletedFiles: [], patch: "", validationCommands: [], validationResults: [], verificationDisposition: "verified", omittedTasks: [], acceptedFailures: [], acceptedConflicts: [], repairEvidence: [], artifactDisposition: "ready", deliveryDisposition: "needs_delivery", createdAt: "2026-07-12T00:00:00.000Z" }
    }
  };
}

describe("explicit delivery operation", () => {
  it("merges only the confirmed branch and adopts a retry without a second merge", async () => {
    const { run, base } = await fixture();
    const request = { runId: run.runId, manifestId: run.finalArtifactManifest!.manifestId, finalSha: run.finalCommitSha!, targetBranch: "main", expectedTargetHead: base, expectedClean: true, targetFingerprint: "fingerprint", actor: "test", idempotencyKey: "delivery-1" };
    const first = await deliverRunBranch(run, request);
    const second = await deliverRunBranch(run, request);
    expect(first.disposition).toBe("delivered");
    expect(second).toEqual(first);
    expect(git(run.appliedToRepoPath!, "log", "--oneline", "--all", "--grep", "mh: deliver run run-1").split("\n").filter(Boolean)).toHaveLength(1);
    await expect(deliverRunBranch(run, { ...request, expectedTargetHead: `${base}-different` }))
      .rejects.toThrow(/idempotency key/i);
  });
});
