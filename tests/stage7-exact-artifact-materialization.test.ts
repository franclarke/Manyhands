import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChangeSetManifest, type DigestHasher } from "@manyhands/contracts";
import { ExactGitManifestMaterializer, SimpleGitRunner } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-materialize-"));
  repo = path.join(directory, "repo");
  await git(directory, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.email", "test@manyhands.local");
  await git(repo, "config", "user.name", "ManyHands Test");
  await writeFile(path.join(repo, "owned.txt"), "before\n", "utf8");
  await git(repo, "add", "owned.txt");
  await git(repo, "commit", "-m", "base");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 7 exact artifact materialization", () => {
  it("constructs the declared result tree without adopting the source commit", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const baseTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const oldOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.txt"), "after\n", "utf8");
    await git(repo, "add", "owned.txt");
    await git(repo, "commit", "-m", "candidate");
    const sourceCandidate = await git(repo, "rev-parse", "HEAD");
    const resultTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const newOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "main");

    const manifest = buildChangeSetManifest({
      id: "manifest:owned",
      contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" },
      producerNodeId: "node:producer",
      producerAttemptId: "attempt:producer",
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: sourceCandidate, treeOid: resultTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-1/artifacts/owned",
      kind: "change_set",
      baseTreeSha: baseTree,
      resultTreeSha: resultTree,
      entries: [{
        oldPath: "owned.txt",
        newPath: "owned.txt",
        operation: "modify",
        oldOid,
        newOid,
        oldMode: "100644",
        newMode: "100644"
      }]
    }, sha256);

    const result = await new ExactGitManifestMaterializer(new SimpleGitRunner(), sha256).materialize({
      cwd: repo,
      baseCommit,
      manifest,
      allowedPaths: ["owned.txt"]
    });

    expect(result.treeSha).toBe(resultTree);
    expect(await git(repo, "rev-parse", "HEAD^{tree}")).toBe(resultTree);
    expect(await git(repo, "merge-base", "--is-ancestor", sourceCandidate, "HEAD").then(() => true, () => false)).toBe(false);
    expect(await git(repo, "show", "HEAD:owned.txt")).toBe("after");
  });

  it("does not run a repository smudge filter while materializing exact blobs", async () => {
    const marker = path.join(repo, "smudge-ran.txt");
    await git(repo, "config", "filter.hostile.smudge", `cmd /c echo smudged>\"${marker}\"`);
    await writeFile(path.join(repo, ".gitattributes"), "owned.txt filter=hostile\n", "utf8");
    await git(repo, "add", ".gitattributes");
    await git(repo, "commit", "-m", "hostile attribute fixture");
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const baseTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const oldOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.txt"), "after\n", "utf8");
    await git(repo, "add", "owned.txt");
    await git(repo, "commit", "-m", "candidate");
    const candidate = await git(repo, "rev-parse", "HEAD");
    const tree = await git(repo, "rev-parse", "HEAD^{tree}");
    const newOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "main");
    await rm(marker, { force: true });
    const manifest = buildChangeSetManifest({ id: "manifest:hostile", contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" }, producerNodeId: "node:producer", producerAttemptId: "attempt:producer", inputFingerprint: `sha256:${"c".repeat(64)}`, repositoryObjectStoreId: "object-store:repo", objectFormat: "sha1", sourceCandidate: { commitOid: candidate, treeOid: tree }, retainedByRef: "refs/manyhands/runs/run/attempts/attempt/artifacts/hostile", kind: "change_set", baseTreeSha: baseTree, resultTreeSha: tree, entries: [{ oldPath: "owned.txt", newPath: "owned.txt", operation: "modify", oldOid, newOid, oldMode: "100644", newMode: "100644" }] }, sha256);
    await new ExactGitManifestMaterializer(new SimpleGitRunner(), sha256).materialize({ cwd: repo, baseCommit, manifest, allowedPaths: ["owned.txt"] });
    await expect(access(marker, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans the managed worktree when a later manifest preimage is invalid", async () => {
    await writeFile(path.join(repo, "second.txt"), "before\n", "utf8");
    await git(repo, "add", "second.txt");
    await git(repo, "commit", "-m", "second base file");
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const baseTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const ownedOldOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    const secondOldOid = await git(repo, "rev-parse", "HEAD:second.txt");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.txt"), "after\n", "utf8");
    await writeFile(path.join(repo, "second.txt"), "after\n", "utf8");
    await git(repo, "add", "owned.txt", "second.txt");
    await git(repo, "commit", "-m", "candidate");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const resultTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const ownedNewOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    const secondNewOid = await git(repo, "rev-parse", "HEAD:second.txt");
    await git(repo, "switch", "main");

    const manifest = buildChangeSetManifest({
      id: "manifest:partial-failure",
      contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" },
      producerNodeId: "node:producer",
      producerAttemptId: "attempt:producer",
      inputFingerprint: `sha256:${"b".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: candidateCommit, treeOid: resultTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-1/artifacts/partial",
      kind: "change_set",
      baseTreeSha: baseTree,
      resultTreeSha: resultTree,
      entries: [
        { oldPath: "owned.txt", newPath: "owned.txt", operation: "modify", oldOid: ownedOldOid, newOid: ownedNewOid, oldMode: "100644", newMode: "100644" },
        { oldPath: "second.txt", newPath: "second.txt", operation: "modify", oldOid: "f".repeat(40), newOid: secondNewOid, oldMode: "100644", newMode: "100644" }
      ]
    }, sha256);

    await writeFile(path.join(repo, "unrelated.txt"), "preserve me\n", "utf8");
    await git(repo, "add", "unrelated.txt");

    await expect(new ExactGitManifestMaterializer(new SimpleGitRunner(), sha256).materialize({
      cwd: repo,
      baseCommit,
      manifest,
      allowedPaths: ["owned.txt", "second.txt"]
    })).rejects.toThrow("Artifact preimage mismatch");

    expect(await git(repo, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await git(repo, "diff", "--cached", "--name-only")).toBe("unrelated.txt");
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
