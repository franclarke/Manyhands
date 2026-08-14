import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitArtifactRetainer, SimpleGitRunner, retainedArtifactRef } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-retention-"));
  repo = path.join(directory, "repo");
  await git(directory, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.email", "test@manyhands.local");
  await git(repo, "config", "user.name", "ManyHands Test");
  await git(repo, "commit", "--allow-empty", "-m", "base");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 7 retained Git artifacts", () => {
  it("keeps an adopted candidate reachable through a run-owned ref after Git GC", async () => {
    await git(repo, "switch", "--create", "candidate");
    await writeFile(path.join(repo, "artifact.txt"), "candidate\n", "utf8");
    await git(repo, "add", "artifact.txt");
    await git(repo, "commit", "-m", "candidate");
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const candidateTree = await git(repo, "rev-parse", "HEAD^{tree}");

    const retained = await new GitArtifactRetainer(new SimpleGitRunner()).retain({
      cwd: repo,
      runId: "run-1",
      attemptId: "attempt-1",
      artifactId: "artifact:owned",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      candidateCommit,
      candidateTree
    });

    await git(repo, "switch", "main");
    await git(repo, "branch", "--delete", "--force", "candidate");
    await git(repo, "reflog", "expire", "--expire=now", "--all");
    await git(repo, "gc", "--prune=now");

    expect(retained.ref).toMatch(/^refs\/manyhands\/runs\/run-1-[0-9a-f]+\/attempts\/attempt-1-[0-9a-f]+\/artifacts\//u);
    expect(await git(repo, "rev-parse", retained.ref)).toBe(candidateCommit);
    expect(await git(repo, "rev-parse", `${retained.ref}^{tree}`)).toBe(candidateTree);
  });

  it("uses stable run, attempt, and artifact identity instead of the manifest digest", () => {
    expect(retainedArtifactRef("run-1", "attempt-1", "artifact:owned"))
      .toBe(retainedArtifactRef("run-1", "attempt-1", "artifact:owned"));
  });

  it("uses distinct refs for identifiers that normalize to the same readable segment", () => {
    expect(retainedArtifactRef("run:a", "attempt-1", "artifact:owned"))
      .not.toBe(retainedArtifactRef("run-a", "attempt-1", "artifact:owned"));
  });

  it("never moves a run-owned ref from its original retained candidate", async () => {
    await git(repo, "switch", "--create", "first-candidate");
    await writeFile(path.join(repo, "artifact.txt"), "first\n", "utf8");
    await git(repo, "add", "artifact.txt");
    await git(repo, "commit", "-m", "first candidate");
    const firstCommit = await git(repo, "rev-parse", "HEAD");

    await git(repo, "switch", "main");
    await git(repo, "switch", "--create", "second-candidate");
    await writeFile(path.join(repo, "artifact.txt"), "second\n", "utf8");
    await git(repo, "add", "artifact.txt");
    await git(repo, "commit", "-m", "second candidate");
    const secondCommit = await git(repo, "rev-parse", "HEAD");
    const secondTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const ref = retainedArtifactRef("run-1", "attempt-1", "artifact:owned");
    await git(repo, "update-ref", ref, firstCommit);

    await expect(new GitArtifactRetainer(new SimpleGitRunner()).retain({
      cwd: repo,
      runId: "run-1",
      attemptId: "attempt-1",
      artifactId: "artifact:owned",
      manifestDigest: `sha256:${"b".repeat(64)}`,
      candidateCommit: secondCommit,
      candidateTree: secondTree
    })).rejects.toThrow(/already names a different candidate/i);

    expect(await git(repo, "rev-parse", ref)).toBe(firstCommit);
  });

  it("requires a retained-candidate-bound durable release authorization before deleting a ref", async () => {
    const candidateCommit = await git(repo, "rev-parse", "HEAD");
    const candidateTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const retainer = new GitArtifactRetainer(new SimpleGitRunner());
    const retained = await retainer.retain({ cwd: repo, runId: "run-release", attemptId: "attempt-release", artifactId: "artifact-release", manifestDigest: `sha256:${"c".repeat(64)}`, candidateCommit, candidateTree });
    await expect(retainer.release({ cwd: repo, retained, decision: { decisionId: "release-blocked", artifactId: "artifact-release", retainedByRef: retained.ref, candidateCommit: "wrong", authorizedAt: "2026-08-14T12:00:00.000Z" } })).rejects.toThrow(/not authorized/i);
    expect(await git(repo, "rev-parse", retained.ref)).toBe(candidateCommit);
    await retainer.release({ cwd: repo, retained, decision: { decisionId: "release-clear", artifactId: "artifact-release", retainedByRef: retained.ref, candidateCommit, authorizedAt: "2026-08-14T12:00:00.000Z" } });
    await expect(git(repo, "rev-parse", retained.ref)).rejects.toThrow();
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
