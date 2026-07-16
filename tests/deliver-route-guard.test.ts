/**
 * PR 1 (A-01) — the `deliver` route must refuse destructive git operations
 * (merge/discard/cleanup) on a run that is NOT terminal or that still has an
 * active in-process runner. Otherwise a delivery can merge/clean worktrees and
 * branches while the execution pipeline is still driving the run, corrupting an
 * in-flight integration or deleting evidence of a resumable run.
 *
 * Each 409 case below uses a run where the action would OTHERWISE return 200,
 * so the test fails against the current unguarded route (true red) rather than
 * passing on an unrelated DeliveryError (which also maps to 409).
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_DELIVER } from "@/app/api/runs/[id]/deliver/route";
import { deliverRunBranch } from "@/lib/server/runs/delivery";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { claimRunOperation } from "@/lib/server/runs/run-operation-lease";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { markRunnerActive, markRunnerInactive } from "@/lib/server/runs/runner-state";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
const activeRunIds = new Set<string>();

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-deliver-guard-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  for (const id of activeRunIds) markRunnerInactive(id);
  activeRunIds.clear();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A plain git repo — enough for `cleanup` to run to completion (200). */
function makeGitRepo(name: string): string {
  const repoRoot = path.join(tempDir, name);
  execFileSync("git", ["init", "-b", "main", repoRoot], { encoding: "utf8" });
  git(repoRoot, "config", "user.email", "test@mh.local");
  git(repoRoot, "config", "user.name", "MH Test");
  git(repoRoot, "commit", "--allow-empty", "-m", "base");
  return repoRoot;
}

/** A repo with an applied run branch ahead of main — enough for `merge` to succeed (200). */
function makeAppliedRepo(
  runId: string
): { repoRoot: string; baseCommit: string; finalBranchName: string; finalCommitSha: string } {
  const repoRoot = makeGitRepo(`repo-${runId}`);
  const baseCommit = git(repoRoot, "rev-parse", "HEAD");
  const finalBranchName = `manyhands/run-${runId}`;
  git(repoRoot, "checkout", "-b", finalBranchName);
  git(repoRoot, "commit", "--allow-empty", "-m", "run work");
  const finalCommitSha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "checkout", "main");
  return { repoRoot, baseCommit, finalBranchName, finalCommitSha };
}

function makeRun(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "completed",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}

function makeNeedsDeliveryRun(
  runId: string,
  applied: ReturnType<typeof makeAppliedRepo>
): { run: RunRecord; manifestId: string } {
  const manifestId = "00000000-0000-4000-8000-000000000001";
  return {
    manifestId,
    run: makeRun(runId, {
      status: "needs_delivery",
      finalApplicationStatus: "applied",
      appliedToRepoPath: applied.repoRoot,
      finalBranchName: applied.finalBranchName,
      finalCommitSha: applied.finalCommitSha,
      baseCommit: applied.baseCommit,
      artifactOutcome: "ready",
      deliveryOutcome: "needs_delivery",
      finalArtifactManifest: {
        version: 1,
        manifestId,
        runId,
        sourceTargetFingerprint: "target-fingerprint",
        sourceBranch: "main",
        sourceBaseSha: applied.baseCommit,
        executionBaseSha: applied.baseCommit,
        finalSha: applied.finalCommitSha,
        finalRef: applied.finalBranchName,
        addedFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
        patch: "",
        validationCommands: [],
        validationResults: [],
        verificationDisposition: "verified",
        omittedTasks: [],
        acceptedFailures: [],
        acceptedConflicts: [],
        repairEvidence: [],
        artifactDisposition: "ready",
        deliveryDisposition: "needs_delivery",
        createdAt: "2026-06-29T00:00:00.000Z"
      }
    })
  };
}

