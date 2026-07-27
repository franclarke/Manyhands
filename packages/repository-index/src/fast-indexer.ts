import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RepositoryCapabilitiesSchema,
  discoverRepositoryCapabilities,
  type CapabilityDiagnostic,
  type RepositoryCapabilities
} from "./capabilities.js";
import {
  parseExportedRepositorySourceText,
  type ParsedRepositoryFile
} from "./source-parser.js";
import type {
  RepositoryDiagnostic,
  RepositoryIndex,
  RepositoryIndexer,
  RepositoryIndexerInput,
  RepositoryIndexLimits
} from "./index.js";

const FAST_INDEX_CACHE_SCHEMA_VERSION = 2 as const;
// Profile bump invalidates caches produced before RepositoryFileIndex carried
// byteSize/lineCount. Historical payloads remain schema-readable, but current
// snapshots must not silently reuse entries without the size measurements the
// granularity policy reads.
const INDEXER_PROFILE = "exports-only-v2-size-metrics" as const;
const INDEXER_NAME = "ripgrep-native-v2";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js"]);
const RG_FILE_ARGS = ["--files", "--hidden", "--glob", "!.git", "--null"] as const;
const DEFAULT_RG_PATH = resolveNativeRipgrepPath();
const DEFAULT_LIMITS: RepositoryIndexLimits = {
  maxFiles: 20_000,
  maxBytes: 64 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxSymbols: 100_000,
  maxImports: 100_000,
  maxExports: 100_000
};
const cacheBuilds = new Map<string, Promise<CachedRepositoryIndex>>();

export interface FastRepositoryIndexerInput extends RepositoryIndexerInput {
  /** Exact commit represented by the requested index. Defaults to current HEAD. */
  baseCommit?: string;
}

export type RunRipgrep = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal
) => Promise<string>;

export interface ExactRepositoryView {
  sourceRoot: string;
  /**
   * Source candidates proven to belong to the exact Git index. They may be
   * preloaded, but Ripgrep remains authoritative for the final file set.
   */
  candidateSourcePaths?: readonly string[];
  dispose(): Promise<void>;
}

export type OpenExactRepositoryView = (input: {
  repositoryRoot: string;
  baseCommit: string;
  signal?: AbortSignal;
}) => Promise<ExactRepositoryView>;

export interface FastRepositoryIndexerOptions {
  rgPath?: string;
  gitPath?: string;
  now?: () => string;
  runRg?: RunRipgrep;
  openExactView?: OpenExactRepositoryView;
}

export interface FastRepositoryIndexReceipt {
  index: RepositoryIndex;
  capabilityResult: RepositoryCapabilityResult;
  cacheHit: boolean;
  timings: {
    cacheReadMs: number;
    viewOpenMs: number;
    enumerationMs: number;
    parseMs: number;
    cacheWriteMs: number;
    totalMs: number;
  };
}

export interface RepositoryCapabilityResult {
  capabilities: RepositoryCapabilities;
  diagnostics: CapabilityDiagnostic[];
}

interface CachedRepositoryIndex {
  index: RepositoryIndex;
  capabilityResult: RepositoryCapabilityResult;
}

interface RepositoryIndexCacheEnvelope {
  schemaVersion: typeof FAST_INDEX_CACHE_SCHEMA_VERSION;
  indexerProfile: typeof INDEXER_PROFILE;
  repositoryId: string;
  rootPath: string;
  baseCommit: string;
  payloadChecksum: string;
  index: RepositoryIndex;
  capabilityResult: RepositoryCapabilityResult;
}

export class FastRepositoryIndexer implements RepositoryIndexer {
  private readonly rgPath: string;
  private readonly gitPath: string;
  private readonly now: () => string;
  private readonly runRg: RunRipgrep;
  private readonly openExactView: OpenExactRepositoryView;

  constructor(options: FastRepositoryIndexerOptions = {}) {
    this.rgPath = options.rgPath ?? DEFAULT_RG_PATH;
    this.gitPath = options.gitPath ?? "git";
    this.now = options.now ?? (() => new Date().toISOString());
    this.runRg = options.runRg ?? (
      (args, cwd, signal) => runFile(this.rgPath, args, cwd, signal, true)
    );
    this.openExactView = options.openExactView ?? (
      (input) => openExactCommitView({ ...input, gitPath: this.gitPath })
    );
  }

  async index(input: FastRepositoryIndexerInput): Promise<RepositoryIndex> {
    return (await this.indexWithReceipt(input)).index;
  }

