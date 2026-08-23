import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCandidateTreeManifest,
  buildChangeSetManifest,
  type CanonicalContractRef,
  type CandidateTreeManifest,
  type ChangeSetEntry,
  type ChangeSetManifest,
  type DigestHasher
} from "@manyhands/contracts";
import { GitArtifactRetainer, retainedArtifactRef } from "./artifact-retention.js";
import type { GitRunner } from "./runner.js";

/** Converts an orchestrator-owned candidate diff into one immutable, scoped manifest. */
export class GitArtifactBuilder {
  private readonly retainer: GitArtifactRetainer;

  constructor(
    private readonly git: GitRunner,
    private readonly hasher: DigestHasher = sha256
  ) {
    this.retainer = new GitArtifactRetainer(git);
  }

  async build(input: {
    cwd: string;
    runId: string;
    nodeId: string;
    attemptId: string;
    artifactId: string;
    contract: CanonicalContractRef;
    inputFingerprint: string;
    repositoryObjectStoreId: string;
    baseCommit: string;
    candidateCommit: string;
    /** All paths the node may change; defaults to this artifact's paths. */
    candidateAllowedPaths?: readonly string[];
    allowedPaths: readonly string[];
  }): Promise<ChangeSetManifest> {
    const [baseTreeSha, candidateCommit, candidateTreeSha, raw] = await Promise.all([
      this.git.revParse(input.cwd, `${input.baseCommit}^{tree}`),
      this.git.revParse(input.cwd, `${input.candidateCommit}^{commit}`),
      this.git.revParse(input.cwd, `${input.candidateCommit}^{tree}`),
      this.git.diffTreeRaw({ cwd: input.cwd, from: input.baseCommit, to: input.candidateCommit })
    ]);
    const candidateAllowedPaths = input.candidateAllowedPaths ?? input.allowedPaths;
    const candidateEntries = parseDiffTree(raw);
    for (const entry of candidateEntries) {
      assertOwned(entry, candidateAllowedPaths);
      assertSupportedArtifactEntry(entry);
    }
    const entries = candidateEntries.filter((entry) => isOwned(entry, input.allowedPaths));
    if (entries.length === 0) throw new Error("Cannot build an artifact manifest for a no-op candidate.");

    const resultTreeSha = await scopedResultTree(this.git, input.cwd, baseTreeSha, entries);
    const manifest = buildChangeSetManifest({
      id: input.artifactId,
      contract: input.contract,
      producerNodeId: input.nodeId,
      producerAttemptId: input.attemptId,
      inputFingerprint: input.inputFingerprint,
      repositoryObjectStoreId: input.repositoryObjectStoreId,
      objectFormat: objectFormat(candidateCommit),
      sourceCandidate: { commitOid: candidateCommit, treeOid: candidateTreeSha },
      retainedByRef: retainedArtifactRef(input.runId, input.attemptId, input.artifactId),
      kind: "change_set",
      baseTreeSha,
      resultTreeSha,
      entries
    }, this.hasher);
    await this.retainer.retain({
      cwd: input.cwd,
      runId: input.runId,
      attemptId: input.attemptId,
      artifactId: input.artifactId,
      manifestDigest: manifest.manifestDigest,
      candidateCommit,
      candidateTree: candidateTreeSha
    });
    return manifest;
  }

  /**
   * Retains the whole immutable candidate identity for evidence. Unlike a
   * ChangeSetManifest this does not grant materialization authority; it only
   * makes the exact commit/tree cited by validation reachable for its run.
   */
  async buildCandidateTree(input: {
    cwd: string;
    runId: string;
    nodeId: string;
    attemptId: string;
    contract: CanonicalContractRef;
    inputFingerprint: string;
    repositoryObjectStoreId: string;
    baseCommit: string;
    candidateCommit: string;
  }): Promise<CandidateTreeManifest> {
    const [baseCommitOid, candidateCommit, candidateTree] = await Promise.all([
      this.git.revParse(input.cwd, `${input.baseCommit}^{commit}`),
      this.git.revParse(input.cwd, `${input.candidateCommit}^{commit}`),
      this.git.revParse(input.cwd, `${input.candidateCommit}^{tree}`)
    ]);
    const manifest = buildCandidateTreeManifest({
      id: `candidate:${input.attemptId}`,
      contract: input.contract,
      producerNodeId: input.nodeId,
      producerAttemptId: input.attemptId,
      inputFingerprint: input.inputFingerprint,
      repositoryObjectStoreId: input.repositoryObjectStoreId,
      objectFormat: objectFormat(candidateCommit),
      sourceCandidate: { commitOid: candidateCommit, treeOid: candidateTree },
      retainedByRef: retainedArtifactRef(input.runId, input.attemptId, "candidate"),
      kind: "candidate_tree",
      baseCommitOid,
      commitOid: candidateCommit,
      treeOid: candidateTree
    }, this.hasher);
    await this.retainer.retain({
      cwd: input.cwd,
      runId: input.runId,
      attemptId: input.attemptId,
      artifactId: "candidate",
      manifestDigest: manifest.manifestDigest,
      candidateCommit,
      candidateTree
    });
    return manifest;
  }
}

