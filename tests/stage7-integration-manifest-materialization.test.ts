import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChangeSetManifest, type DigestHasher } from "@manyhands/contracts";
import { IntegrationManifestExecutor, SimpleGitRunner, createIntegrationRequestManifest } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-integration-manifest-"));
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

describe("Stage 7 integration manifest materialization", () => {
  it("integrates an adopted manifest by exact tree construction, not source commit ancestry", async () => {
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
      id: "artifact:owned",
      contract: { id: "artifact:owned", revision: 1, digest: "sha256:contract" },
      producerNodeId: "node:child",
      producerAttemptId: "attempt:child",
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: sourceCandidate, treeOid: resultTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-child/artifacts/owned",
      kind: "change_set",
      baseTreeSha: baseTree,
      resultTreeSha: resultTree,
      entries: [{ oldPath: "owned.txt", newPath: "owned.txt", operation: "modify", oldOid, newOid, oldMode: "100644", newMode: "100644" }]
    }, sha256);
    const request = createIntegrationRequestManifest({
      runId: "run-1",
      integrationAttemptId: "attempt:parent",
      compositeNode: { id: "node:parent", graphRevision: 1 },
      base: { manifestId: "base", resultingCommit: baseCommit, inputFingerprint: `sha256:${"a".repeat(64)}` },
      availableArtifacts: [{
        schemaVersion: 1 as const,
        artifactId: "artifact:owned:attempt:child",
        runId: "run-1",
        nodeId: "node:child",
        digest: manifest.manifestDigest,
        producerAttemptId: "attempt:child",
        contract: { id: "artifact:owned", revision: "1" },
        kind: "manifest" as const,
        location: manifest.manifestDigest,
        manifest,
        adoptedAt: "2026-08-14T00:00:00.000Z"
      }],
      requiredArtifactIds: ["artifact:owned:attempt:child"],
      seamRevisions: [],
      parentGoal: "Integrate child output",
      validationContract: { id: "validation:parent", revision: "1" },
      outputArtifactContract: { id: "artifact:parent", revision: "1" },
      createdAt: "2026-08-14T00:00:00.000Z"
    });

    const result = await new IntegrationManifestExecutor({
      git: new SimpleGitRunner(),
      validate: async () => ({ matrixId: "matrix:parent", outcome: "verified" as const }),
      digestCandidate: async () => "sha256:integrated"
    }).integrate({ request, worktreePath: repo });

    expect(result.disposition).toBe("success");
    expect(result.operations).toEqual([expect.objectContaining({ operation: "materialize_manifest", outcome: "applied" })]);
    expect(await git(repo, "rev-parse", "HEAD^{tree}")).toBe(resultTree);
    expect(await git(repo, "merge-base", "--is-ancestor", sourceCandidate, "HEAD").then(() => true, () => false)).toBe(false);
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
