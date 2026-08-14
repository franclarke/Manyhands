import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRunCommandEnvelope, type RunEventInput } from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import {
  ExactGitManifestMaterializer,
  GitArtifactBuilder,
  SimpleGitRunner
} from "@manyhands/execution-core";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";

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

    const stateRoot = path.join(directory, "daemon");
    const events = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
    const runId = "run-ga";
    const authority = await events.claimAuthority(runId, "seed:ga");
    await events.appendFenced(runId, 0, authority, [
      input("run.created", { goal: "Qualify exact artifact evidence" }),
      input("graph.revision.proposed", { graphId: "graph-ga", revision: 1 }),
      input("graph.revision.approved", { graphId: "graph-ga", revision: 1 }),
      input("integration.started", { attemptId: "integration-ga-1", nodeId: "node-ga", inputFingerprint: candidateManifest.inputFingerprint, executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-ga"] }),
      input("integration.completed", { attemptId: "integration-ga-1", nodeId: "node-ga", manifestId: "integration-ga-1", candidateCommit: candidate, candidate: exact(candidateManifest), matrix: matrix(candidate) })
    ]);
    const kernel = await daemon(stateRoot, "first");
    const review = buildRunCommandEnvelope({ commandId: "review-ga", runId, expectedRevision: 5, submittedAt: at, command: { type: "record_human_review", review: { reviewId: "review-ga", attemptId: "integration-ga-1", nodeId: "node-ga", candidate: exact(candidateManifest), rubricDigest: "sha256:rubric", authority: "operator", reviewerId: "operator:ga", decision: "approved", reviewedAt: at } } }, sha256);
    await kernel.engine.submit(review);
    await kernel.close();
    const worker = await events.claimAuthority(runId, "worker:ga");
    await events.appendFenced(runId, 7, worker, [
      input("artifact.adopted", { artifact: { schemaVersion: 1, artifactId: "artifact-ga", runId, nodeId: "node-ga", digest: changeSet.manifestDigest, producerAttemptId: "integration-ga-1", contract: { id: "artifact:ga", revision: "1" }, kind: "manifest", location: changeSet.manifestDigest, manifest: changeSet, adoptedAt: at } }),
      input("integration.started", { attemptId: "integration-ga-2", nodeId: "node-ga", inputFingerprint: "sha256:replacement", retryOfAttemptId: "integration-ga-1", executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-ga"] }),
      input("integration.completed", { attemptId: "integration-ga-2", nodeId: "node-ga", manifestId: "integration-ga-2", candidateCommit: candidate, candidate: { ...exact(candidateManifest), manifestDigest: "sha256:replacement" }, matrix: matrix(candidate) })
    ]);
    const recovered = await daemon(stateRoot, "recovered");
    try {
      expect((await recovered.engine.query(runId)).humanReviews["review-ga"]?.status).toBe("stale");
      expect((await recovered.engine.query(runId)).adoptedArtifacts["artifact-ga"]?.manifest?.retainedByRef).toBe(changeSet.retainedByRef);
    } finally { await recovered.close(); }
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

const at = "2026-08-14T12:00:00.000Z";
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function input(type: string, payload: Record<string, unknown>): RunEventInput { return { eventId: `ga:${type}:${payload.attemptId as string ?? randomUUID()}`, occurredAt: at, type, payload } as RunEventInput; }
function exact(candidate: { manifestDigest: string; commitOid: string; treeOid: string }) { return { manifestDigest: candidate.manifestDigest, commitOid: candidate.commitOid, treeOid: candidate.treeOid }; }
function matrix(candidateCommit: string) { return { matrixId: `matrix:${candidateCommit.slice(0, 8)}`, candidateCommit, validationContract: { id: "validation-ga", revision: "1" }, criteria: [{ criterionId: "criterion-ga", obligationId: "obligation-ga", status: "satisfied", justification: "Exact candidate verified.", evidenceRefs: ["evidence-ga"] }], outcome: "verified", validationRecipeDigest: "sha256:recipe", observations: [] }; }
function daemon(stateRoot: string, label: string) { return startProductiveDaemon({ stateRoot, endpoint: process.platform === "win32" ? `\\\\.\\pipe\\mh-stage7-ga-${label}-${randomUUID()}` : path.join(os.tmpdir(), `mh-stage7-ga-${label}-${randomUUID()}.sock`), processStartIdentity: `process:ga:${label}`, processIdentityProbe: { probe: async () => "dead" as const }, createDaemonEpoch: () => `daemon:ga:${label}`, clock: () => at, production: false, profile: { kind: "deterministic_fake", nodeExecutable: process.execPath, workerScriptPath: process.execPath, cwd: process.cwd() } }); }

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
