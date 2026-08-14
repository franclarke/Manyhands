import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateManifestIdentity,
  type ChangeSetEntry,
  type ChangeSetManifest,
  type DigestHasher
} from "@manyhands/contracts";
import type { GitRunner, GitTreeEntry } from "./runner.js";

export interface ExactMaterializationResult {
  treeSha: string;
  executionBaseCommit: string;
}

/** Builds an execution base from declared object IDs, never source commit ancestry. */
export class ExactGitManifestMaterializer {
  constructor(
    private readonly git: GitRunner,
    private readonly hasher: DigestHasher = sha256
  ) {}

  async materialize(input: {
    cwd: string;
    baseCommit: string;
    manifest: ChangeSetManifest;
    allowedPaths: readonly string[];
  }): Promise<ExactMaterializationResult> {
    const identity = validateManifestIdentity(input.manifest, this.hasher);
    if (!identity.ok) throw new Error(`Invalid artifact manifest: ${identity.issues.map((issue) => issue.code).join(", ")}.`);
    if (await this.git.cherryPickHead(input.cwd) !== undefined) {
      throw new Error("Cannot materialize an artifact while a Git cherry-pick is active.");
    }
    const baseTree = await this.git.revParse(input.cwd, `${input.baseCommit}^{tree}`);
    if (baseTree !== input.manifest.baseTreeSha) {
      throw new Error(`Artifact base tree mismatch: expected ${input.manifest.baseTreeSha}, found ${baseTree}.`);
    }
    for (const entry of input.manifest.entries) assertOwned(entry, input.allowedPaths);

    const indexDirectory = await mkdtemp(join(tmpdir(), "mh-artifact-index-"));
    const indexFile = join(indexDirectory, "index");
    try {
      await this.git.readTree({ cwd: input.cwd, tree: input.manifest.baseTreeSha, indexFile });
      for (const entry of input.manifest.entries) await this.applyEntry(input.cwd, input.manifest.baseTreeSha, entry, indexFile);
      const treeSha = await this.git.writeTree({ cwd: input.cwd, indexFile });
      if (treeSha !== input.manifest.resultTreeSha) {
        throw new Error(`Artifact materialization tree mismatch: expected ${input.manifest.resultTreeSha}, found ${treeSha}.`);
      }
      const executionBaseCommit = await this.git.commitTree({
        cwd: input.cwd,
        tree: treeSha,
        parent: input.baseCommit,
        message: `mh: materialize ${input.manifest.manifestDigest}`
      });
      // Do not use checkout/reset here: either can invoke repository-defined
      // attributes and smudge filters.  The tree already exists as exact Git
      // objects, so write only declared blob bytes and synchronize the index.
      for (const entry of input.manifest.entries) await this.applyWorktreeEntry(input.cwd, entry);
      await this.git.readTree({ cwd: input.cwd, tree: treeSha });
      await this.git.updateRef({ cwd: input.cwd, ref: "HEAD", target: executionBaseCommit, expectedOldOid: input.baseCommit });
      return { treeSha, executionBaseCommit };
    } catch (error) {
      // The temporary index is the only mutable materialization state until
      // the verified tree has been committed. Preserve the managed worktree's
      // pre-existing state rather than resetting unrelated operator changes.
      throw error;
    } finally {
      await rm(indexDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async applyWorktreeEntry(cwd: string, entry: ChangeSetEntry): Promise<void> {
    if (entry.operation === "delete") {
      if (entry.oldPath === undefined) throw new Error("Invalid delete entry.");
      await rm(join(cwd, entry.oldPath), { force: true });
      return;
    }
    if (entry.newPath === undefined || entry.newOid === undefined || entry.newMode === undefined) {
      throw new Error("Invalid artifact worktree postimage.");
    }
    const destination = join(cwd, entry.newPath);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, await this.git.readBlob({ cwd, oid: entry.newOid }));
    await chmod(destination, entry.newMode === "100755" ? 0o755 : 0o644);
  }

  private async applyEntry(cwd: string, baseTree: string, entry: ChangeSetEntry, indexFile: string): Promise<void> {
    const oldPath = entry.oldPath;
    const newPath = entry.newPath;
    if (entry.operation === "add") {
      if (newPath === undefined || entry.newOid === undefined || entry.newMode === undefined) throw new Error("Invalid add entry.");
      if (await this.git.treeEntry({ cwd, tree: baseTree, path: newPath }) !== undefined) throw new Error(`Artifact add has an existing preimage: ${newPath}.`);
      await this.assertSupportedPostimage(cwd, entry.newMode, entry.newOid);
      await this.git.updateIndexEntry({ cwd, mode: entry.newMode, oid: entry.newOid, path: newPath, indexFile });
      return;
    }
    if (oldPath === undefined || entry.oldOid === undefined || entry.oldMode === undefined) throw new Error("Invalid artifact preimage.");
    const observed = await this.git.treeEntry({ cwd, tree: baseTree, path: oldPath });
    assertPreimage(oldPath, observed, entry.oldMode, entry.oldOid);
    if (entry.operation === "delete") {
      await this.git.removeIndexEntry({ cwd, path: oldPath, indexFile });
      return;
    }
    if (newPath === undefined || entry.newOid === undefined || entry.newMode === undefined) throw new Error("Invalid artifact postimage.");
    if (entry.oldMode === entry.newMode && entry.oldOid === entry.newOid) {
      throw new Error(`Artifact entry is a no-op: ${newPath}.`);
    }
    await this.assertSupportedPostimage(cwd, entry.newMode, entry.newOid);
    await this.git.updateIndexEntry({ cwd, mode: entry.newMode, oid: entry.newOid, path: newPath, indexFile });
  }

  private async assertSupportedPostimage(cwd: string, mode: string, oid: string): Promise<void> {
    if (mode === "120000") throw new Error("Symlink artifact materialization requires an explicit sandbox capability.");
    if (mode === "160000") throw new Error("Gitlink artifact materialization requires an explicit submodule capability.");
    if (mode !== "100644" && mode !== "100755") throw new Error(`Unsupported Git artifact mode ${mode}.`);
    const type = await this.git.objectType({ cwd, oid });
    if (type !== "blob") throw new Error(`Artifact mode ${mode} requires a blob object, found ${type}.`);
  }
}

function assertOwned(entry: ChangeSetEntry, allowedPaths: readonly string[]): void {
  for (const value of [entry.oldPath, entry.newPath]) {
    if (value !== undefined && !allowedPaths.includes(value)) {
      throw new Error(`Artifact path is outside its contract: ${value}.`);
    }
  }
}

function assertPreimage(path: string, observed: GitTreeEntry | undefined, mode: string, oid: string): void {
  if (observed === undefined || observed.mode !== mode || observed.oid !== oid) {
    throw new Error(`Artifact preimage mismatch: ${path}.`);
  }
}

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
