import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildCandidateTreeManifest, buildChangeSetManifest, type DigestHasher } from "@manyhands/contracts";
import { ArtifactMaterializer, SimpleGitRunner } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const oid = (character: string) => character.repeat(40);
const execFileAsync = promisify(execFile);

describe("Stage 7 exact artifact materialization", () => {
  it("materializes an immutable change-set through declared Git objects without cherry-pick", async () => {
    const manifest = buildChangeSetManifest({
      id: "manifest:api",
      contract: { id: "artifact:api", revision: 1, digest: "sha256:artifact" },
      producerNodeId: "node:api",
      producerAttemptId: "attempt:api:1",
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: oid("c"), treeOid: oid("d") },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/a1/artifact",
      kind: "change_set",
      baseTreeSha: oid("b"),
      resultTreeSha: oid("d"),
      entries: [{
        oldPath: "src/api.ts",
        newPath: "src/api.ts",
        operation: "modify",
        oldOid: oid("1"),
        newOid: oid("2"),
        oldMode: "100644",
        newMode: "100644"
      }]
    }, sha256);
    const git = new FakeGitRunner();
    const materializer = new ArtifactMaterializer(git);

    await materializer.materialize("C:/repo/worktree", {
      artifactId: "artifact:api:attempt:1",
      digest: manifest.manifestDigest,
      contract: { id: "artifact:api", revision: "1" },
      kind: "manifest",
      location: manifest.retainedByRef,
      manifest
    });

    expect(git.opsInvoked()).toEqual(["materializeArtifactManifest"]);
    expect(git.calls[0]?.args).toMatchObject({ cwd: "C:/repo/worktree", manifest });
  });

  it("fails closed when a manifest artifact omits immutable manifest content", async () => {
    const materializer = new ArtifactMaterializer(new FakeGitRunner());

    await expect(materializer.materialize("C:/repo/worktree", {
      artifactId: "artifact:api:attempt:1",
      digest: "sha256:artifact",
      contract: { id: "artifact:api", revision: "1" },
      kind: "manifest",
      location: "refs/manyhands/runs/run-1/attempts/a1/artifact"
    } as never)).rejects.toMatchObject({ evidence: { code: "unsupported_artifact_kind" } });
  });

  it("reconstructs the declared result tree from blobs and modes without source-commit application", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mh-stage7-git-"));
    try {
      await git(directory, ["init"]);
      await git(directory, ["config", "user.name", "ManyHands Test"]);
      await git(directory, ["config", "user.email", "manyhands@example.test"]);
      await writeFile(path.join(directory, "value.txt"), "baseline\n", "utf8");
      await git(directory, ["add", "value.txt"]);
      await git(directory, ["commit", "-m", "base"]);
      const baseCommit = await git(directory, ["rev-parse", "HEAD"]);
      const baseTree = await git(directory, ["rev-parse", "HEAD^{tree}"]);
      const oldOid = await git(directory, ["rev-parse", "HEAD:value.txt"]);

      await writeFile(path.join(directory, "value.txt"), "candidate\n", "utf8");
      await git(directory, ["add", "value.txt"]);
      await git(directory, ["commit", "-m", "candidate"]);
      const candidateCommit = await git(directory, ["rev-parse", "HEAD"]);
      const candidateTree = await git(directory, ["rev-parse", "HEAD^{tree}"]);
      const newOid = await git(directory, ["rev-parse", "HEAD:value.txt"]);
      await git(directory, ["reset", "--hard", baseCommit]);

      const manifest = buildChangeSetManifest({
        id: "manifest:real",
        contract: { id: "artifact:real", revision: 1, digest: "sha256:artifact" },
        producerNodeId: "node:real",
        producerAttemptId: "attempt:real:1",
        inputFingerprint: `sha256:${"a".repeat(64)}`,
        repositoryObjectStoreId: "object-store:repo",
        objectFormat: "sha1",
        sourceCandidate: { commitOid: candidateCommit, treeOid: candidateTree },
        retainedByRef: "refs/manyhands/runs/run-1/attempts/a1/artifact",
        kind: "change_set",
        baseTreeSha: baseTree,
        resultTreeSha: candidateTree,
        entries: [{ oldPath: "value.txt", newPath: "value.txt", operation: "modify", oldOid, newOid, oldMode: "100644", newMode: "100644" }]
      }, sha256);

      const result = await new SimpleGitRunner().materializeArtifactManifest({ cwd: directory, manifest });

      expect(result).toEqual({ resultingTree: candidateTree });
      expect(await readFile(path.join(directory, "value.txt"), "utf8")).toBe("candidate\n");
      expect(await git(directory, ["write-tree"])).toBe(candidateTree);
      expect(await git(directory, ["rev-parse", "HEAD"])).toBe(baseCommit);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("materializes a complete candidate tree without checking out its source commit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mh-stage7-tree-"));
    try {
      await git(directory, ["init"]);
      await git(directory, ["config", "user.name", "ManyHands Test"]);
      await git(directory, ["config", "user.email", "manyhands@example.test"]);
      await writeFile(path.join(directory, "value.txt"), "baseline\n", "utf8");
      await git(directory, ["add", "value.txt"]);
      await git(directory, ["commit", "-m", "base"]);
      const baseCommit = await git(directory, ["rev-parse", "HEAD"]);
      await writeFile(path.join(directory, "value.txt"), "candidate\n", "utf8");
      await writeFile(path.join(directory, "added.txt"), "added\n", "utf8");
      await git(directory, ["add", "value.txt", "added.txt"]);
      await git(directory, ["commit", "-m", "candidate"]);
      const candidateCommit = await git(directory, ["rev-parse", "HEAD"]);
      const candidateTree = await git(directory, ["rev-parse", "HEAD^{tree}"]);
      await git(directory, ["reset", "--hard", baseCommit]);

      const manifest = buildCandidateTreeManifest({
        id: "manifest:tree",
        contract: { id: "artifact:tree", revision: 1, digest: "sha256:artifact" },
        producerNodeId: "node:tree",
        producerAttemptId: "attempt:tree:1",
        inputFingerprint: `sha256:${"b".repeat(64)}`,
        repositoryObjectStoreId: "object-store:repo",
        objectFormat: "sha1",
        sourceCandidate: { commitOid: candidateCommit, treeOid: candidateTree },
        retainedByRef: "refs/manyhands/runs/run-1/attempts/a1/tree",
        kind: "candidate_tree",
        baseCommitOid: baseCommit,
        commitOid: candidateCommit,
        treeOid: candidateTree
      }, sha256);

      const result = await new SimpleGitRunner().materializeArtifactManifest({ cwd: directory, manifest });

      expect(result).toEqual({ resultingTree: candidateTree });
      expect(await readFile(path.join(directory, "value.txt"), "utf8")).toBe("candidate\n");
      expect(await readFile(path.join(directory, "added.txt"), "utf8")).toBe("added\n");
      expect(await git(directory, ["write-tree"])).toBe(candidateTree);
      expect(await git(directory, ["rev-parse", "HEAD"])).toBe(baseCommit);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
