import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExactGitManifestMaterializer,
  GitArtifactBuilder,
  SimpleGitRunner
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-ga-"));
  repo = path.join(directory, "repo");
  await git(directory, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.email", "test@manyhands.local");
  await git(repo, "config", "user.name", "ManyHands Test");
  await writeFile(path.join(repo, "owned.bin"), "before\n", "utf8");
  await writeFile(path.join(repo, "obsolete.txt"), "remove me\n", "utf8");
  await git(repo, "add", "owned.bin", "obsolete.txt");
  await git(repo, "commit", "-m", "base");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 7 GA artifact evidence", () => {
  it("retains and materializes one exact scoped binary/mode/delete candidate through GC", async () => {
    const base = await git(repo, "rev-parse", "HEAD");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.bin"), Buffer.from([0, 1, 2, 255]));
    await git(repo, "add", "owned.bin");
    await git(repo, "update-index", "--chmod=+x", "owned.bin");
    await git(repo, "rm", "obsolete.txt");
    await git(repo, "commit", "-m", "binary executable delete candidate");
    const candidate = await git(repo, "rev-parse", "HEAD");
    const candidateTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const builder = new GitArtifactBuilder(new SimpleGitRunner());
    const candidateManifest = await builder.buildCandidateTree({
      cwd: repo, runId: "run-ga", nodeId: "node-ga", attemptId: "attempt-ga",
      contract: { id: "task:ga", revision: 1, digest: "sha256:task" },
      inputFingerprint: `sha256:${"a".repeat(64)}`, repositoryObjectStoreId: "object-store:ga",
      baseCommit: base, candidateCommit: candidate
    });
    const changeSet = await builder.build({
      cwd: repo, runId: "run-ga", nodeId: "node-ga", attemptId: "attempt-ga", artifactId: "artifact:ga",
      contract: { id: "artifact:ga", revision: 1, digest: "sha256:artifact" },
      inputFingerprint: `sha256:${"a".repeat(64)}`, repositoryObjectStoreId: "object-store:ga",
      baseCommit: base, candidateCommit: candidate, allowedPaths: ["owned.bin", "obsolete.txt"]
    });

    expect(changeSet.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ newPath: "owned.bin", newMode: "100755" }),
      expect.objectContaining({ operation: "delete", oldPath: "obsolete.txt" })
    ]));
    await git(repo, "switch", "main");
    await new ExactGitManifestMaterializer(new SimpleGitRunner()).materialize({
      cwd: repo, baseCommit: base, manifest: changeSet, allowedPaths: ["owned.bin", "obsolete.txt"]
    });
    expect(await git(repo, "rev-parse", "HEAD^{tree}")).toBe(candidateTree);

    await git(repo, "branch", "--delete", "--force", "candidate");
    await git(repo, "reflog", "expire", "--expire=now", "--all");
    await git(repo, "gc", "--prune=now");
    expect(await git(repo, "rev-parse", candidateManifest.retainedByRef)).toBe(candidate);
    expect(await git(repo, "rev-parse", `${candidateManifest.retainedByRef}^{tree}`)).toBe(candidateTree);
  });

  it("rejects symlink and gitlink candidates before either can enter an artifact manifest", async () => {
    const base = await git(repo, "rev-parse", "HEAD");
    const builder = new GitArtifactBuilder(new SimpleGitRunner());
    await git(repo, "switch", "--create", "symlink", base);
    await writeFile(path.join(repo, "link-target"), "../../outside", "utf8");
    const linkOid = await git(repo, "hash-object", "-w", "link-target");
    await git(repo, "update-index", "--add", "--cacheinfo", `120000,${linkOid},owned-link`);
    await git(repo, "commit", "-m", "symlink candidate");
    const symlink = await git(repo, "rev-parse", "HEAD");
    await expect(build(builder, base, symlink, "attempt-symlink", ["owned-link"])).rejects.toThrow(/symlink/i);

    await git(repo, "switch", "--create", "gitlink", base);
    await git(repo, "update-index", "--add", "--cacheinfo", `160000,${base},owned-submodule`);
    await git(repo, "commit", "-m", "gitlink candidate");
    const gitlink = await git(repo, "rev-parse", "HEAD");
    await expect(build(builder, base, gitlink, "attempt-gitlink", ["owned-submodule"])).rejects.toThrow(/gitlink/i);
  });
});

function build(builder: GitArtifactBuilder, baseCommit: string, candidateCommit: string, attemptId: string, allowedPaths: string[]) {
  return builder.build({
    cwd: repo, runId: "run-ga", nodeId: "node-ga", attemptId, artifactId: `artifact:${attemptId}`,
    contract: { id: `artifact:${attemptId}`, revision: 1, digest: "sha256:artifact" },
    inputFingerprint: `sha256:${"b".repeat(64)}`, repositoryObjectStoreId: "object-store:ga",
    baseCommit, candidateCommit, allowedPaths
  });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