function postDeliver(runId: string, action: "merge" | "discard" | "cleanup" | "reveal"): Promise<Response> {
  return POST_DELIVER(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

function postConfirmedDelivery(runId: string, body: Record<string, unknown>): Promise<Response> {
  return POST_DELIVER(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "merge", ...body })
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

describe("POST deliver — lifecycle guard (A-01)", () => {
  it("rejects cleanup while the run is still running (409)", async () => {
    const runId = "run-deliver-running";
    const repoRoot = makeGitRepo("repo-running");
    await getRunRepository().save(makeRun(runId, { status: "running", appliedToRepoPath: repoRoot }));

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(409);
  });

  it("rejects merge while the run is still running (409)", async () => {
    const runId = "run-deliver-merge-running";
    const applied = makeAppliedRepo(runId);
    await getRunRepository().save(
      makeRun(runId, {
        status: "running",
        finalApplicationStatus: "applied",
        appliedToRepoPath: applied.repoRoot,
        finalBranchName: applied.finalBranchName,
        finalCommitSha: applied.finalCommitSha,
        baseCommit: applied.baseCommit
      })
    );

    const res = await postDeliver(runId, "merge");

    expect(res.status).toBe(409);
  });

  it("rejects cleanup on a terminal run while a runner is still active (409)", async () => {
    const runId = "run-deliver-runner-active";
    const repoRoot = makeGitRepo("repo-active");
    await getRunRepository().save(makeRun(runId, { status: "completed", appliedToRepoPath: repoRoot }));
    markRunnerActive(runId);
    activeRunIds.add(runId);

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(409);
  });

  it("allows cleanup on a terminal run with no active runner (200)", async () => {
    const runId = "run-deliver-completed";
    const repoRoot = makeGitRepo("repo-completed");
    await getRunRepository().save(makeRun(runId, { status: "completed", appliedToRepoPath: repoRoot }));

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(200);
  });

  it("delivers a verified needs_delivery artifact and only then marks the run completed", async () => {
    const runId = "run-deliver-needs-delivery";
    const applied = makeAppliedRepo(runId);
    const { run, manifestId } = makeNeedsDeliveryRun(runId, applied);
    await getRunRepository().save(run);
    const before = await getRunRepository().get(runId);

    const deliveryRequest = {
      manifestId,
      finalSha: applied.finalCommitSha,
      targetBranch: "main",
      expectedTargetHead: applied.baseCommit,
      expectedClean: true,
      targetFingerprint: "target-fingerprint",
      expectedVersion: before.version,
      idempotencyKey: "delivery-needs-delivery-1"
    };
    const response = await postConfirmedDelivery(runId, deliveryRequest);

    expect(response.status, await response.clone().text()).toBe(200);
    const firstBody = await response.json() as { receipt: { deliveryId: string } };
    const retry = await postConfirmedDelivery(runId, deliveryRequest);
    expect(retry.status, await retry.clone().text()).toBe(200);
    const retryBody = await retry.json() as { receipt: { deliveryId: string } };
    expect(retryBody.receipt.deliveryId).toBe(firstBody.receipt.deliveryId);
    const saved = await getRunRepository().get(runId);
    expect(saved).toMatchObject({
      status: "completed",
      artifactOutcome: "ready",
      deliveryOutcome: "delivered",
      finalArtifactManifest: {
        manifestId,
        deliveryDisposition: "delivered"
      }
    });
    expect(git(applied.repoRoot, "merge-base", "--is-ancestor", applied.finalCommitSha, "HEAD")).toBe("");
    const events = await readRunModelEvents(runId);
    expect(events.filter((event) => event.type === "run.delivery.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
    expect(events.some(
      (event) => event.type === "decision.raised" && event.payload.kind === "approve_merge"
    )).toBe(false);
  });

  it("reconciles a delivered receipt after a crash before RunRecord persistence", async () => {
    const runId = "run-deliver-receipt-recovery";
    const applied = makeAppliedRepo(runId);
    const { run, manifestId } = makeNeedsDeliveryRun(runId, applied);
    await getRunRepository().save(run);
    const before = await getRunRepository().get(runId);
    const idempotencyKey = "delivery-receipt-recovery-1";
    const request = {
      runId,
      manifestId,
      finalSha: applied.finalCommitSha,
      targetBranch: "main",
      expectedTargetHead: applied.baseCommit,
      expectedClean: true,
      targetFingerprint: "target-fingerprint",
      actor: "local_operator",
      idempotencyKey
    };
    const { run: claimed } = await claimRunOperation(runId, "delivery", {
      expectedStatuses: ["needs_delivery"],
      expectedVersion: before.version
    });
    const durableReceipt = await deliverRunBranch(claimed, request);

    // Simulate process death here: Git + receipt are durable, while the record
    // still owns the abandoned lease and says needs_delivery.
    const response = await postConfirmedDelivery(runId, {
      manifestId,
      finalSha: applied.finalCommitSha,
      targetBranch: "main",
      expectedTargetHead: applied.baseCommit,
      expectedClean: true,
      targetFingerprint: "target-fingerprint",
      expectedVersion: before.version,
      idempotencyKey
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { receipt: { deliveryId: string } };
    expect(body.receipt.deliveryId).toBe(durableReceipt.deliveryId);
    const saved = await getRunRepository().get(runId);
    expect(saved).toMatchObject({
      status: "completed",
      deliveryOutcome: "delivered",
      finalArtifactManifest: { manifestId, deliveryDisposition: "delivered" }
    });
    expect(saved.activeOperation).toBeUndefined();
    const events = await readRunModelEvents(runId);
    expect(events.filter((event) => event.type === "run.delivery.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
  });

  it("checks terminal artifact preconditions before changing the target branch", async () => {
    const runId = "run-deliver-unverified";
    const applied = makeAppliedRepo(runId);
    const fixture = makeNeedsDeliveryRun(runId, applied);
    fixture.run.finalArtifactManifest = {
      ...fixture.run.finalArtifactManifest!,
      verificationDisposition: "unverified"
    };
    await getRunRepository().save(fixture.run);
    const before = await getRunRepository().get(runId);

    const response = await postConfirmedDelivery(runId, {
      manifestId: fixture.manifestId,
      finalSha: applied.finalCommitSha,
      targetBranch: "main",
      expectedTargetHead: applied.baseCommit,
      expectedClean: true,
      targetFingerprint: "target-fingerprint",
      expectedVersion: before.version,
      idempotencyKey: "delivery-unverified-1"
    });

    expect(response.status).toBe(409);
    expect(git(applied.repoRoot, "rev-parse", "HEAD")).toBe(applied.baseCommit);
    const saved = await getRunRepository().get(runId);
    expect(saved.status).toBe("needs_delivery");
    expect(saved.activeOperation).toBeUndefined();
  });

  it("does not block reveal with the lifecycle guard", async () => {
    // No appliedToRepoPath + no workspace → reveal returns 400 (no local folder),
    // never reaching the file explorer. The point: the guard must NOT turn this
    // into a 409 on a running run.
    const runId = "run-deliver-reveal-running";
    await getRunRepository().save(makeRun(runId, { status: "running" }));

    const res = await postDeliver(runId, "reveal");

    expect(res.status).not.toBe(409);
  });
});
