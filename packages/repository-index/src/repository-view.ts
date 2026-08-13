import path from "node:path";

import { repositoryDigest, repositoryFactId } from "./identity.js";
import {
  buildRepositoryModelFromTree,
  listGitTree,
  readBlob,
  type RepositoryGitEntry,
  type RepositoryModel,
  type RepositoryModelInspection
} from "./repository-model.js";
import {
  buildResourceCatalog,
  type ResourceAliasInput,
  type ResourceCatalog
} from "./resource-catalog.js";

export interface RepositoryOverlayEntry {
  operation: "add" | "modify" | "delete" | "type_change";
  oldPath?: string;
  newPath?: string;
  oldOid?: string;
  newOid?: string;
  oldMode?: string;
  newMode?: string;
  detectedRenameFrom?: string;
}

export interface RepositoryOverlay {
  manifestDigest: string;
  baseTreeSha: string;
  resultTreeSha: string;
  entries: RepositoryOverlayEntry[];
}

export interface RepositoryView {
  schemaVersion: 1;
  baseModelDigest: string;
  appliedManifestDigests: string[];
  treeSha: string;
  contentDigest: string;
  resourceCatalogDigest: string;
  digest: string;
  model: RepositoryModel;
  catalog: ResourceCatalog;
}

export interface ComposeRepositoryViewInput {
  rootPath: string;
  inspection: RepositoryModelInspection;
  overlays: RepositoryOverlay[];
  gitPath?: string;
  signal?: AbortSignal;
}

