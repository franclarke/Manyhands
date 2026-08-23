import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { EpistemicAssessment } from "@manyhands/shared";
import ts from "typescript";

import type { RepositorySnapshot } from "./index.js";
import { repositoryDigest, repositoryFactId } from "./identity.js";
import { parseRepositorySourceText } from "./source-parser.js";

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

export type RepositoryGitEntryKind = "file" | "executable" | "symlink" | "gitlink";

export interface RepositoryGitEntry {
  path: string;
  oid: string;
  mode: string;
  kind: RepositoryGitEntryKind;
}

export interface RepositoryEvidenceRecord {
  id: string;
  snapshotId: string;
  kind: "file" | "symbol" | "relationship" | "test" | "command" | "convention" | "diagnostic";
  locator: string;
  digest: string;
  epistemic: EpistemicAssessment;
}

interface RepositoryFact {
  id: string;
  evidenceRefs: string[];
  epistemic: EpistemicAssessment;
}

export interface PackageBoundary extends RepositoryFact {
  name: string;
  rootPath: string;
  manifestPath: string;
  entrypoints: string[];
  exportTargets: Record<string, string>;
  workspacePatterns: string[];
  scripts: Record<string, string>;
}

export interface ModuleBoundary extends RepositoryFact {
  path: string;
  oid: string;
  mode: string;
  packageId?: string;
  exportedSymbols: string[];
  importedSpecifiers: string[];
}

export interface RepositorySymbolRecord extends RepositoryFact {
  name: string;
  kind: string;
  modulePath: string;
  exported: boolean;
  line?: number;
}

export interface ImportRelationship extends RepositoryFact {
  fromModulePath: string;
  moduleSpecifier: string;
  resolvedModulePath?: string;
}

export interface PublicInterfaceRecord extends RepositoryFact {
  modulePath: string;
  symbolName: string;
  signature?: string;
  packageId?: string;
}

export interface TestRelationship extends RepositoryFact {
  path: string;
  sourceModulePaths: string[];
}

export interface RepositoryCommandRecord extends RepositoryFact {
  packageId: string;
  name: string;
  command: string;
}

export interface RepositoryResourceRecord extends RepositoryFact {
  kind: "path" | "package" | "module" | "symbol" | "schema" | "integration_surface";
  canonicalLocator: string;
  path?: string;
  gitEntryKind?: RepositoryGitEntryKind;
}

export interface RepositoryConventionRecord extends RepositoryFact {
  name: string;
  locator: string;
}

export interface RepositoryModelDiagnostic extends RepositoryFact {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  path?: string;
}

export interface RepositoryCoverageReport {
  treeEntryCount: number;
  sourceEntryCount: number;
  parsedSourceCount: number;
  unsupportedEntryCount: number;
  disposition: "known" | "partial" | "unknown";
  evidenceRefs: string[];
}

export interface RepositoryModel {
  schemaVersion: 1;
  snapshot: { id: string; digest: string };
  repositoryId: string;
  baseCommit: string;
  treeSha: string;
  objectFormat: "sha1" | "sha256";
  packages: PackageBoundary[];
  modules: ModuleBoundary[];
  symbols: RepositorySymbolRecord[];
  relationships: ImportRelationship[];
  publicInterfaces: PublicInterfaceRecord[];
  tests: TestRelationship[];
  commands: RepositoryCommandRecord[];
  resources: RepositoryResourceRecord[];
  conventions: RepositoryConventionRecord[];
  diagnostics: RepositoryModelDiagnostic[];
  coverage: RepositoryCoverageReport;
  evidence: RepositoryEvidenceRecord[];
  gitEntries: RepositoryGitEntry[];
  digest: string;
}

export interface InspectRepositoryModelInput {
  rootPath: string;
  repositoryId?: string;
  cacheRoot?: string;
  targetFingerprint: string;
  baseCommit: string;
  capturedAt?: string;
  limits?: Record<string, number>;
  signal?: AbortSignal;
  gitPath?: string;
}

export interface RepositoryModelInspection {
  snapshot: RepositorySnapshot;
  model: RepositoryModel;
}

export async function inspectRepositoryModel(input: InspectRepositoryModelInput): Promise<RepositoryModel> {
  return (await inspectRepositoryModelWithSnapshot(input)).model;
}