  async indexWithReceipt(input: FastRepositoryIndexerInput): Promise<FastRepositoryIndexReceipt> {
    const startedAt = performance.now();
    const rootPath = path.resolve(input.rootPath);
    const repositoryId =
      input.repositoryId ?? path.basename(rootPath).replace(/[^A-Za-z0-9._:-]/gu, "-");
    const baseCommit = input.baseCommit ?? await resolveHead(
      this.gitPath,
      rootPath,
      input.signal
    );
    assertCommitSha(baseCommit, rootPath);
    const cachePath = fastIndexCachePath(rootPath, baseCommit);

    const cacheStartedAt = performance.now();
    const cached = await readCachedIndex(cachePath, {
      rootPath,
      repositoryId,
      baseCommit
    });
    const cacheReadMs = performance.now() - cacheStartedAt;
    if (cached !== undefined) {
      return {
        ...cached,
        cacheHit: true,
        timings: {
          cacheReadMs,
          viewOpenMs: 0,
          enumerationMs: 0,
          parseMs: 0,
          cacheWriteMs: 0,
          totalMs: performance.now() - startedAt
        }
      };
    }

    const existingBuild = cacheBuilds.get(cachePath);
    if (existingBuild !== undefined) {
      return {
        ...await existingBuild,
        cacheHit: true,
        timings: {
          cacheReadMs,
          viewOpenMs: 0,
          enumerationMs: 0,
          parseMs: 0,
          cacheWriteMs: 0,
          totalMs: performance.now() - startedAt
        }
      };
    }

    const timings = {
      cacheReadMs,
      viewOpenMs: 0,
      enumerationMs: 0,
      parseMs: 0,
      cacheWriteMs: 0,
      totalMs: 0
    };
    const build = this.buildAndCache({
      input,
      rootPath,
      repositoryId,
      baseCommit,
      cachePath,
      timings
    });
    cacheBuilds.set(cachePath, build);
    try {
      const result = await build;
      timings.totalMs = performance.now() - startedAt;
      return { ...result, cacheHit: false, timings };
    } finally {
      if (cacheBuilds.get(cachePath) === build) cacheBuilds.delete(cachePath);
    }
  }

  private async buildAndCache(params: {
    input: FastRepositoryIndexerInput;
    rootPath: string;
    repositoryId: string;
    baseCommit: string;
    cachePath: string;
    timings: FastRepositoryIndexReceipt["timings"];
  }): Promise<CachedRepositoryIndex> {
    const viewStartedAt = performance.now();
    const view = await this.openExactView({
      repositoryRoot: params.rootPath,
      baseCommit: params.baseCommit,
      ...(params.input.signal !== undefined ? { signal: params.input.signal } : {})
    });
    params.timings.viewOpenMs = performance.now() - viewStartedAt;

    try {
      throwIfAborted(params.input.signal);
      const enumerationStartedAt = performance.now();
      const limits = normalizeLimits(params.input.limits);
      const preload = view.candidateSourcePaths === undefined
        ? Promise.resolve(new Map<string, PreloadedSource>())
        : preloadExactSources({
            sourceRoot: view.sourceRoot,
            candidateSourcePaths: view.candidateSourcePaths,
            limits,
            ...(params.input.signal !== undefined ? { signal: params.input.signal } : {})
          });
      const [fileOutput, preloaded] = await Promise.all([
        this.runRg(RG_FILE_ARGS, view.sourceRoot, params.input.signal),
        preload
      ]);
      const sourcePaths = parseFileList(view.sourceRoot, fileOutput);
      params.timings.enumerationMs = performance.now() - enumerationStartedAt;

      const parseStartedAt = performance.now();
      const index = await buildCanonicalIndex({
        sourceRoot: view.sourceRoot,
        rootPath: params.rootPath,
        repositoryId: params.repositoryId,
        indexedAt: params.input.indexedAt ?? this.now(),
        sourcePaths,
        limits,
        preloaded,
        ...(params.input.signal !== undefined ? { signal: params.input.signal } : {})
      });
      params.timings.parseMs = performance.now() - parseStartedAt;
      const capabilityResult = await discoverRepositoryCapabilities(view.sourceRoot, index);

      const cacheWriteStartedAt = performance.now();
      const payload = { index, capabilityResult };
      await writeCacheAtomically(params.cachePath, {
        schemaVersion: FAST_INDEX_CACHE_SCHEMA_VERSION,
        indexerProfile: INDEXER_PROFILE,
        repositoryId: params.repositoryId,
        rootPath: params.rootPath,
        baseCommit: params.baseCommit,
        payloadChecksum: checksum(payload),
        ...payload
      });
      params.timings.cacheWriteMs = performance.now() - cacheWriteStartedAt;
      return payload;
    } finally {
      await view.dispose();
    }
  }
}

