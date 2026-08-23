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
  it("composes disjoint sibling manifests produced from the same base tree", async () => {
    await writeFile(path.join(repo, "first.txt"), "before first\n", "utf8");
    await writeFile(path.join(repo, "second.txt"), "before second\n", "utf8");
    await git(repo, "add", "first.txt", "second.txt");
    await git(repo, "commit", "-m", "sibling base");
    const baseCommit = await git(repo, "rev-parse", "HEAD");
    const baseTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const firstOldOid = await git(repo, "rev-parse", "HEAD:first.txt");
    const secondOldOid = await git(repo, "rev-parse", "HEAD:second.txt");

    await git(repo, "switch", "--create", "candidate-first");
    await writeFile(path.join(repo, "first.txt"), "after first\n", "utf8");
    await git(repo, "add", "first.txt");
    await git(repo, "commit", "-m", "first sibling");
    const firstCommit = await git(repo, "rev-parse", "HEAD");
    const firstTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const firstNewOid = await git(repo, "rev-parse", "HEAD:first.txt");

    await git(repo, "switch", "main");
    await git(repo, "switch", "--create", "candidate-second");
    await writeFile(path.join(repo, "second.txt"), "after second\n", "utf8");
    await git(repo, "add", "second.txt");
    await git(repo, "commit", "-m", "second sibling");
    const secondCommit = await git(repo, "rev-parse", "HEAD");
    const secondTree = await git(repo, "rev-parse", "HEAD^{tree}");
    const secondNewOid = await git(repo, "rev-parse", "HEAD:second.txt");
    await git(repo, "switch", "main");

    const firstManifest = buildChangeSetManifest({
      id: "artifact:first",
      contract: { id: "artifact:first", revision: 1, digest: "sha256:first-contract" },
      producerNodeId: "node:first",
      producerAttemptId: "attempt:first",
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: firstCommit, treeOid: firstTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-first/artifacts/first",
      kind: "change_set",
      baseTreeSha: baseTree,
      resultTreeSha: firstTree,
      entries: [{ oldPath: "first.txt", newPath: "first.txt", operation: "modify", oldOid: firstOldOid, newOid: firstNewOid, oldMode: "100644", newMode: "100644" }]
    }, sha256);
    const secondManifest = buildChangeSetManifest({
      id: "artifact:second",
      contract: { id: "artifact:second", revision: 1, digest: "sha256:second-contract" },
      producerNodeId: "node:second",
      producerAttemptId: "attempt:second",
      inputFingerprint: `sha256:${"b".repeat(64)}`,
      repositoryObjectStoreId: "object-store:repo",
      objectFormat: "sha1",
      sourceCandidate: { commitOid: secondCommit, treeOid: secondTree },
      retainedByRef: "refs/manyhands/runs/run-1/attempts/attempt-second/artifacts/second",
      kind: "change_set",
      baseTreeSha: baseTree,
      resultTreeSha: secondTree,
      entries: [{ oldPath: "second.txt", newPath: "second.txt", operation: "modify", oldOid: secondOldOid, newOid: secondNewOid, oldMode: "100644", newMode: "100644" }]
    }, sha256);
    const request = createIntegrationRequestManifest({
      runId: "run-1",
      integrationAttemptId: "attempt:parent",
      compositeNode: { id: "node:parent", graphRevision: 1 },
      base: { manifestId: "base", resultingCommit: baseCommit, inputFingerprint: `sha256:${"c".repeat(64)}` },
      availableArtifacts: [
        adoptedArtifact("artifact:first:attempt:first", "node:first", "attempt:first", firstManifest),
        adoptedArtifact("artifact:second:attempt:second", "node:second", "attempt:second", secondManifest)
      ],
      requiredArtifactIds: ["artifact:first:attempt:first", "artifact:second:attempt:second"],
      seamRevisions: [],
      parentGoal: "Integrate sibling outputs",
      validationContract: { id: "validation:parent", revision: "1" },
      outputArtifactContract: { id: "artifact:parent", revision: "1" },
      createdAt: "2026-08-20T00:00:00.000Z"
    });

    const result = await new IntegrationManifestExecutor({
      git: new SimpleGitRunner(),
      validate: async () => ({ matrixId: "matrix:parent", outcome: "verified" as const }),
      digestCandidate: async () => "sha256:integrated"
    }).integrate({ request, worktreePath: repo });

    expect(result.disposition).toBe("success");
    expect(result.operations).toHaveLength(2);
    expect(await git(repo, "show", "HEAD:first.txt")).toBe("after first");
    expect(await git(repo, "show", "HEAD:second.txt")).toBe("after second");
  });

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

function adoptedArtifact(
  artifactId: string,
  nodeId: string,
  attemptId: string,
  manifest: ReturnType<typeof buildChangeSetManifest>
) {
  return {
    schemaVersion: 1 as const,
    artifactId,
    runId: "run-1",
    nodeId,
    digest: manifest.manifestDigest,
    producerAttemptId: attemptId,
    contract: { id: manifest.contract.id, revision: String(manifest.contract.revision) },
    kind: "manifest" as const,
    location: manifest.manifestDigest,
    manifest,
    adoptedAt: "2026-08-20T00:00:00.000Z"
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