async function scopedResultTree(
  git: GitRunner,
  cwd: string,
  baseTreeSha: string,
  entries: readonly ChangeSetEntry[]
): Promise<string> {
  const indexDirectory = await mkdtemp(join(tmpdir(), "mh-artifact-index-"));
  const indexFile = join(indexDirectory, "artifact-index");
  try {
    await git.readTree({ cwd, tree: baseTreeSha, indexFile });
    for (const entry of entries) {
      if (entry.operation === "delete") {
        if (entry.oldPath === undefined) throw new Error("Invalid delete artifact entry.");
        await git.removeIndexEntry({ cwd, path: entry.oldPath, indexFile });
        continue;
      }
      if (entry.newPath === undefined || entry.newOid === undefined || entry.newMode === undefined) {
        throw new Error("Invalid artifact postimage.");
      }
      await git.updateIndexEntry({ cwd, mode: entry.newMode, oid: entry.newOid, path: entry.newPath, indexFile });
    }
    return await git.writeTree({ cwd, indexFile });
  } finally {
    await rm(indexDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseDiffTree(raw: Buffer): ChangeSetEntry[] {
  const fields = raw.toString("utf8").split("\0");
  const entries: ChangeSetEntry[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const header = fields[index++]!;
    const path = fields[index++]!;
    const match = /^:(\d{6})\s+(\d{6})\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([A-Z])$/u.exec(header);
    if (match === null || path.length === 0) throw new Error("Malformed NUL-delimited Git diff-tree record.");
    const [, oldMode, newMode, oldOid, newOid, status] = match;
    if (status === "A") {
      entries.push({ newPath: path, operation: "add", newOid, newMode });
    } else if (status === "D") {
      entries.push({ oldPath: path, operation: "delete", oldOid, oldMode });
    } else if (status === "M") {
      entries.push({ oldPath: path, newPath: path, operation: "modify", oldOid, newOid, oldMode, newMode });
    } else if (status === "T") {
      entries.push({ oldPath: path, newPath: path, operation: "type_change", oldOid, newOid, oldMode, newMode });
    } else {
      throw new Error(`Unsupported Git diff status ${status}.`);
    }
  }
  return entries;
}

function assertOwned(entry: ChangeSetEntry, allowedPaths: readonly string[]): void {
  if (!isOwned(entry, allowedPaths)) {
    const path = entry.oldPath ?? entry.newPath;
    throw new Error(`Artifact path is outside its contract: ${path}.`);
  }
}

function isOwned(entry: ChangeSetEntry, allowedPaths: readonly string[]): boolean {
  for (const path of [entry.oldPath, entry.newPath]) {
    if (path !== undefined && !allowedPaths.includes(path)) return false;
  }
  return true;
}

function assertSupportedArtifactEntry(entry: ChangeSetEntry): void {
  for (const mode of [entry.oldMode, entry.newMode]) {
    if (mode === undefined || mode === "100644" || mode === "100755") continue;
    if (mode === "120000") throw new Error("Symlink artifacts require an explicit sandbox capability.");
    if (mode === "160000") throw new Error("Gitlink artifacts require an explicit submodule capability.");
    throw new Error(`Unsupported Git artifact mode ${mode}.`);
  }
}

function objectFormat(oid: string): "sha1" | "sha256" {
  if (/^[0-9a-f]{40}$/u.test(oid)) return "sha1";
  if (/^[0-9a-f]{64}$/u.test(oid)) return "sha256";
  throw new Error(`Unsupported Git object ID: ${oid}.`);
}

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
