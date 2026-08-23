import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChangeSetManifest, type DigestHasher } from "@manyhands/contracts";
import { ExactGitManifestMaterializer, GitArtifactBuilder, SimpleGitRunner } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-builder-"));
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

describe("Stage 7 Git artifact builder", () => {
  it("builds and retains a scoped change-set from exact candidate objects", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await writeFile(path.join(repo, "owned.txt"), "after\n", "utf8");
    await git(repo, "add", "owned.txt");
    await git(repo, "commit", "-m", "candidate");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");

    const manifest = await new GitArtifactBuilder(new SimpleGitRunner()).build({
      cwd: repo,
      runId: "run-1",
      nodeId: "node-1",
      attemptId: "attempt-1",
      artifactId: "artifact:owned",
      contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" },
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      baseCommit,
      candidateCommit,
      allowedPaths: ["owned.txt"]
    });

    expect(manifest.kind).toBe("change_set");
    expect(manifest.entries).toEqual([expect.objectContaining({
      oldPath: "owned.txt",
      newPath: "owned.txt",
      operation: "modify",
      oldMode: "100644",
      newMode: "100644"
    })]);
    expect(manifest.retainedByRef).toMatch(
      /^refs\/manyhands\/runs\/run-1-[0-9a-f]{12}\/attempts\/attempt-1-[0-9a-f]{12}\/artifacts\/artifact-owned-[0-9a-f]{12}$/u
    );
    expect(await git(repo, "rev-parse", manifest.retainedByRef)).toBe(candidateCommit);
  });

  it("partitions one candidate across its declared artifact contracts", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await mkdir(path.join(repo, "public"));
    await mkdir(path.join(repo, "src"));
    await writeFile(path.join(repo, "public", "index.html"), "<main>Dashboard</main>\n", "utf8");
    await writeFile(path.join(repo, "src", "dashboard.mjs"), "export const dashboard = true;\n", "utf8");
    await git(repo, "add", "public/index.html", "src/dashboard.mjs");
    await git(repo, "commit", "-m", "candidate with two artifacts");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const builder = new GitArtifactBuilder(new SimpleGitRunner());
    const candidateAllowedPaths = ["public/index.html", "src/dashboard.mjs"];

    const ui = await builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-1", artifactId: "artifact:ui",
      contract: { id: "artifact:ui", revision: 1, digest: "sha256:ui" }, inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit,
      allowedPaths: ["public/index.html"], candidateAllowedPaths
    });
    const model = await builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-1", artifactId: "artifact:model",
      contract: { id: "artifact:model", revision: 1, digest: "sha256:model" }, inputFingerprint: `sha256:${"b".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit,
      allowedPaths: ["src/dashboard.mjs"], candidateAllowedPaths
    });

    expect(ui.entries.map((entry) => entry.newPath)).toEqual(["public/index.html"]);
    expect(model.entries.map((entry) => entry.newPath)).toEqual(["src/dashboard.mjs"]);
  });

  it("materializes each partitioned artifact to its own declared result tree", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await mkdir(path.join(repo, "public"));
    await mkdir(path.join(repo, "src"));
    await writeFile(path.join(repo, "public", "index.html"), "<main>Dashboard</main>\n", "utf8");
    await writeFile(path.join(repo, "src", "dashboard.mjs"), "export const dashboard = true;\n", "utf8");
    await git(repo, "add", "public/index.html", "src/dashboard.mjs");
    await git(repo, "commit", "-m", "candidate with two materialized artifacts");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const candidateAllowedPaths = ["public/index.html", "src/dashboard.mjs"];
    const builder = new GitArtifactBuilder(new SimpleGitRunner());
    const ui = await builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-1", artifactId: "artifact:ui",
      contract: { id: "artifact:ui", revision: 1, digest: "sha256:ui" }, inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit,
      allowedPaths: ["public/index.html"], candidateAllowedPaths
    });
    const model = await builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-1", artifactId: "artifact:model",
      contract: { id: "artifact:model", revision: 1, digest: "sha256:model" }, inputFingerprint: `sha256:${"b".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit,
      allowedPaths: ["src/dashboard.mjs"], candidateAllowedPaths
    });
    const { manifestDigest: _digest, ...uiMaterial } = ui;
    const legacyUi = buildChangeSetManifest({ ...uiMaterial, resultTreeSha: await git(repo, "rev-parse", `${candidateCommit}^{tree}`) }, sha256);
    const target = path.join(directory, "target");
    await git(directory, "clone", repo, target);
    await git(target, "checkout", "--detach", baseCommit);
    const materializer = new ExactGitManifestMaterializer(new SimpleGitRunner());
    const first = await materializer.materialize({ cwd: target, baseCommit, manifest: legacyUi, allowedPaths: ["public/index.html"] });
    const second = await materializer.materialize({ cwd: target, baseCommit: first.executionBaseCommit, manifest: model, allowedPaths: ["src/dashboard.mjs"] });

    expect(await git(target, "rev-parse", `${second.executionBaseCommit}^{tree}`)).toBe(await git(repo, "rev-parse", `${candidateCommit}^{tree}`));
  });

  it("retains an immutable candidate tree before evidence can cite it", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await writeFile(path.join(repo, "owned.txt"), "candidate\n", "utf8");
    await git(repo, "add", "owned.txt");
    await git(repo, "commit", "-m", "candidate");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const candidateTree = await git(repo, "rev-parse", "HEAD^{tree}");

    const manifest = await new GitArtifactBuilder(new SimpleGitRunner()).buildCandidateTree({
      cwd: repo,
      runId: "run-1",
      nodeId: "node-1",
      attemptId: "attempt-1",
      contract: { id: "task:node-1", revision: 1, digest: "sha256:task" },
      inputFingerprint: `sha256:${"f".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      baseCommit,
      candidateCommit
    });

    expect(manifest).toEqual(expect.objectContaining({
      kind: "candidate_tree",
      baseCommitOid: baseCommit,
      commitOid: candidateCommit,
      treeOid: candidateTree,
      sourceCandidate: { commitOid: candidateCommit, treeOid: candidateTree },
      retainedByRef: expect.stringMatching(
        /^refs\/manyhands\/runs\/run-1-[0-9a-f]{12}\/attempts\/attempt-1-[0-9a-f]{12}\/artifacts\/candidate-[0-9a-f]{12}$/u
      )
    }));
    expect(await git(repo, "rev-parse", manifest.retainedByRef)).toBe(candidateCommit);
  });

  it("rejects a scoped symlink candidate before it can become an adopted manifest", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "link-target"), "../../outside", "utf8");
    const linkTarget = await git(repo, "hash-object", "-w", "link-target");
    await git(repo, "update-index", "--add", "--cacheinfo", `120000,${linkTarget},owned-link`);
    await git(repo, "commit", "-m", "candidate symlink");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");

    await expect(new GitArtifactBuilder(new SimpleGitRunner()).build({
      cwd: repo,
      runId: "run-1",
      nodeId: "node-1",
      attemptId: "attempt-1",
      artifactId: "artifact:owned-link",
      contract: { id: "artifact:owned-link", revision: 1, digest: "sha256:contract" },
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      baseCommit,
      candidateCommit,
      allowedPaths: ["owned-link"]
    })).rejects.toThrow(/symlink/i);
  });

  it("records a binary executable blob and an owned delete by their exact Git modes and OIDs", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const oldOid = await git(repo, "rev-parse", "HEAD:owned.txt");
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "owned.txt"), Buffer.from([0, 1, 2, 255]));
    await git(repo, "add", "owned.txt");
    await git(repo, "update-index", "--chmod=+x", "owned.txt");
    await git(repo, "commit", "-m", "binary executable candidate");
    const binaryCandidate = await git(repo, "rev-parse", "HEAD");
    const binaryOid = await git(repo, "rev-parse", "HEAD:owned.txt");

    const binary = await new GitArtifactBuilder(new SimpleGitRunner()).build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-binary", artifactId: "artifact:owned",
      contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" }, inputFingerprint: `sha256:${"b".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit: binaryCandidate, allowedPaths: ["owned.txt"]
    });
    expect(binary.entries).toEqual([expect.objectContaining({
      operation: "modify", oldOid, newOid: binaryOid, oldMode: "100644", newMode: "100755"
    })]);

    await git(repo, "rm", "owned.txt");
    await git(repo, "commit", "-m", "delete owned file");
    const deleteCandidate = await git(repo, "rev-parse", "HEAD");
    const deleted = await new GitArtifactBuilder(new SimpleGitRunner()).build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-delete", artifactId: "artifact:owned-delete",
      contract: { id: "artifact:owned-delete", revision: 1, digest: "sha256:contract" }, inputFingerprint: `sha256:${"c".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit: binaryCandidate, candidateCommit: deleteCandidate, allowedPaths: ["owned.txt"]
    });
    expect(deleted.entries).toEqual([expect.objectContaining({ operation: "delete", oldPath: "owned.txt", oldOid: binaryOid, oldMode: "100755" })]);
  });

  it("rejects gitlinks and paths outside the artifact contract before retention", async () => {
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    await git(repo, "switch", "--create", "candidate");
    await git(repo, "update-index", "--add", "--cacheinfo", `160000,${baseCommit},owned-submodule`);
    await git(repo, "commit", "-m", "candidate gitlink");
    const gitlinkCandidate = await git(repo, "rev-parse", "HEAD");
    const builder = new GitArtifactBuilder(new SimpleGitRunner());

    await expect(builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-gitlink", artifactId: "artifact:gitlink",
      contract: { id: "artifact:gitlink", revision: 1, digest: "sha256:contract" }, inputFingerprint: `sha256:${"d".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit, candidateCommit: gitlinkCandidate, allowedPaths: ["owned-submodule"]
    })).rejects.toThrow(/gitlink/i);

    await writeFile(path.join(repo, "outside.txt"), "outside\n", "utf8");
    await git(repo, "add", "outside.txt");
    await git(repo, "commit", "-m", "candidate outside scope");
    const outsideCandidate = await git(repo, "rev-parse", "HEAD");
    await expect(builder.build({
      cwd: repo, runId: "run-1", nodeId: "node-1", attemptId: "attempt-outside", artifactId: "artifact:outside",
      contract: { id: "artifact:outside", revision: 1, digest: "sha256:contract" }, inputFingerprint: `sha256:${"e".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo", baseCommit: gitlinkCandidate, candidateCommit: outsideCandidate, allowedPaths: ["owned.txt"]
    })).rejects.toThrow(/outside its contract/i);
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