export async function composeRepositoryView(input: ComposeRepositoryViewInput): Promise<RepositoryView> {
  const rootPath = path.resolve(input.rootPath);
  const gitPath = input.gitPath ?? "git";
  let currentTreeSha = input.inspection.model.treeSha;
  let currentEntries = new Map(input.inspection.model.gitEntries.map((entry) => [entry.path, entry]));
  const appliedManifestDigests: string[] = [];
  const aliases: ResourceAliasInput[] = [];
  const seenManifests = new Set<string>();

  for (const overlay of input.overlays) {
    if (overlay.manifestDigest.trim() === "") throw new Error("Repository overlay manifestDigest must be non-empty.");
    if (seenManifests.has(overlay.manifestDigest)) {
      throw new Error(`Repository overlay ${overlay.manifestDigest} is applied more than once.`);
    }
    if (overlay.baseTreeSha !== currentTreeSha) {
      throw new Error(
        `Repository overlay ${overlay.manifestDigest} expects base tree ${overlay.baseTreeSha}, current tree is ${currentTreeSha}.`
      );
    }
    const expectedEntries = applyOverlayEntries(currentEntries, overlay);
    const actualEntries = await listGitTree(gitPath, rootPath, overlay.resultTreeSha, input.signal);
    assertSameTree(expectedEntries, actualEntries, overlay);
    currentEntries = new Map(actualEntries.map((entry) => [entry.path, entry]));
    currentTreeSha = overlay.resultTreeSha;
    appliedManifestDigests.push(overlay.manifestDigest);
    aliases.push(...renameAliases(overlay));
    seenManifests.add(overlay.manifestDigest);
  }

  const finalEntries = [...currentEntries.values()].sort((left, right) => left.path.localeCompare(right.path));
  const model = input.overlays.length === 0
    ? input.inspection.model
    : await buildRepositoryModelFromTree({
        rootPath,
        gitPath,
        snapshot: input.inspection.snapshot,
        treeSha: currentTreeSha,
        objectFormat: input.inspection.model.objectFormat,
        entries: finalEntries,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
  aliases.push(...await symlinkAliases({
    rootPath,
    gitPath,
    model,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }));
  const contentDigest = repositoryDigest({
    baseModelDigest: input.inspection.model.digest,
    appliedManifestDigests,
    treeSha: currentTreeSha,
    entryDigest: repositoryDigest(finalEntries)
  });
  const catalog = buildResourceCatalog({ model, repositoryContentDigest: contentDigest, aliases });
  const material = {
    schemaVersion: 1 as const,
    baseModelDigest: input.inspection.model.digest,
    appliedManifestDigests,
    treeSha: currentTreeSha,
    contentDigest,
    resourceCatalogDigest: catalog.digest
  };
  return {
    ...material,
    digest: repositoryDigest(material),
    model,
    catalog
  };
}

function applyOverlayEntries(
  current: ReadonlyMap<string, RepositoryGitEntry>,
  overlay: RepositoryOverlay
): Map<string, RepositoryGitEntry> {
  const result = new Map(current);
  const touched = new Set<string>();
  for (const [index, entry] of overlay.entries.entries()) {
    validateEntry(entry, index, overlay.manifestDigest);
    if (entry.oldPath !== undefined) {
      if (touched.has(entry.oldPath)) throw new Error(`Repository overlay touches ${entry.oldPath} more than once.`);
      const existing = result.get(entry.oldPath);
      if (existing === undefined || existing.oid !== entry.oldOid || existing.mode !== entry.oldMode) {
        throw new Error(`Repository overlay ${overlay.manifestDigest} has a stale preimage for ${entry.oldPath}.`);
      }
      result.delete(entry.oldPath);
      touched.add(entry.oldPath);
    }
    if (entry.newPath !== undefined) {
      if (touched.has(entry.newPath)) throw new Error(`Repository overlay touches ${entry.newPath} more than once.`);
      if (entry.operation === "add" && result.has(entry.newPath)) {
        throw new Error(`Repository overlay ${overlay.manifestDigest} adds existing path ${entry.newPath}.`);
      }
      result.set(entry.newPath, {
        path: entry.newPath,
        oid: entry.newOid!,
        mode: entry.newMode!,
        kind: entryKind(entry.newMode!)
      });
      touched.add(entry.newPath);
    }
  }
  return result;
}

function validateEntry(entry: RepositoryOverlayEntry, index: number, manifestDigest: string): void {
  const prefix = `Repository overlay ${manifestDigest} entry ${index}`;
  if (entry.operation === "add") {
    if (entry.newPath === undefined || entry.newOid === undefined || entry.newMode === undefined || entry.oldPath !== undefined) {
      throw new Error(`${prefix} has an invalid add shape.`);
    }
  } else if (entry.operation === "delete") {
    if (entry.oldPath === undefined || entry.oldOid === undefined || entry.oldMode === undefined || entry.newPath !== undefined) {
      throw new Error(`${prefix} has an invalid delete shape.`);
    }
  } else if (
    entry.oldPath === undefined || entry.oldOid === undefined || entry.oldMode === undefined ||
    entry.newPath === undefined || entry.newOid === undefined || entry.newMode === undefined ||
    entry.oldPath !== entry.newPath
  ) {
    throw new Error(`${prefix} has an invalid ${entry.operation} shape.`);
  }
  for (const candidate of [entry.oldPath, entry.newPath]) {
    if (candidate !== undefined) validateRepositoryPath(candidate, prefix);
  }
}

function validateRepositoryPath(candidate: string, prefix: string): void {
  const normalized = candidate.replaceAll("\\", "/");
  if (candidate !== normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`${prefix} contains unsafe path ${candidate}.`);
  }
}

function assertSameTree(
  expected: ReadonlyMap<string, RepositoryGitEntry>,
  actual: readonly RepositoryGitEntry[],
  overlay: RepositoryOverlay
): void {
  const actualMap = new Map(actual.map((entry) => [entry.path, entry]));
  if (expected.size !== actualMap.size) {
    throw new Error(`Repository overlay ${overlay.manifestDigest} does not describe result tree ${overlay.resultTreeSha}.`);
  }
  for (const [candidatePath, expectedEntry] of expected) {
    const actualEntry = actualMap.get(candidatePath);
    if (actualEntry?.oid !== expectedEntry.oid || actualEntry.mode !== expectedEntry.mode) {
      throw new Error(`Repository overlay ${overlay.manifestDigest} does not describe ${candidatePath} in result tree ${overlay.resultTreeSha}.`);
    }
  }
}

function renameAliases(overlay: RepositoryOverlay): ResourceAliasInput[] {
  const deletedByOid = new Map(overlay.entries.filter((entry) => entry.operation === "delete")
    .map((entry) => [`${entry.oldOid}\0${entry.oldMode}`, entry.oldPath!]));
  return overlay.entries.filter((entry) => entry.operation === "add").flatMap((entry) => {
    const oldPath = entry.detectedRenameFrom ?? deletedByOid.get(`${entry.newOid}\0${entry.newMode}`);
    if (oldPath === undefined) return [];
    return [{
      locator: `path:${oldPath}`,
      targetLocator: `path:${entry.newPath!}`,
      reason: "rename" as const,
      evidenceRefs: [repositoryFactId("evidence", { manifest: overlay.manifestDigest, oldPath, newPath: entry.newPath })]
    }];
  });
}

async function symlinkAliases(input: {
  rootPath: string;
  gitPath: string;
  model: RepositoryModel;
  signal?: AbortSignal;
}): Promise<ResourceAliasInput[]> {
  const modulePaths = new Set(input.model.gitEntries.map((entry) => entry.path));
  const aliases: ResourceAliasInput[] = [];
  for (const entry of input.model.gitEntries.filter((candidate) => candidate.kind === "symlink")) {
    const target = (await readBlob(input.gitPath, input.rootPath, entry.oid, input.signal)).trim();
    if (target === "" || path.posix.isAbsolute(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), target));
    if (resolved.startsWith("../") || !modulePaths.has(resolved)) continue;
    aliases.push({
      locator: `path:${entry.path}`,
      targetLocator: `path:${resolved}`,
      reason: "symlink",
      evidenceRefs: [repositoryFactId("evidence", { symlink: entry.path, target: resolved, oid: entry.oid })]
    });
  }
  return aliases;
}

function entryKind(mode: string): RepositoryGitEntry["kind"] {
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "gitlink";
  if (mode === "100755") return "executable";
  return "file";
}
