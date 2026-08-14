import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChangeSetManifest, type DigestHasher } from "@manyhands/contracts";
import { ArtifactMaterializer, SimpleGitRunner } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-artifact-materializer-"));
  repo = path.join(directory, "repo");
  await git(directory, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.email", "test@manyhands.local");
  await git(repo, "config", "user.name", "ManyHands Test");
  await writeFile(path.join(repo, "owned.txt"), "before\n", "utf8");
  await git(repo, "add", "owned.txt");
  await git(repo, "commit", "-m", "base");
});

afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("Stage 7 ArtifactMaterializer", () => {
  it("materializes an embedded Git-native manifest without cherry-picking its source commit", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const baseTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const oldOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.txt"), "after\n", "utf8");
    await git(repo, "add", "owned.txt");
    await git(repo, "commit", "-m", "candidate");
    const sourceCommit = await git(repo, "rev-parse", "HEAD");
    const resultTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const newOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "main");
    const manifest = buildChangeSetManifest({
      id: "artifact:owned:attempt-1", contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" },
      producerNodeId: "node-1", producerAttemptId: "attempt-1", inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", objectFormat: "sha1", sourceCandidate: { commitOid: sourceCommit, treeOid: resultTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-1/artifacts/artifact-owned", kind: "change_set", baseTreeSha: baseTree, resultTreeSha: resultTree,
      entries: [{ oldPath: "owned.txt", newPath: "owned.txt", operation: "modify", oldOid, newOid, oldMode: "100644", newMode: "100644" }]
    }, sha256);

    await new ArtifactMaterializer(new SimpleGitRunner(), sha256).materialize(repo, {
      artifactId: "artifact:owned:attempt-1", digest: manifest.manifestDigest, contract: { id: "artifact:owned", revision: "1" },
      kind: "manifest", location: manifest.manifestDigest, manifest
    });

    expect(await git(repo, "rev-parse", "HEAD^{tree}")).toBe(resultTree);
    expect(await git(repo, "merge-base", "--is-ancestor", sourceCommit, "HEAD").then(() => true, () => false)).toBe(false);
    expect(await git(repo, "show", "HEAD:owned.txt")).toBe("after");
    expect(await git(repo, "rev-parse", "HEAD^" )).toBe(baseCommit);
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