export async function inspectRepositoryModelWithSnapshot(
  input: InspectRepositoryModelInput
): Promise<RepositoryModelInspection> {
  const rootPath = path.resolve(input.rootPath);
  const gitPath = input.gitPath ?? "git";
  // Load the transitional snapshot adapter only after the public barrel has
  // initialized; the repository domain module must not depend on its barrel.
  const { buildFastRepositorySnapshot } = await import("./index.js");
  const [snapshot, treeSha, objectFormat, entries] = await Promise.all([
    buildFastRepositorySnapshot({
      rootPath,
      ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
      ...(input.cacheRoot === undefined ? {} : { cacheRoot: input.cacheRoot }),
      targetFingerprint: input.targetFingerprint,
      baseCommit: input.baseCommit,
      ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
      ...(input.limits === undefined ? {} : { limits: input.limits }),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    }),
    gitText(gitPath, rootPath, ["rev-parse", `${input.baseCommit}^{tree}`], input.signal),
    detectObjectFormat(gitPath, rootPath, input.signal),
    listGitTree(gitPath, rootPath, input.baseCommit, input.signal)
  ]);
  const model = await buildRepositoryModelFromTree({
    rootPath,
    gitPath,
    snapshot,
    treeSha,
    objectFormat,
    entries,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  return { snapshot, model };
}

export async function buildRepositoryModelFromTree(input: {
  rootPath: string;
  gitPath?: string;
  snapshot: RepositorySnapshot;
  treeSha: string;
  objectFormat: "sha1" | "sha256";
  entries: RepositoryGitEntry[];
  signal?: AbortSignal;
  readBlobObject?: (oid: string, signal?: AbortSignal) => Promise<string>;
}): Promise<RepositoryModel> {
  const gitPath = input.gitPath ?? "git";
  const readBlobObject = input.readBlobObject
    ?? ((oid: string, signal?: AbortSignal) => readBlob(gitPath, input.rootPath, oid, signal));
  const entries = [...input.entries].sort((left, right) => left.path.localeCompare(right.path));
  const evidence: RepositoryEvidenceRecord[] = [];
  const evidenceByLocator = new Map<string, RepositoryEvidenceRecord>();
  const evidenceFor = (
    kind: RepositoryEvidenceRecord["kind"],
    locator: string,
    material: unknown,
    epistemic: EpistemicAssessment = known()
  ): RepositoryEvidenceRecord => {
    const key = `${kind}\0${locator}\0${repositoryDigest(material)}\0${JSON.stringify(epistemic)}`;
    const existing = evidenceByLocator.get(key);
    if (existing !== undefined) return existing;
    const item: RepositoryEvidenceRecord = {
      id: repositoryFactId("evidence", key),
      snapshotId: input.snapshot.snapshotId,
      kind,
      locator,
      digest: repositoryDigest(material),
      epistemic
    };
    evidence.push(item);
    evidenceByLocator.set(key, item);
    return item;
  };

  const packageEntries = entries.filter((entry) => path.posix.basename(entry.path) === "package.json" && entry.kind === "file");
  const packageManifests = await mapWithConcurrency(packageEntries, 8, async (entry) => ({
    entry,
    parsed: parseJsonObject(await readBlobObject(entry.oid, input.signal))
  }));
  const packages: PackageBoundary[] = packageManifests.length > 0
    ? packageManifests.map(({ entry, parsed }) => {
        const rootPath = path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path);
        const factEvidence = evidenceFor("file", entry.path, entry);
        const manifest = parsed.value;
        const name = typeof manifest?.name === "string" && manifest.name.trim() !== ""
          ? manifest.name
          : rootPath === "" ? input.snapshot.repositoryId : path.posix.basename(rootPath);
        return {
          id: repositoryFactId("package", { rootPath, name }),
          name,
          rootPath,
          manifestPath: entry.path,
          entrypoints: packageEntrypoints(manifest),
          exportTargets: packageExportTargets(manifest),
          workspacePatterns: workspacePatterns(manifest?.workspaces),
          scripts: stringRecord(manifest?.scripts),
          evidenceRefs: [factEvidence.id],
          epistemic: parsed.error === undefined
            ? known(factEvidence.id)
            : partial(undefined, factEvidence.id)
        };
      }).sort((left, right) => left.rootPath.localeCompare(right.rootPath))
    : [{
        id: repositoryFactId("package", { rootPath: "", name: input.snapshot.repositoryId }),
        name: input.snapshot.repositoryId,
        rootPath: "",
        manifestPath: "package.json",
        entrypoints: [],
        exportTargets: {},
        workspacePatterns: [],
        scripts: {},
        evidenceRefs: [],
        epistemic: known()
      }];

  const sourceEntries = entries.filter((entry) =>
    (entry.kind === "file" || entry.kind === "executable") && SOURCE_EXTENSION.test(entry.path)
  );
  const parsedSources = await mapWithConcurrency(sourceEntries, 8, async (entry) => {
    const sourceText = await readBlobObject(entry.oid, input.signal);
    return { entry, sourceText, parsed: parseRepositorySourceText(entry.path, sourceText) };
  });
  const modulePaths = new Set(parsedSources.map(({ entry }) => entry.path));
  const modules: ModuleBoundary[] = parsedSources.map(({ entry, parsed }) => {
    const factEvidence = evidenceFor("file", entry.path, entry);
    const packageId = nearestPackage(packages, entry.path)?.id;
    return {
      id: repositoryFactId("module", entry.path),
      path: entry.path,
      oid: entry.oid,
      mode: entry.mode,
      ...(packageId === undefined ? {} : { packageId }),
      exportedSymbols: [...parsed.file.exportedSymbols].sort(),
      importedSpecifiers: [...new Set(parsed.imports.map((item) => item.moduleSpecifier))].sort(),
      evidenceRefs: [factEvidence.id],
      epistemic: known(factEvidence.id)
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const symbols: RepositorySymbolRecord[] = parsedSources.flatMap(({ entry, parsed }) =>
    parsed.symbols.map((symbol) => {
      const factEvidence = evidenceFor("symbol", `${entry.path}#${symbol.name}`, symbol);
      return {
        id: repositoryFactId("symbol", { path: entry.path, name: symbol.name }),
        name: symbol.name,
        kind: symbol.kind,
        modulePath: entry.path,
        exported: symbol.exported,
        ...(symbol.line === undefined ? {} : { line: symbol.line }),
        evidenceRefs: [factEvidence.id],
        epistemic: known(factEvidence.id)
      };
    })
  ).sort(compareFacts);

  const relationships: ImportRelationship[] = parsedSources.flatMap(({ entry, parsed }) =>
    parsed.imports.map((item) => {
      const resolvedModulePath = resolveModulePath(entry.path, item.moduleSpecifier, modulePaths, packages);
      const epistemic = resolvedModulePath === undefined
        ? partial(`Import ${item.moduleSpecifier} could not be resolved from the exact indexed source surface.`)
        : known();
      const factEvidence = evidenceFor(
        "relationship",
        `${entry.path}->${item.moduleSpecifier}`,
        { ...item, resolvedModulePath },
        epistemic
      );
      return {
        id: repositoryFactId("relationship", { from: entry.path, specifier: item.moduleSpecifier }),
        fromModulePath: entry.path,
        moduleSpecifier: item.moduleSpecifier,
        ...(resolvedModulePath === undefined ? {} : { resolvedModulePath }),
        evidenceRefs: [factEvidence.id],
        epistemic: resolvedModulePath === undefined ? partial(undefined, factEvidence.id) : known(factEvidence.id)
      };
    })
  ).sort((left, right) => `${left.fromModulePath}\0${left.moduleSpecifier}`.localeCompare(`${right.fromModulePath}\0${right.moduleSpecifier}`));

  const signaturesByModule = new Map(parsedSources.map(({ entry, sourceText }) => [
    entry.path,
    publicSignatures(entry.path, sourceText)
  ]));
  const publicInterfaces: PublicInterfaceRecord[] = symbols.filter((symbol) => symbol.exported).map((symbol) => {
    const sourceEvidence = evidenceFor("symbol", `${symbol.modulePath}#export:${symbol.name}`, symbol);
    const signature = signaturesByModule.get(symbol.modulePath)?.get(symbol.name);
    return {
      id: repositoryFactId("interface", { path: symbol.modulePath, name: symbol.name }),
      modulePath: symbol.modulePath,
      symbolName: symbol.name,
      ...(signature === undefined ? {} : { signature }),
      ...(nearestPackage(packages, symbol.modulePath)?.id === undefined
        ? {}
        : { packageId: nearestPackage(packages, symbol.modulePath)!.id }),
      evidenceRefs: [sourceEvidence.id],
      epistemic: signature === undefined
        ? partial(undefined, sourceEvidence.id)
        : known(sourceEvidence.id)
    };
  }).sort(compareFacts);

  const relationshipsByTest = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (!TEST_PATH.test(relationship.fromModulePath) || relationship.resolvedModulePath === undefined) continue;
    if (TEST_PATH.test(relationship.resolvedModulePath)) continue;
    const values = relationshipsByTest.get(relationship.fromModulePath) ?? [];
    values.push(relationship.resolvedModulePath);
    relationshipsByTest.set(relationship.fromModulePath, values);
  }
  const tests: TestRelationship[] = modules.filter((module) => TEST_PATH.test(module.path)).map((module) => {
    const sourceModulePaths = [...new Set(relationshipsByTest.get(module.path) ?? [])].sort();
    const testEvidence = evidenceFor("test", module.path, { sourceModulePaths });
    return {
      id: repositoryFactId("test", module.path),
      path: module.path,
      sourceModulePaths,
      evidenceRefs: [testEvidence.id],
      epistemic: sourceModulePaths.length === 0
        ? partial(undefined, testEvidence.id)
        : known(testEvidence.id)
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const commands: RepositoryCommandRecord[] = packages.flatMap((boundary) =>
    Object.entries(boundary.scripts).map(([name, command]) => {
      const commandEvidence = evidenceFor("command", `${boundary.manifestPath}#scripts.${name}`, command);
      return {
        id: repositoryFactId("command", { packageId: boundary.id, name }),
        packageId: boundary.id,
        name,
        command,
        evidenceRefs: [commandEvidence.id],
        epistemic: known(commandEvidence.id)
      };
    })
  ).sort(compareFacts);

  const resources: RepositoryResourceRecord[] = [
    ...entries.map((entry) => {
      const itemEvidence = evidenceFor("file", entry.path, entry);
      return {
        id: repositoryFactId("resource", { kind: "path", path: entry.path }),
        kind: resourceKindForPath(entry.path),
        canonicalLocator: `path:${entry.path}`,
        path: entry.path,
        gitEntryKind: entry.kind,
        evidenceRefs: [itemEvidence.id],
        epistemic: known(itemEvidence.id)
      } satisfies RepositoryResourceRecord;
    }),
    ...packages.map((boundary) => ({
      id: repositoryFactId("resource", { kind: "package", rootPath: boundary.rootPath }),
      kind: "package" as const,
      canonicalLocator: `package:${boundary.rootPath || "."}`,
      path: boundary.rootPath,
      evidenceRefs: [...boundary.evidenceRefs],
      epistemic: boundary.epistemic
    })),
    ...modules.map((module) => ({
      id: repositoryFactId("resource", { kind: "module", path: module.path }),
      kind: "module" as const,
      canonicalLocator: `module:${module.path}`,
      path: module.path,
      evidenceRefs: [...module.evidenceRefs],
      epistemic: module.epistemic
    })),
    ...symbols.map((symbol) => ({
      id: repositoryFactId("resource", { kind: "symbol", path: symbol.modulePath, name: symbol.name }),
      kind: "symbol" as const,
      canonicalLocator: `symbol:${symbol.modulePath}#${symbol.name}`,
      path: symbol.modulePath,
      evidenceRefs: [...symbol.evidenceRefs],
      epistemic: symbol.epistemic
    }))
  ].sort(compareFacts);

  const conventions: RepositoryConventionRecord[] = entries
    .filter((entry) => /(?:^|\/)(?:tsconfig[^/]*\.json|eslint[^/]*|\.editorconfig|\.gitattributes)$/u.test(entry.path))
    .map((entry) => {
      const itemEvidence = evidenceFor("convention", entry.path, entry);
      return {
        id: repositoryFactId("convention", entry.path),
        name: path.posix.basename(entry.path),
        locator: entry.path,
        evidenceRefs: [itemEvidence.id],
        epistemic: known(itemEvidence.id)
      };
    }).sort(compareFacts);

  const packageDiagnostics = packageManifests.flatMap(({ entry, parsed }) => parsed.error === undefined
    ? []
    : [{
        code: "repository.package_manifest_invalid",
        message: parsed.error,
        severity: "warning" as const,
        filePath: entry.path
      }]);
  const diagnostics: RepositoryModelDiagnostic[] = [...input.snapshot.diagnostics, ...packageDiagnostics].map((diagnostic) => {
    const itemEvidence = evidenceFor("diagnostic", diagnostic.filePath ?? diagnostic.code, diagnostic);
    return {
      id: repositoryFactId("diagnostic", diagnostic),
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
      ...(diagnostic.filePath === undefined ? {} : { path: diagnostic.filePath }),
      evidenceRefs: [itemEvidence.id],
      epistemic: diagnostic.severity === "error"
        ? partial(undefined, itemEvidence.id)
        : known(itemEvidence.id)
    };
  }).sort(compareFacts);

  evidence.sort((left, right) => left.id.localeCompare(right.id));
  const coverageEvidence = evidence.map((item) => item.id);
  const unsupportedEntryCount = entries.length - sourceEntries.length;
  const coverage: RepositoryCoverageReport = {
    treeEntryCount: entries.length,
    sourceEntryCount: sourceEntries.length,
    parsedSourceCount: parsedSources.length,
    unsupportedEntryCount,
    disposition: input.snapshot.inspectionDisposition === "unavailable"
      ? "unknown"
      : unsupportedEntryCount > 0 || packageDiagnostics.length > 0 || input.snapshot.inspectionDisposition === "partial"
        ? "partial"
        : "known",
    evidenceRefs: coverageEvidence
  };
  const material = {
    schemaVersion: 1 as const,
    snapshot: {
      id: input.snapshot.snapshotId,
      digest: input.snapshot.indexHash === undefined
        ? input.snapshot.snapshotId
        : `sha256:${input.snapshot.indexHash}`
    },
    repositoryId: input.snapshot.repositoryId,
    baseCommit: input.snapshot.baseCommit,
    treeSha: input.treeSha,
    objectFormat: input.objectFormat,
    packages,
    modules,
    symbols,
    relationships,
    publicInterfaces,
    tests,
    commands,
    resources,
    conventions,
    diagnostics,
    coverage,
    evidence,
    gitEntries: entries
  };
  return { ...material, digest: repositoryDigest(material) };
}

export async function listGitTree(
  gitPath: string,
  rootPath: string,
  revision: string,
  signal?: AbortSignal
): Promise<RepositoryGitEntry[]> {
  const output = await gitText(gitPath, rootPath, ["ls-tree", "-r", "-z", "--full-tree", revision], signal, false);
  return output.split("\0").filter(Boolean).map((record) => {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]+)\t([\s\S]+)$/u.exec(record);
    if (match === null) throw new Error(`Git returned an invalid tree entry for ${revision}.`);
    const [, mode, objectType, oid, candidatePath] = match;
    const normalizedPath = normalizeGitPath(candidatePath!);
    return {
      path: normalizedPath,
      oid: oid!,
      mode: mode!,
      kind: gitEntryKind(mode!, objectType!)
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export async function readBlob(
  gitPath: string,
  rootPath: string,
  oid: string,
  signal?: AbortSignal
): Promise<string> {
  return gitText(gitPath, rootPath, ["cat-file", "blob", oid], signal, false);
}

function detectObjectFormat(
  gitPath: string,
  rootPath: string,
  signal?: AbortSignal
): Promise<"sha1" | "sha256"> {
  return gitText(gitPath, rootPath, ["rev-parse", "--show-object-format"], signal).then((format) => {
    if (format !== "sha1" && format !== "sha256") throw new Error(`Unsupported Git object format ${format}.`);
    return format;
  });
}

async function gitText(
  executable: string,
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  trim = true
): Promise<string> {
  const { stdout } = await execFileAsync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
  return trim ? stdout.trim() : stdout;
}

function parseJsonObject(value: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { value: parsed as Record<string, unknown> }
      : { error: "package.json must contain a JSON object; package metadata is partial." };
  } catch (error) {
    return {
      error: `package.json could not be parsed; package metadata is partial: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function packageEntrypoints(manifest: Record<string, unknown> | undefined): string[] {
  if (manifest === undefined) return [];
  const values = new Set<string>();
  for (const key of ["main", "module", "types"]) {
    if (typeof manifest[key] === "string") values.add(normalizeManifestPath(manifest[key]));
  }
  collectStringLeaves(manifest.exports, values);
  return [...values].sort();
}

function packageExportTargets(manifest: Record<string, unknown> | undefined): Record<string, string> {
  if (manifest === undefined) return {};
  if (typeof manifest.exports === "string") return { ".": normalizeManifestPath(manifest.exports) };
  if (manifest.exports === null || typeof manifest.exports !== "object" || Array.isArray(manifest.exports)) return {};
  const targets: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(manifest.exports as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    if (!key.startsWith(".")) continue;
    const target = firstStringLeaf(value);
    if (target !== undefined) targets.push([key, normalizeManifestPath(target)]);
  }
  return Object.fromEntries(targets);
}

function firstStringLeaf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstStringLeaf(item);
      if (candidate !== undefined) return candidate;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const candidate = firstStringLeaf((value as Record<string, unknown>)[key]);
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function workspacePatterns(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object" && Array.isArray((value as Record<string, unknown>).packages)
      ? (value as Record<string, unknown>).packages as unknown[]
      : [];
  return [...new Set(source.filter((item): item is string => typeof item === "string")
    .map(normalizeManifestPath))].sort();
}

function collectStringLeaves(value: unknown, target: Set<string>): void {
  if (typeof value === "string") {
    target.add(normalizeManifestPath(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringLeaves(item, target));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectStringLeaves(item, target));
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right)));
}

function nearestPackage(packages: readonly PackageBoundary[], filePath: string): PackageBoundary | undefined {
  return [...packages]
    .filter((boundary) => boundary.rootPath === "" || filePath.startsWith(`${boundary.rootPath}/`))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
}

function resolveModulePath(
  fromPath: string,
  specifier: string,
  modulePaths: ReadonlySet<string>,
  packages: readonly PackageBoundary[]
): string | undefined {
  if (!specifier.startsWith(".")) return resolvePackageModulePath(specifier, modulePaths, packages);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  return resolveModuleCandidate(resolved, modulePaths);
}

function resolvePackageModulePath(
  specifier: string,
  modulePaths: ReadonlySet<string>,
  packages: readonly PackageBoundary[]
): string | undefined {
  const boundary = [...packages].sort((left, right) => right.name.length - left.name.length)
    .find((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
  if (boundary === undefined) return undefined;
  const subpath = specifier === boundary.name ? "." : `./${specifier.slice(boundary.name.length + 1)}`;
  const target = boundary.exportTargets[subpath]
    ?? (subpath === "." ? boundary.entrypoints[0] : undefined);
  if (target === undefined) return undefined;
  return resolveModuleCandidate(path.posix.join(boundary.rootPath, target), modulePaths);
}

function resolveModuleCandidate(resolved: string, modulePaths: ReadonlySet<string>): string | undefined {
  const withoutRuntimeExtension = resolved.replace(/\.(?:mjs|cjs|js|jsx)$/u, "");
  const candidates = [
    resolved,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${withoutRuntimeExtension}${extension}`),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${resolved}/index${extension}`)
  ];
  return candidates.find((candidate) => modulePaths.has(candidate));
}

function publicSignatures(relativePath: string, sourceText: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const signatures = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          signatures.set(declaration.name.text, normalizeSignature(statement.getText(sourceFile)));
        }
      }
      continue;
    }
    const named = statement as ts.Statement & { name?: ts.DeclarationName };
    if (named.name === undefined || !ts.isIdentifier(named.name)) continue;
    const end = ts.isFunctionDeclaration(statement) && statement.body !== undefined
      ? statement.body.getStart(sourceFile)
      : statement.end;
    signatures.set(
      named.name.text,
      normalizeSignature(sourceText.slice(statement.getStart(sourceFile), end))
    );
  }
  return signatures;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function normalizeSignature(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/\s*\{$/u, "").trim();
}

function resourceKindForPath(candidatePath: string): RepositoryResourceRecord["kind"] {
  if (/(?:^|\/)(?:schemas?|migrations?)(?:\/|$)|(?:schema|migration)\.[^.]+$/u.test(candidatePath)) return "schema";
  if (/(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|index\.[cm]?[jt]sx?)$/u.test(candidatePath)) {
    return "integration_surface";
  }
  return "path";
}

function gitEntryKind(mode: string, objectType: string): RepositoryGitEntryKind {
  if (mode === "120000") return "symlink";
  if (mode === "160000" || objectType === "commit") return "gitlink";
  if (mode === "100755") return "executable";
  return "file";
}

function normalizeGitPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized === "" || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Git returned an unsafe repository path ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function normalizeManifestPath(value: unknown): string {
  return String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
}

function known(evidenceRef?: string): EpistemicAssessment {
  return {
    state: "known",
    confidence: "high",
    evidenceRefs: evidenceRef === undefined ? ["repository:exact-git-object"] : [evidenceRef]
  };
}

function partial(reason?: string, evidenceRef?: string): EpistemicAssessment {
  return {
    state: "partial",
    confidence: "low",
    evidenceRefs: evidenceRef === undefined
      ? [repositoryFactId("evidence", reason ?? "repository-partial")]
      : [evidenceRef]
  };
}

function compareFacts(left: RepositoryFact, right: RepositoryFact): number {
  return left.id.localeCompare(right.id);
}