export async function buildFastRepositoryIndex(
  input: FastRepositoryIndexerInput,
  options?: FastRepositoryIndexerOptions
): Promise<RepositoryIndex> {
  return new FastRepositoryIndexer(options).index(input);
}

export function fastIndexCachePath(rootPath: string, baseCommit: string): string {
  assertCommitSha(baseCommit, rootPath);
  return path.join(
    path.resolve(rootPath),
    ".manyhands",
    "cache",
    `index-${baseCommit}.json`
  );
}

async function buildCanonicalIndex(input: {
  sourceRoot: string;
  rootPath: string;
  repositoryId: string;
  indexedAt: string;
  sourcePaths: string[];
  limits: RepositoryIndexLimits;
  preloaded: ReadonlyMap<string, PreloadedSource>;
  signal?: AbortSignal;
}): Promise<RepositoryIndex> {
  const diagnostics: RepositoryDiagnostic[] = [];
  const candidatePaths = input.sourcePaths.slice(0, input.limits.maxFiles);
  if (candidatePaths.length < input.sourcePaths.length) {
    diagnostics.push({
      severity: "warning",
      message: "repository index file budget reached"
    });
  }

  const parsedFiles: ParsedRepositoryFile[] = [];
  let indexedBytes = 0;
  let byteBudgetReached = false;
  const batchSize = 64;
  for (let offset = 0; offset < candidatePaths.length; offset += batchSize) {
    const batch = candidatePaths.slice(offset, offset + batchSize);
    const loaded = await Promise.all(batch.map(async (relativePath) => {
      throwIfAborted(input.signal);
      const preloaded = input.preloaded.get(relativePath);
      if (preloaded !== undefined) return preloaded;
      const file = await open(path.join(input.sourceRoot, relativePath), "r");
      try {
        const size = (await file.stat()).size;
        if (size > input.limits.maxFileBytes) return { relativePath, size };
        const sourceText = await file.readFile("utf8");
        return {
          relativePath,
          size,
          sourceText,
          parsed: parseExportedRepositorySourceText(relativePath, sourceText)
        };
      } finally {
        await file.close();
      }
    }));
    for (const item of loaded) {
      if (!("sourceText" in item)) {
        diagnostics.push({
          filePath: item.relativePath,
          severity: "warning",
          message: "repository index file-size budget exceeded"
        });
        continue;
      }
      if (indexedBytes + item.size > input.limits.maxBytes) {
        diagnostics.push({
          severity: "warning",
          message: "repository index byte budget reached"
        });
        byteBudgetReached = true;
        break;
      }
      indexedBytes += item.size;
      parsedFiles.push(
        item.parsed
      );
    }
    if (byteBudgetReached || indexedBytes >= input.limits.maxBytes) break;
  }
  const files = parsedFiles.map(({ file }) => ({
    ...file,
    importedSymbols: [],
    declaredSymbols: [...file.exportedSymbols]
  }));
  const symbols = parsedFiles
    .flatMap((parsed) => parsed.symbols)
    .filter((symbol) => symbol.exported)
    .slice(0, input.limits.maxSymbols)
    .sort((left, right) =>
      left.filePath.localeCompare(right.filePath) || left.name.localeCompare(right.name)
    );
  const exports = parsedFiles
    .flatMap((parsed) => parsed.exports)
    .slice(0, input.limits.maxExports)
    .sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      (left.moduleSpecifier ?? "").localeCompare(right.moduleSpecifier ?? "")
    );

  return {
    repositoryId: input.repositoryId,
    rootPath: input.rootPath,
    indexedAt: input.indexedAt,
    files,
    symbols,
    imports: [],
    exports,
    diagnostics,
    metadata: {
      indexer: INDEXER_NAME,
      deterministic: true,
      fileCount: files.length,
      symbolCount: symbols.length,
      importCount: 0,
      exportCount: exports.length
    }
  };
}

interface PreloadedSource {
  relativePath: string;
  size: number;
  sourceText: string;
  parsed: ParsedRepositoryFile;
}

