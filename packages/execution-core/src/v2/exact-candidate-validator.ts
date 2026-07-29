import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskContractBundle } from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";

import type { GitRunner } from "../git/runner";
import { GitCandidateSandboxFactory, validateExactCandidate, type EvidenceValidationCache } from "../validation/candidate-validator";
import { compileValidationRecipe } from "../validation/recipe-compiler";
import { ChildProcessValidationRunner, type ValidationRunner } from "../validation/runner";
import { detectTestIntegrityFindings, isTestDiscoveryConfigurationPath, isTestFilePath } from "../validation/test-integrity";
import type { WorktreeManager } from "../worktree/manager";
import type { V2ExecutionEvidenceMatrix, V2NodeValidationPort } from "./node-executor";

export interface ExactCandidateValidatorV2Options {
  git: GitRunner;
  worktrees: WorktreeManager;
  repoRoot: string;
  repositorySnapshot: RepositorySnapshot;
  runner?: ValidationRunner;
  operationId?: string;
  evidenceCache?: EvidenceValidationCache;
}

/** Runs the compiled obligations in isolated worktrees at the exact candidate and baseline SHAs. */
export class ExactCandidateValidatorV2 implements V2NodeValidationPort {
  private readonly runner: ValidationRunner;

  constructor(private readonly options: ExactCandidateValidatorV2Options) {
    this.runner = options.runner ?? new ChildProcessValidationRunner();
  }

