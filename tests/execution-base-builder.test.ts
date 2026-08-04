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

  it("treats an already-ancestral artifact commit as materialized", async () => {
    const git = new FakeGitRunner({
      ancestors: [ARTIFACT_A_COMMIT],
      cherryPickOutcomes: [{ ok: false, kind: "empty", conflictFiles: [], output: "the previous cherry-pick is empty" }]
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    const built = await builder.build({
      runId: "run-ancestral-artifact",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-1" },
      artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a")],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick")).toHaveLength(0);
    expect(built.manifest.materializedArtifacts).toEqual([
      expect.objectContaining({ artifactId: "artifact-a", beforeCommit: BASE, resultingCommit: BASE })
    ]);
  });

  it("treats an equivalent non-ancestral artifact tree as materialized", async () => {
    const git = new FakeGitRunner({
      diffRangeNameOnly: ["src/shared.ts"],
      showFileByRef: {
        [ARTIFACT_A_COMMIT]: { "src/shared.ts": "export const shared = true;" },
        [BASE]: { "src/shared.ts": "export const shared = true;" }
      },
      cherryPickOutcomes: [{ ok: false, kind: "empty", conflictFiles: [], output: "the patch is already present" }]
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    const built = await builder.build({
      runId: "run-equivalent-artifact",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-1" },
      artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a")],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick")).toHaveLength(0);
    expect(built.manifest.materializedArtifacts).toEqual([
      expect.objectContaining({ artifactId: "artifact-a", beforeCommit: BASE, resultingCommit: BASE })
    ]);
  });

  it("treats an artifact already present in the dirty worktree as materialized", async () => {
    const git = Object.assign(new FakeGitRunner({
      diffRangeNameOnly: ["src/shared.ts"],
      showFileByRef: {
        [ARTIFACT_A_COMMIT]: { "src/shared.ts": "export const shared = true;" },
        [BASE]: { "src/shared.ts": "export const shared = false;" }
      },
      cherryPickOutcomes: [{ ok: false, kind: "empty", conflictFiles: [], output: "the patch is already present" }]
    }), {
      readWorktreeFile: async (_cwd: string, path: string) => path === "src/shared.ts" ? "export const shared = true;" : null
    });
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    const built = await builder.build({
      runId: "run-dirty-equivalent-artifact",
      nodeId: "consumer",
      baseCommit: BASE,
      contractBaseline: { id: "consumer-contract", revision: "rev-1" },
      artifacts: [artifact("artifact-a", ARTIFACT_A_COMMIT, "digest-a")],
      inputFingerprint: FINGERPRINT
    });

    expect(git.calls.filter((call) => call.op === "cherryPick")).toHaveLength(0);
    expect(built.manifest.materializedArtifacts).toEqual([
      expect.objectContaining({ artifactId: "artifact-a", beforeCommit: BASE, resultingCommit: BASE })
    ]);
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