async function preloadExactSources(input: {
  sourceRoot: string;
  candidateSourcePaths: readonly string[];
  limits: RepositoryIndexLimits;
  signal?: AbortSignal;
}): Promise<Map<string, PreloadedSource>> {
  const paths = [...new Set(
    input.candidateSourcePaths
      .map((candidate) => safeRelativePath(input.sourceRoot, candidate))
      .filter((candidate): candidate is string => candidate !== undefined)
      .filter((candidate) => SOURCE_EXTENSIONS.has(path.extname(candidate).toLowerCase()))
  )].sort().slice(0, input.limits.maxFiles);
  let reservedBytes = 0;
  const loaded = new Map<string, PreloadedSource>();
  const batchSize = 64;
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    const batch = paths.slice(offset, offset + batchSize);
    const batchResults = await Promise.all(batch.map(async (
      relativePath
    ): Promise<PreloadedSource | undefined> => {
      throwIfAborted(input.signal);
      const file = await open(path.join(input.sourceRoot, relativePath), "r");
      try {
        const size = (await file.stat()).size;
        if (
          size > input.limits.maxFileBytes ||
          reservedBytes + size > input.limits.maxBytes
        ) {
          return undefined;
        }
        reservedBytes += size;
        const sourceText = await file.readFile("utf8");
        return {
          relativePath,
          size,
          sourceText,
          parsed: parseExportedRepositorySourceText(relativePath, sourceText)
        };
      } finally {
        await file.close();
      }
    }));
    for (const item of batchResults) {
      if (item !== undefined) loaded.set(item.relativePath, item);
    }
  }
  return loaded;
}

function parseFileList(sourceRoot: string, output: string): string[] {
  return [...new Set(
    output
      .split("\0")
      .map((item) => item.replace(/\r?\n$/u, ""))
      .filter(Boolean)
      .map((item) => safeRelativePath(sourceRoot, item))
      .filter((item): item is string => item !== undefined)
      .filter((item) => SOURCE_EXTENSIONS.has(path.extname(item).toLowerCase()))
  )].sort((left, right) => left.localeCompare(right));
}

function safeRelativePath(rootPath: string, candidate: string): string | undefined {
  const absolute = path.resolve(rootPath, candidate);
  const relative = path.relative(rootPath, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.replaceAll("\\", "/");
}

async function readCachedIndex(
  cachePath: string,
  expected: { rootPath: string; repositoryId: string; baseCommit: string }
): Promise<CachedRepositoryIndex | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as Partial<RepositoryIndexCacheEnvelope>;
    if (
      parsed.schemaVersion !== FAST_INDEX_CACHE_SCHEMA_VERSION ||
      parsed.indexerProfile !== INDEXER_PROFILE ||
      parsed.rootPath !== expected.rootPath ||
      parsed.repositoryId !== expected.repositoryId ||
      parsed.baseCommit !== expected.baseCommit ||
      !isRepositoryIndex(parsed.index) ||
      parsed.index.rootPath !== expected.rootPath ||
      parsed.index.repositoryId !== expected.repositoryId ||
      !isRepositoryCapabilityResult(parsed.capabilityResult) ||
      parsed.payloadChecksum !== checksum({
        index: parsed.index,
        capabilityResult: parsed.capabilityResult
      })
    ) {
      return undefined;
    }
    return {
      index: parsed.index,
      capabilityResult: parsed.capabilityResult
    };
  } catch {
    return undefined;
  }
}