  async validate(input: {
    runId: string;
    attemptId: string;
    contract: TaskContractBundle;
    candidateCommit: string;
    baselineCommit: string;
    signal?: AbortSignal;
  }): Promise<V2ExecutionEvidenceMatrix> {
    const recipe = compileValidationRecipe({
      contract: input.contract.validation,
      capabilities: this.options.repositorySnapshot.capabilities,
      repositorySnapshotId: this.options.repositorySnapshot.snapshotId,
      candidateCommit: input.candidateCommit,
      baselineCommit: input.baselineCommit
    });
    const candidateSandbox = new GitCandidateSandboxFactory(
      this.options.git,
      this.options.worktrees,
      `${input.runId}-${input.attemptId}-candidate`
    );
    const supervision = {
      runId: input.runId,
      ...(this.options.operationId !== undefined ? { operationId: this.options.operationId } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    };
    const integrity = await this.inspectTestIntegrity(input.baselineCommit, input.candidateCommit, input.signal);
    const validated = await validateExactCandidate({
      recipe,
      obligations: input.contract.validation.obligations,
      integrityFindings: integrity.findings
    }, {
      sandbox: candidateSandbox,
      ...(this.options.evidenceCache !== undefined ? { cache: this.options.evidenceCache } : {}),
      run: async (step, sandbox) => this.runner.run([step.command], {
        worktreePath: sandbox.worktreePath,
        repoRoot: this.options.repoRoot,
        supervision
      }),
      // One baseline worktree for the whole candidate, reused across obligations
      // by the orchestrator, rather than a fresh worktree per obligation.
      createBaselineSandbox: async (baselineCommit) => new GitCandidateSandboxFactory(
        this.options.git,
        this.options.worktrees,
        `${input.runId}-${input.attemptId}-baseline`
      ).create({ candidateCommit: baselineCommit }),
      runBaseline: async (step, baselineSandbox) => this.runner.run([step.command], {
        worktreePath: baselineSandbox.worktreePath,
        repoRoot: this.options.repoRoot,
        supervision
      }),
      ...(Object.keys(integrity.candidateTestContents).length === 0 ? {} : {
        runNegativeControl: async (step) => this.runNegativeControl({
          runId: input.runId,
          attemptId: input.attemptId,
          obligationId: step.obligationId,
          baselineCommit: input.baselineCommit,
          candidateTestContents: integrity.candidateTestContents,
          command: step.command,
          supervision
        })
      })
    });
    const identity = JSON.stringify({
      candidateCommit: validated.candidateCommit,
      validationContract: input.contract.task.validation,
      criteria: validated.matrix.criteria,
      outcome: validated.matrix.outcome,
      integrityFindings: validated.matrix.integrityFindings,
      negativeControls: validated.matrix.negativeControls
    });
    return {
      matrixId: `matrix-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
      candidateCommit: validated.candidateCommit,
      validationContract: { ...input.contract.task.validation },
      criteria: validated.matrix.criteria.map((criterion) => ({ ...criterion, evidenceRefs: [...criterion.evidenceRefs] })),
      outcome: validated.matrix.outcome,
      integrityFindings: validated.matrix.integrityFindings.map((finding) => ({ ...finding })),
      negativeControls: validated.matrix.negativeControls.map((control) => ({ ...control }))
    };
  }

  private async inspectTestIntegrity(baselineCommit: string, candidateCommit: string, signal?: AbortSignal): Promise<{
    findings: ReturnType<typeof detectTestIntegrityFindings>;
    candidateTestContents: Record<string, string>;
  }> {
    const readBudget = { remainingBytes: 1_048_576, exceededPaths: new Set<string>() };
    const read = async (ref: string, file: string): Promise<string | null> => {
      if (readBudget.remainingBytes <= 0) {
        readBudget.exceededPaths.add(file);
        return null;
      }
      try {
        const contents = await this.options.git.showFile(
          { cwd: this.options.repoRoot, ref, path: file },
          { ...(signal !== undefined ? { signal } : {}), maxBytes: readBudget.remainingBytes }
        );
        readBudget.remainingBytes -= contents === null ? 0 : Buffer.byteLength(contents, "utf8");
        return contents;
      } catch (error) {
        if (!isGitReadLimitError(error)) throw error;
        readBudget.remainingBytes = 0;
        readBudget.exceededPaths.add(file);
        return null;
      }
    };
    // Only paths changed between the exact baseline and candidate can weaken
    // integrity. Deriving both sides from Git avoids stale planning-snapshot
    // membership after intermediate integration commits.
    const baselineFiles = new Set<string>();
    const candidateFiles = new Set<string>();
    const baselineTestContents: Record<string, string> = {};
    const candidateTestContents: Record<string, string> = {};
    const changedFiles = await this.options.git.diffRangeNameOnly({
      cwd: this.options.repoRoot,
      from: baselineCommit,
      to: candidateCommit
    });
    for (const file of changedFiles.filter(isTestFilePath).sort()) {
      const baseline = await read(baselineCommit, file);
      const candidate = await read(candidateCommit, file);
      if (baseline !== null) {
        baselineFiles.add(file);
        baselineTestContents[file] = baseline;
      }
      if (candidate === null) candidateFiles.delete(file);
      else {
        candidateFiles.add(file);
        candidateTestContents[file] = candidate;
      }
    }
    const baselineScripts: Record<string, string> = {};
    const candidateScripts: Record<string, string> = {};
    const baselineAllScripts: Record<string, string> = {};
    const candidateAllScripts: Record<string, string> = {};
    const baselinePackageNames: Record<string, string> = {};
    const candidatePackageNames: Record<string, string> = {};
    const configurationPaths = new Set(changedFiles.filter(isTestDiscoveryConfigurationPath));
    const manifestPaths = manifestAncestors(changedFiles);
    const validationCommands: Array<{ directory: string; command: string }> = [];
    const moduleAliases = new Map<string, string[]>();
    for (const manifestPath of [...manifestPaths].sort()) {
      const baselineManifest = await read(baselineCommit, manifestPath);
      const candidateManifest = await read(candidateCommit, manifestPath);
      const baselineManifestScripts = testScriptsFromManifest(baselineManifest, manifestPath);
      const candidateManifestScripts = testScriptsFromManifest(candidateManifest, manifestPath);
      Object.assign(baselineScripts, baselineManifestScripts);
      Object.assign(candidateScripts, candidateManifestScripts);
      Object.assign(baselineAllScripts, allScriptsFromManifest(baselineManifest, manifestPath));
      Object.assign(candidateAllScripts, allScriptsFromManifest(candidateManifest, manifestPath));
      const baselinePackageName = packageNameFromManifest(baselineManifest);
      const candidatePackageName = packageNameFromManifest(candidateManifest);
      if (baselinePackageName !== undefined) baselinePackageNames[manifestPath] = baselinePackageName;
      if (candidatePackageName !== undefined) candidatePackageNames[manifestPath] = candidatePackageName;
      for (const manifest of [baselineManifest, candidateManifest]) {
        mergeModuleAliases(moduleAliases, moduleAliasesFromManifest(manifest, manifestPath));
      }
      if (changedFiles.includes(manifestPath) && embeddedTestConfigChanged(baselineManifest, candidateManifest)) configurationPaths.add(manifestPath);
      if (changedFiles.includes(manifestPath) && moduleResolutionManifestChanged(baselineManifest, candidateManifest)) configurationPaths.add(manifestPath);
    }
    expandReferencedScripts(baselineScripts, baselineAllScripts, baselinePackageNames);
    expandReferencedScripts(candidateScripts, candidateAllScripts, candidatePackageNames);
    for (const scripts of [baselineScripts, candidateScripts]) {
      for (const [identity, command] of Object.entries(scripts)) {
        validationCommands.push({ directory: path.posix.dirname(identity.slice(0, identity.indexOf("#scripts."))), command });
      }
    }
    const pendingConfigs = [...configurationAncestors(changedFiles)].map((configPath) => ({ configPath, scope: path.posix.dirname(configPath) }));
    const visitedConfigs = new Set<string>();
    while (pendingConfigs.length > 0) {
      const { configPath: tsconfigPath, scope } = pendingConfigs.shift()!;
      const identity = `${scope}::${tsconfigPath}`;
      if (visitedConfigs.has(identity)) continue;
      visitedConfigs.add(identity);
      const baselineConfig = await read(baselineCommit, tsconfigPath);
      const candidateConfig = await read(candidateCommit, tsconfigPath);
      mergeModuleAliases(moduleAliases, moduleAliasesFromTsconfig(baselineConfig, tsconfigPath, scope));
      mergeModuleAliases(moduleAliases, moduleAliasesFromTsconfig(candidateConfig, tsconfigPath, scope));
      for (const config of [baselineConfig, candidateConfig]) {
        const extended = extendedTsconfigPath(config, tsconfigPath);
        if (extended !== undefined) pendingConfigs.push({ configPath: extended, scope });
      }
      if (changedFiles.includes(tsconfigPath) && baselineConfig !== candidateConfig) configurationPaths.add(tsconfigPath);
    }
    for (const referenced of await this.changedValidationDependencies(validationCommands, changedFiles, baselineCommit, candidateCommit, moduleAliases, read, signal)) configurationPaths.add(referenced);
    for (const exceeded of readBudget.exceededPaths) configurationPaths.add(exceeded);
    return {
      findings: detectTestIntegrityFindings({
        baselineTestFiles: [...baselineFiles].sort(),
        candidateTestFiles: [...candidateFiles].sort(),
        baselineScripts,
        candidateScripts,
        baselineTestContents,
        candidateTestContents,
        changedTestConfigurationPaths: [...configurationPaths]
      }),
      candidateTestContents
    };
  }

  private async changedValidationDependencies(
    commands: readonly { directory: string; command: string }[],
    changedFiles: readonly string[],
    baselineCommit: string,
    candidateCommit: string,
    moduleAliases: ReadonlyMap<string, readonly string[]>,
    read: (ref: string, file: string) => Promise<string | null>,
    signal?: AbortSignal
  ): Promise<string[]> {
    const changed = new Set(changedFiles.map((file) => file.replaceAll("\\", "/")));
    const found = new Set<string>();
    const pending = commands.flatMap(({ directory, command }) => commandFileReferences(directory, command)).map((file) => ({ file, depth: 0 }));
    const visited = new Set<string>();
    while (pending.length > 0) {
      signal?.throwIfAborted();
      const { file, depth } = pending.shift()!;
      if (visited.has(file)) continue;
      if (visited.size >= 256 || depth > 16) {
        found.add("validation-dependency-budget");
        break;
      }
      visited.add(file);
      if (changed.has(file)) found.add(file);
      const baseline = await read(baselineCommit, file);
      const candidate = await read(candidateCommit, file);
      for (const contents of [baseline, candidate]) {
        if (contents === null) continue;
        if (hasOpaqueValidationDependency(contents) && (changed.has(file) || [...changed].some((changedFile) => path.posix.dirname(changedFile) === path.posix.dirname(file)))) found.add(file);
        for (const reference of moduleReferences(contents)) {
          pending.push(...resolvedModuleReferenceCandidates(path.posix.dirname(file), reference, moduleAliases).map((candidatePath) => ({ file: candidatePath, depth: depth + 1 })));
        }
      }
    }
    return [...found].sort();
  }

  private async runNegativeControl(input: {
    runId: string;
    attemptId: string;
    obligationId: string;
    baselineCommit: string;
    candidateTestContents: Record<string, string>;
    command: Parameters<ValidationRunner["run"]>[0][number];
    supervision: { runId: string; operationId?: string; signal?: AbortSignal };
  }): Promise<{ detectedFailure: boolean; output: string }> {
    const sandbox = await new GitCandidateSandboxFactory(
      this.options.git,
      this.options.worktrees,
      `${input.runId}-${input.attemptId}-negative-${input.obligationId}`
    ).create({ candidateCommit: input.baselineCommit });
    try {
      for (const [file, contents] of Object.entries(input.candidateTestContents).sort(([left], [right]) => left.localeCompare(right))) {
        await materializeNegativeControlTests(sandbox.worktreePath, { [file]: contents });
      }
      const result = await this.runner.run([input.command], {
        worktreePath: sandbox.worktreePath,
        repoRoot: this.options.repoRoot,
        supervision: input.supervision
      });
      return { detectedFailure: !result.passed || result.exitCode !== 0, output: result.output };
    } finally {
      await sandbox.dispose();
    }
  }
}

function manifestAncestors(changedFiles: readonly string[]): Set<string> {
  const manifests = new Set<string>(["package.json"]);
  for (const file of changedFiles) {
    const normalized = file.replaceAll("\\", "/");
    let directory = path.posix.dirname(normalized);
    while (directory !== ".") {
      manifests.add(`${directory}/package.json`);
      directory = path.posix.dirname(directory);
    }
    if (path.posix.basename(normalized) === "package.json") manifests.add(normalized);
  }
  return manifests;
}

function configurationAncestors(changedFiles: readonly string[]): Set<string> {
  const configs = new Set<string>(["tsconfig.json"]);
  for (const file of changedFiles) {
    let directory = path.posix.dirname(file.replaceAll("\\", "/"));
    while (directory !== ".") {
      configs.add(`${directory}/tsconfig.json`);
      directory = path.posix.dirname(directory);
    }
  }
  return configs;
}

function commandFileReferences(directory: string, command: string): string[] {
  const tokens = command.match(/"[^"]+"|'[^']+'|[^\s;&|]+/gu) ?? [];
  const references = tokens.flatMap((raw) => {
    const unquoted = raw.replace(/^["']|["']$/gu, "");
    const value = (unquoted.includes("=") ? unquoted.slice(unquoted.indexOf("=") + 1) : unquoted).replaceAll("\\", "/");
    return looksLikeFileReference(value) ? resolvedReferenceCandidates(directory, value) : [];
  });
  if (tokens[0]?.replace(/^['"]|['"]$/gu, "") === "make") references.push(...resolvedReferenceCandidates(directory, "./Makefile"));
  return references;
}

function moduleReferences(contents: string): string[] {
  const references: string[] = [];
  for (const match of contents.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire(?:\.resolve)?\s*\(|\b(?:readFileSync|spawn|execFile)\s*\()\s*["']([^"']+)["']/gu)) references.push(match[1]!);
  for (const match of contents.matchAll(/["'](\.\.?\/[^"']+)["']/gu)) references.push(match[1]!);
  return references;
}

function hasOpaqueValidationDependency(contents: string): boolean {
  return /\b(?:import|require(?:\.resolve)?|readFileSync|spawn|execFile)\s*\(\s*[^"'\s]/u.test(contents);
}

function looksLikeFileReference(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.includes("/") || /\.[A-Za-z0-9]+$/u.test(value);
}

function resolvedReferenceCandidates(directory: string, reference: string): string[] {
  const normalized = reference.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized)) return [];
  const resolved = path.posix.normalize(path.posix.join(directory === "." ? "" : directory, normalized)).replace(/^\.\//u, "");
  if (resolved === ".." || resolved.startsWith("../")) return [];
  const extension = path.posix.extname(resolved);
  if (extension !== "") {
    const nodeNextSources = extension === ".js"
      ? [resolved.slice(0, -3) + ".ts", resolved.slice(0, -3) + ".tsx"]
      : extension === ".mjs"
        ? [resolved.slice(0, -4) + ".mts", resolved.slice(0, -4) + ".ts"]
        : extension === ".cjs"
          ? [resolved.slice(0, -4) + ".cts", resolved.slice(0, -4) + ".ts"]
          : [];
    return [resolved, ...nodeNextSources];
  }
  return [resolved, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].map((extension) => `${resolved}${extension}`), ...[".ts", ".js", ".mjs", ".cjs"].map((extension) => `${resolved}/index${extension}`)];
}

function resolvedModuleReferenceCandidates(
  directory: string,
  reference: string,
  moduleAliases: ReadonlyMap<string, readonly string[]>
): string[] {
  if (reference.startsWith(".")) return resolvedReferenceCandidates(directory, reference);
  const matches: Array<{ score: number; entries: readonly string[]; wildcard: string }> = [];
  for (const [storedAlias, entries] of moduleAliases) {
    const separator = storedAlias.indexOf("::");
    const scope = separator >= 0 ? storedAlias.slice(0, separator) : undefined;
    const alias = separator >= 0 ? storedAlias.slice(separator + 2) : storedAlias;
    if (scope !== undefined && !isPathWithinScope(directory, scope)) continue;
    const [prefix, suffix = ""] = alias.split("*");
    if (!reference.startsWith(prefix!) || !reference.endsWith(suffix)) continue;
    if (!alias.includes("*") && reference !== alias) continue;
    matches.push({
      score: (scope !== undefined ? 1_000_000 + scope.length : 0) + alias.replace("*", "").length,
      entries,
      wildcard: alias.includes("*") ? reference.slice(prefix!.length, reference.length - suffix.length) : ""
    });
  }
  const best = matches.sort((left, right) => right.score - left.score)[0];
  return best === undefined ? [] : best.entries.map((entry) => entry.replaceAll("*", best.wildcard));
}

function isPathWithinScope(fileDirectory: string, scope: string): boolean {
  return scope === "." || fileDirectory === scope || fileDirectory.startsWith(`${scope}/`);
}

function moduleAliasesFromManifest(contents: string | null, manifestPath: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const manifest = parseManifest(contents);
  const directory = path.posix.dirname(manifestPath);
  if (isRecord(manifest.imports)) {
    for (const [key, value] of Object.entries(manifest.imports)) aliases.set(`${directory}::${key}`, resolveDeclaredEntries(directory, manifestEntryStrings(value)));
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) return aliases;
  const exports = manifest.exports;
  const rootEntries = typeof exports === "string" || !isRecord(exports)
    ? [exports, manifest.module, manifest.main, manifest.types].flatMap(manifestEntryStrings)
    : manifestEntryStrings(exports["."]);
  aliases.set(manifest.name, resolveDeclaredEntries(directory, rootEntries.length > 0 ? rootEntries : ["./src/index.ts", "./index.ts", "./index.js"]));
  if (isRecord(exports)) {
    for (const [key, value] of Object.entries(exports)) {
      if (key.startsWith("./") && key !== ".") aliases.set(`${manifest.name}/${key.slice(2)}`, resolveDeclaredEntries(directory, manifestEntryStrings(value)));
    }
  }
  return aliases;
}

function moduleAliasesFromTsconfig(contents: string | null, configPath: string, applicationScope: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const compilerOptions = parseManifest(contents).compilerOptions;
  if (!isRecord(compilerOptions) || !isRecord(compilerOptions.paths)) return aliases;
  const directory = path.posix.dirname(configPath);
  const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  const baseDirectory = path.posix.normalize(path.posix.join(directory === "." ? "" : directory, baseUrl));
  for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
    if (!Array.isArray(targets)) continue;
    aliases.set(`${applicationScope}::${alias}`, targets.filter((target): target is string => typeof target === "string").flatMap((target) => resolvedReferenceCandidates(baseDirectory, `./${target}`)));
  }
  return aliases;
}

function mergeModuleAliases(target: Map<string, string[]>, source: ReadonlyMap<string, readonly string[]>): void {
  for (const [alias, entries] of source) target.set(alias, [...new Set([...(target.get(alias) ?? []), ...entries])]);
}

function resolveDeclaredEntries(directory: string, entries: readonly string[]): string[] {
  return [...new Set(entries.flatMap((entry) => resolvedReferenceCandidates(directory, entry)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function manifestEntryStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap(manifestEntryStrings);
}

function moduleResolutionManifestChanged(baseline: string | null, candidate: string | null): boolean {
  const before = parseManifest(baseline);
  const after = parseManifest(candidate);
  return ["name", "exports", "imports", "main", "module", "types"]
    .some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function embeddedTestConfigChanged(baseline: string | null, candidate: string | null): boolean {
  const before = parseManifest(baseline);
  const after = parseManifest(candidate);
  return ["jest", "vitest", "ava", "mocha", "nyc", "cypress", "playwright"]
    .some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function parseManifest(contents: string | null): Record<string, unknown> {
  if (contents === null) return {};
  try {
    const parsed = JSON.parse(normalizeJsonc(contents)) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extendedTsconfigPath(contents: string | null, configPath: string): string | undefined {
  const extension = parseManifest(contents).extends;
  if (typeof extension !== "string" || !extension.startsWith(".")) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(configPath), extension));
  return path.posix.extname(resolved) === "" ? `${resolved}.json` : resolved;
}

function normalizeJsonc(contents: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < contents.length; index += 1) {
    const current = contents[index]!;
    const next = contents[index + 1];
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < contents.length && contents[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < contents.length && !(contents[index] === "*" && contents[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    if (current === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(contents[lookahead] ?? "")) lookahead += 1;
      if (contents[lookahead] === "}" || contents[lookahead] === "]") continue;
    }
    output += current;
  }
  return removeTrailingJsoncCommas(output);
}

function removeTrailingJsoncCommas(contents: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < contents.length; index += 1) {
    const current = contents[index]!;
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') inString = true;
    if (current === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(contents[lookahead] ?? "")) lookahead += 1;
      if (contents[lookahead] === "}" || contents[lookahead] === "]") continue;
    }
    output += current;
  }
  return output;
}

function isGitReadLimitError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
}

function testScriptsFromManifest(contents: string | null, manifestPath: string): Record<string, string> {
  try {
    const allScripts = allScriptsFromManifest(contents, manifestPath);
    const commands = Object.fromEntries(Object.entries(allScripts).map(([identity, command]) => [identity.slice(identity.indexOf("#scripts.") + 9), command]));
    const relevant = new Set(Object.keys(commands).filter((name) => name === "test" || name === "pretest" || name === "posttest" || name.startsWith("test:")));
    const pending = [...relevant];
    while (pending.length > 0) {
      const command = commands[pending.shift()!];
      if (command === undefined) continue;
      const localTargets = referencedPackageScriptTargets(command)
        .filter((target) => target.selectors.length === 0 && target.directory === undefined && !target.allWorkspaces)
        .map((target) => target.name);
      for (const referenced of localTargets) {
        if (commands[referenced] !== undefined && !relevant.has(referenced)) {
          relevant.add(referenced);
          pending.push(referenced);
        }
      }
    }
    return Object.fromEntries([...relevant].sort().map((name) => [`${manifestPath}#scripts.${name}`, commands[name]!]));
  } catch {
    return {};
  }
}

function allScriptsFromManifest(contents: string | null, manifestPath: string): Record<string, string> {
  const scripts = parseManifest(contents).scripts;
  if (!isRecord(scripts)) return {};
  return Object.fromEntries(Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => [`${manifestPath}#scripts.${name}`, command]));
}

function expandReferencedScripts(
  selected: Record<string, string>,
  available: Readonly<Record<string, string>>,
  packageNames: Readonly<Record<string, string>>
): void {
  const pending = Object.entries(selected);
  const selectedNames = new Set(Object.keys(selected));
  while (pending.length > 0) {
    const [sourceIdentity, command] = pending.shift()!;
    const sourceManifest = sourceIdentity.slice(0, sourceIdentity.indexOf("#scripts."));
    const targets = referencedPackageScriptTargets(command);
    for (const [identity, candidateCommand] of Object.entries(available)) {
      const manifest = identity.slice(0, identity.indexOf("#scripts."));
      const name = identity.slice(identity.indexOf("#scripts.") + 9);
      const matches = targets.some((target) => target.name === name && matchesWorkspaceTarget(target, manifest, packageNames[manifest], sourceManifest));
      if (!matches || selectedNames.has(identity)) continue;
      selectedNames.add(identity);
      selected[identity] = candidateCommand;
      pending.push([identity, candidateCommand]);
    }
  }
}

interface PackageScriptTarget {
  name: string;
  selectors: string[];
  directory?: string;
  allWorkspaces: boolean;
}

function referencedPackageScriptTargets(command: string): PackageScriptTarget[] {
  return command.split(/&&|\|\||;/u).flatMap((segment) => {
    if (!/\b(?:npm|pnpm|yarn|bun)\b/u.test(segment)) return [];
    const tokens = segment.match(/"[^"]+"|'[^']+'|[^\s]+/gu)?.map((token) => token.replace(/^['"]|['"]$/gu, "")) ?? [];
    const managerIndex = tokens.findIndex((token) => ["npm", "pnpm", "yarn", "bun"].includes(token));
    if (managerIndex < 0) return [];
    const filters: string[] = [];
    let directory: string | undefined;
    let allWorkspaces = false;
    let name: string | undefined;
    for (let index = managerIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === "--") break;
      if (token === "--filter") {
        if (tokens[index + 1] !== undefined) filters.push(tokens[index + 1]!);
        index += 1;
        continue;
      }
      if (token.startsWith("--filter=")) {
        filters.push(token.slice("--filter=".length));
        continue;
      }
      if (token === "-C" || token === "--dir" || token === "--workspace") {
        const value = tokens[index + 1];
        if (value !== undefined) {
          if (token === "--workspace") filters.push(value);
          else directory = value;
        }
        index += 1;
        continue;
      }
      if (token.startsWith("--dir=")) {
        directory = token.slice("--dir=".length);
        continue;
      }
      if (token.startsWith("--workspace=")) {
        filters.push(token.slice("--workspace=".length));
        continue;
      }
      if (token === "-r" || token === "--recursive") {
        allWorkspaces = true;
        continue;
      }
      if (token.startsWith("-")) continue;
      if (["exec", "dlx", "add", "install", "remove", "update"].includes(token)) return [];
      if (token === "run") {
        name = tokens[index + 1];
        break;
      }
      name = token;
      break;
    }
    if (name === undefined) return [];
    return [{ name, selectors: filters, ...(directory !== undefined ? { directory } : {}), allWorkspaces }];
  });
}

