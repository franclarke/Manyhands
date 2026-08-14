import { describe, expect, it } from "vitest";
import {
  ExecutionBaseBuilder,
  WorktreeManager
} from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const BASE = "a".repeat(40);
const FINGERPRINT = `sha256:${"e".repeat(64)}`;

function logicalArtifact(id: string, digest: string) {
  return {
    artifactId: id,
    digest,
    contract: { id: `contract-${id}`, revision: "rev-1" },
    kind: "logical" as const,
    location: `logical:${id}`
  };
}

function request(artifacts: ReturnType<typeof logicalArtifact>[]) {
  return {
    runId: "run-1",
    nodeId: "consumer",
    baseCommit: BASE,
    contractBaseline: { id: "consumer-contract", revision: "rev-3" },
    artifacts,
    inputFingerprint: FINGERPRINT
  };
}

describe("ExecutionBaseBuilder", () => {
  it("rejects historical commit transport before creating a productive worktree", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    await expect(builder.build({
      ...request([]),
      artifacts: [{
        artifactId: "historical-commit",
        digest: "digest-commit",
        contract: { id: "contract-historical", revision: "rev-1" },
        kind: "commit",
        location: "b".repeat(40)
      }]
    })).rejects.toThrow(/historical replay data/i);

    expect(git.calls).toEqual([]);
  });

  it("retains only declared logical artifacts without invoking cherry-pick", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo", now: () => "2026-07-17T12:00:00.000Z" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager, now: () => "2026-07-17T12:00:00.000Z" });

    const built = await builder.build(request([
      logicalArtifact("artifact-a", "digest-a"),
      logicalArtifact("artifact-b", "digest-b")
    ]));

    expect(git.calls.some((call) => call.op === "cherryPick")).toBe(false);
    expect(built.worktree.baseCommit).toBe(BASE);
    expect(built.manifest).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
      nodeId: "consumer",
      baseCommit: BASE,
      resultingCommit: BASE,
      inputFingerprint: FINGERPRINT,
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    expect(built.manifest.materializedArtifacts.map(({ artifactId, digest, beforeCommit, resultingCommit }) => ({
      artifactId,
      digest,
      beforeCommit,
      resultingCommit
    }))).toEqual([
      { artifactId: "artifact-a", digest: "digest-a", beforeCommit: BASE, resultingCommit: BASE },
      { artifactId: "artifact-b", digest: "digest-b", beforeCommit: BASE, resultingCommit: BASE }
    ]);
  });

  it("requires immutable manifest content for a manifest overlay", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({ git, repoRoot: "C:/repo" });
    const builder = new ExecutionBaseBuilder({ git, worktreeManager: manager });

    await expect(builder.build({
      ...request([]),
      artifacts: [{
        artifactId: "missing-manifest",
        digest: "digest-missing",
        contract: { id: "contract-missing", revision: "rev-1" },
        kind: "manifest",
        location: "sha256:manifest-missing"
      }]
    })).rejects.toThrow(/require immutable manifest content/i);

    expect(git.calls).toEqual([]);
  });
});
