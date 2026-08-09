import { describe, expect, it } from "vitest";
import {
  ExecutionBaseBuilder,
  WorktreeManager
} from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const BASE = "a".repeat(40);
const ARTIFACT_A_COMMIT = "b".repeat(40);
const ARTIFACT_B_COMMIT = "c".repeat(40);
const RESULT = "d".repeat(40);
const FINGERPRINT = `sha256:${"e".repeat(64)}`;

function artifact(id: string, commit: string, digest: string) {
  return {
    artifactId: id,
    digest,
    contract: { id: `contract-${id}`, revision: "rev-1" },
    kind: "commit" as const,
    location: commit
  };
}

describe("ExecutionBaseBuilder", () => {
  it("materializes only the explicitly required sibling artifact", async () => {
    const git = new FakeGitRunner({ cherryPickResultShas: [RESULT] });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo", now: () => "2026-07-17T12:00:00.000Z" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager, now: () => "2026-07-17T12:00:00.000Z" });

    const built = await builder.build({
      runId: "run-1",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-3" },
      artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a")],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual([
      ARTIFACT_A_COMMIT
    ]);
    expect(git.calls.some((call) => call.args.commitSha === ARTIFACT_B_COMMIT)).toBe(false);
    expect(built.manifest.resultingCommit).toBe(RESULT);
    expect(built.worktree.baseCommit).toBe(RESULT);
    expect(built.manifest.materializedArtifacts).toEqual([
      expect.objectContaining({ artifactId: "artifact-a", digest: "digest-a", beforeCommit: BASE, resultingCommit: RESULT })
    ]);
  });

  it("materializes a shared candidate commit once while retaining each declared artifact", async () => {
    const git = new FakeGitRunner({
      cherryPickOutcomes: [
        { ok: true, conflictFiles: [], output: "" },
        { ok: false, kind: "empty", conflictFiles: [], output: "The previous cherry-pick is now empty." }
      ],
      cherryPickResultShas: [RESULT]
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo", now: () => "2026-08-17T12:00:00.000Z" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager, now: () => "2026-08-17T12:00:00.000Z" });

    const built = await builder.build({
      runId: "run-shared-commit",
      nodeId: "api-consumer",
      baseCommit: BASE,
      contractBaseline: { id: "api-contract", revision: "rev-1" },
      artifacts: [
        artifact("domain-to-service", ARTIFACT_A_COMMIT, "domain-digest"),
        artifact("domain-to-api", ARTIFACT_A_COMMIT, "domain-digest")
      ],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual([ARTIFACT_A_COMMIT]);
    expect(built.manifest.materializedArtifacts.map(({ artifactId, beforeCommit, resultingCommit }) => ({ artifactId, beforeCommit, resultingCommit }))).toEqual([
      { artifactId: "domain-to-service", beforeCommit: BASE, resultingCommit: RESULT },
      { artifactId: "domain-to-api", beforeCommit: RESULT, resultingCommit: RESULT }
    ]);
  });

  it("materializes a cumulative handoff commit relative to its first parent", async () => {
    const lineage = "9".repeat(40);
    const git = new FakeGitRunner({
      mergeParents: { [ARTIFACT_A_COMMIT]: [BASE, lineage] },
      cherryPickResultShas: [RESULT]
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo", now: () => "2026-08-17T12:00:00.000Z" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager, now: () => "2026-08-17T12:00:00.000Z" });

    const built = await builder.build({
      runId: "run-repaired-handoff",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-1" },
      artifacts: [{ ...artifact("repaired-output", ARTIFACT_A_COMMIT, "digest-repaired"), cherryPickMainline: 1 }],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick")).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({ commitSha: ARTIFACT_A_COMMIT, mainline: 1 })
      })
    ]);
    expect(built.manifest.resultingCommit).toBe(RESULT);
  });

  it("fails with structured evidence and cleans the worktree before an executor can be invoked", async () => {
    const git = new FakeGitRunner({
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/shared.ts"], output: "CONFLICT" }]
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    await expect(
      builder.build({
        runId: "run-2",
        nodeId: "consumer",
        baseCommit: BASE,
        contractBaseline: { id: "consumer-contract", revision: "rev-1" },
        artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a")],
        inputFingerprint: FINGERPRINT
      })
    ).rejects.toMatchObject({
      name: "ExecutionBaseMaterializationError",
      evidence: {
        code: "artifact_conflict",
        artifactId: "artifact-a",
        conflictFiles: ["src/shared.ts"],
        output: "CONFLICT"
      }
    });

    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(git.opsInvoked()).toContain("worktreeRemove");
  });

  it("records a reproducible manifest with the declared order and exact identity", async () => {
    const secondResult = "f".repeat(40);
    const git = new FakeGitRunner({ cherryPickResultShas: [RESULT, secondResult] });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo", now: () => "2026-07-17T12:00:00.000Z" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager, now: () => "2026-07-17T12:00:00.000Z" });

    const built = await builder.build({
      runId: "run-3",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-7" },
      artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a"), artifact("artifact-b", ARTIFACT_B_COMMIT, "digest-b")],
      inputFingerprint: FINGERPRINT
    });

    expect(built.manifest).toMatchObject({
      schemaVersion: 1,
      runId: "run-3",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-7" },
      resultingCommit: secondResult,
      inputFingerprint: FINGERPRINT,
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    expect(built.manifest.materializedArtifacts.map(({ artifactId, digest }) => ({ artifactId, digest }))).toEqual([
      { artifactId: "artifact-a", digest: "digest-a" },
      { artifactId: "artifact-b", digest: "digest-b" }
    ]);
  });
});