function matchesWorkspaceTarget(target: PackageScriptTarget, manifest: string, packageName: string | undefined, sourceManifest: string): boolean {
  const manifestDirectory = path.posix.dirname(manifest);
  const sourceDirectory = path.posix.dirname(sourceManifest);
  const targetDirectory = target.directory === undefined
    ? undefined
    : path.posix.normalize(path.posix.join(sourceDirectory, target.directory.replaceAll("\\", "/")));
  const directoryMatches = targetDirectory === undefined
    || (target.selectors.length > 0 || target.allWorkspaces
      ? isPathWithinScope(manifestDirectory, targetDirectory)
      : manifestDirectory === targetDirectory);
  if (!directoryMatches) return false;
  if (target.selectors.length === 0) return target.directory !== undefined || target.allWorkspaces || manifest === sourceManifest;
  const positives = target.selectors.filter((selector) => !selector.startsWith("!"));
  const exclusions = target.selectors.filter((selector) => selector.startsWith("!")).map((selector) => selector.slice(1));
  const selected = positives.length === 0 || positives.some((selector) => matchesWorkspaceSelector(selector, manifestDirectory, packageName));
  return selected && !exclusions.some((selector) => matchesWorkspaceSelector(selector, manifestDirectory, packageName));
}

function matchesWorkspaceSelector(selector: string, manifestDirectory: string, packageName: string | undefined): boolean {
  const pathSelector = selector.startsWith("./");
  const candidate = pathSelector ? manifestDirectory : packageName;
  if (candidate !== undefined && workspaceSelectorRegex(pathSelector ? selector.replace(/^\.\//u, "") : selector).test(candidate)) return true;
  return !pathSelector && manifestDirectory === path.posix.normalize(selector.replaceAll("\\", "/"));
}

function workspaceSelectorRegex(selector: string): RegExp {
  const escaped = selector.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "u");
}

function packageNameFromManifest(contents: string | null): string | undefined {
  const name = parseManifest(contents).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function safeSandboxPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Negative-control test path escapes sandbox: ${relativePath}`);
  return target;
}

export async function materializeNegativeControlTests(root: string, contentsByPath: Record<string, string>): Promise<void> {
  await mkdir(root, { recursive: true });
  await assertNoSymbolicLinks(root, ".");
  for (const [relativePath, contents] of Object.entries(contentsByPath).sort(([left], [right]) => left.localeCompare(right))) {
    const target = safeSandboxPath(root, relativePath);
    const parent = path.dirname(target);
    await assertNoSymbolicLinks(root, path.relative(root, parent));
    await mkdir(parent, { recursive: true });
    await assertNoSymbolicLinks(root, path.relative(root, target));
    await writeFile(target, contents, "utf8");
  }
}

async function assertNoSymbolicLinks(root: string, relativePath: string): Promise<void> {
  const relative = relativePath === "." ? "" : relativePath;
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  let current = path.resolve(root);
  for (const segment of ["", ...segments]) {
    if (segment !== "") current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`Negative-control path contains a symbolic link: ${current}`);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