async function writeCacheAtomically(
  cachePath: string,
  envelope: RepositoryIndexCacheEnvelope
): Promise<void> {
  const cacheDirectory = path.dirname(cachePath);
  await mkdir(cacheDirectory, { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    // This cache is reconstructible derived data. Closing before rename keeps
    // readers atomic; checksum validation rejects a torn/non-durable payload
    // after a crash without putting fsync latency on the indexing SLO.
    await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
  } finally {
    await handle.close();
  }

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporaryPath, cachePath);
        return;
      } catch (error) {
        const winner = await readCachedIndex(cachePath, {
          rootPath: envelope.rootPath,
          repositoryId: envelope.repositoryId,
          baseCommit: envelope.baseCommit
        });
        if (winner !== undefined) return;

        if (await pathExists(cachePath)) {
          const quarantine = `${cachePath}.invalid.${randomUUID()}`;
          try {
            await rename(cachePath, quarantine);
            await rm(quarantine, { force: true });
          } catch {
            await delayWithJitter(attempt);
            continue;
          }
        } else if (!isRetryableRenameError(error)) {
          throw error;
        }
        await delayWithJitter(attempt);
      }
    }
    throw new Error(`Could not publish repository index cache ${cachePath}.`);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function openExactCommitView(input: {
  repositoryRoot: string;
  baseCommit: string;
  gitPath: string;
  signal?: AbortSignal;
}): Promise<ExactRepositoryView> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "manyhands-index-view-"));
  const sourceRoot = path.join(temporaryRoot, "source");
  const temporaryIndex = path.join(temporaryRoot, "git-index");
  await mkdir(sourceRoot, { recursive: true });
  const gitEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  try {
    await runFile(
      input.gitPath,
      ["read-tree", input.baseCommit],
      input.repositoryRoot,
      input.signal,
      false,
      gitEnv
    );
    const [, candidateOutput] = await Promise.all([
      runFile(
        input.gitPath,
        [
          "checkout-index",
          "--all",
          "--force",
          `--prefix=${sourceRoot.replaceAll("\\", "/")}/`
        ],
        input.repositoryRoot,
        input.signal,
        false,
        gitEnv
      ),
      runFile(
        input.gitPath,
        ["ls-files", "-z"],
        input.repositoryRoot,
        input.signal,
        false,
        gitEnv
      )
    ]);
    return {
      sourceRoot,
      candidateSourcePaths: candidateOutput.split("\0").filter(Boolean),
      dispose: () => rm(temporaryRoot, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveHead(
  gitPath: string,
  rootPath: string,
  signal?: AbortSignal
): Promise<string> {
  return runFile(gitPath, ["rev-parse", "--verify", "HEAD"], rootPath, signal);
}

function runFile(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  allowNoMatches = false,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        ...(signal !== undefined ? { signal } : {}),
        ...(env !== undefined ? { env } : {})
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          if (allowNoMatches && exitCode(error) === 1) {
            resolve(stdout);
            return;
          }
          reject(new Error(
            `${executable} ${args.join(" ")} failed in ${cwd}: ${stderr.trim() || error.message}`,
            { cause: error }
          ));
          return;
        }
        resolve(stdout.replace(/\r?\n$/u, ""));
      }
    );
  });
}

function normalizeLimits(input: Partial<RepositoryIndexLimits> | undefined): RepositoryIndexLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Repository index ${name} must be a positive integer.`);
    }
  }
  return limits;
}

function isRepositoryIndex(value: unknown): value is RepositoryIndex {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RepositoryIndex>;
  return (
    typeof candidate.repositoryId === "string" &&
    typeof candidate.rootPath === "string" &&
    typeof candidate.indexedAt === "string" &&
    Array.isArray(candidate.files) &&
    Array.isArray(candidate.symbols) &&
    Array.isArray(candidate.imports) &&
    Array.isArray(candidate.exports) &&
    Array.isArray(candidate.diagnostics) &&
    candidate.metadata !== undefined &&
    typeof candidate.metadata.indexer === "string"
  );
}

function isRepositoryCapabilityResult(value: unknown): value is RepositoryCapabilityResult {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RepositoryCapabilityResult>;
  if (!RepositoryCapabilitiesSchema.safeParse(candidate.capabilities).success) return false;
  return Array.isArray(candidate.diagnostics) && candidate.diagnostics.every((diagnostic) =>
    diagnostic !== null &&
    typeof diagnostic === "object" &&
    (diagnostic as Partial<CapabilityDiagnostic>).code === "package_manifest_unreadable" &&
    (diagnostic as Partial<CapabilityDiagnostic>).severity === "warning" &&
    (diagnostic as Partial<CapabilityDiagnostic>).filePath === "package.json" &&
    typeof (diagnostic as Partial<CapabilityDiagnostic>).message === "string"
  );
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function assertCommitSha(commit: string, rootPath: string): void {
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    throw new Error(`Git returned an invalid commit SHA for ${rootPath}.`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Repository indexing aborted.");
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

function isRetryableRenameError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    ["EEXIST", "EPERM", "EACCES", "ENOENT"].includes(String(error.code));
}

function delayWithJitter(attempt: number): Promise<void> {
  const base = Math.min(5 * (attempt + 1), 25);
  return new Promise((resolve) => setTimeout(resolve, base + Math.floor(Math.random() * 10)));
}

function exitCode(error: Error): number | undefined {
  if (!("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

function resolveNativeRipgrepPath(): string {
  const configured = process.env.MANYHANDS_RG_PATH;
  if (configured !== undefined && configured !== "") return configured;
  if (process.platform !== "win32") return "rg";

  const chocolateyRoot = process.env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey";
  const toolsRoot = path.join(chocolateyRoot, "lib", "ripgrep", "tools");
  if (!existsSync(toolsRoot)) return "rg";
  try {
    const candidates = readdirSync(toolsRoot, {
      recursive: true,
      withFileTypes: true
    })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase() === "rg.exe")
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
    return candidates.at(-1) ?? "rg";
  } catch {
    return "rg";
  }
}
