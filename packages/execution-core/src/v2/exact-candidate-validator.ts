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
      const [baseline, candidate] = await Promise.all([
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: baselineCommit, path: file }),
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: candidateCommit, path: file })
      ]);
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
    const configurationPaths = new Set(changedFiles.filter(isTestDiscoveryConfigurationPath));
    const manifestPaths = manifestAncestors(changedFiles);
    const validationCommands: Array<{ directory: string; command: string }> = [];
    const workspacePackages = new Map<string, string[]>();
    for (const manifestPath of [...manifestPaths].sort()) {
      const [baselineManifest, candidateManifest] = await Promise.all([
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: baselineCommit, path: manifestPath }),
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: candidateCommit, path: manifestPath })
      ]);
      const baselineManifestScripts = testScriptsFromManifest(baselineManifest, manifestPath);
      const candidateManifestScripts = testScriptsFromManifest(candidateManifest, manifestPath);
      Object.assign(baselineScripts, baselineManifestScripts);
      Object.assign(candidateScripts, candidateManifestScripts);
      const directory = path.posix.dirname(manifestPath);
      validationCommands.push(...[...Object.values(baselineManifestScripts), ...Object.values(candidateManifestScripts)].map((command) => ({ directory, command })));
      for (const manifest of [baselineManifest, candidateManifest]) {
        const workspacePackage = workspacePackageFromManifest(manifest, manifestPath);
        if (workspacePackage !== undefined) workspacePackages.set(workspacePackage.name, workspacePackage.entries);
      }
      if (changedFiles.includes(manifestPath) && embeddedTestConfigChanged(baselineManifest, candidateManifest)) configurationPaths.add(manifestPath);
    }
    for (const referenced of await this.changedValidationDependencies(validationCommands, changedFiles, baselineCommit, candidateCommit, workspacePackages, signal)) configurationPaths.add(referenced);
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
    workspacePackages: ReadonlyMap<string, readonly string[]>,
    signal?: AbortSignal
  ): Promise<string[]> {
    const changed = new Set(changedFiles.map((file) => file.replaceAll("\\", "/")));
    const found = new Set<string>();
    const pending = commands.flatMap(({ directory, command }) => commandFileReferences(directory, command)).map((file) => ({ file, depth: 0 }));
    const visited = new Set<string>();
    let inspectedBytes = 0;
    while (pending.length > 0) {
      signal?.throwIfAborted();
      const { file, depth } = pending.shift()!;
      if (visited.has(file)) continue;
      if (visited.size >= 256 || depth > 16 || inspectedBytes > 1_048_576) {
        found.add("validation-dependency-budget");
        break;
      }
      visited.add(file);
      if (changed.has(file)) found.add(file);
      const [baseline, candidate] = await Promise.all([
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: baselineCommit, path: file }),
        this.options.git.showFile({ cwd: this.options.repoRoot, ref: candidateCommit, path: file })
      ]);
      for (const contents of [baseline, candidate]) {
        if (contents === null) continue;
        inspectedBytes += Buffer.byteLength(contents, "utf8");
        if (inspectedBytes > 1_048_576) {
          found.add("validation-dependency-budget");
          pending.length = 0;
          break;
        }
        if (hasOpaqueValidationDependency(contents)) found.add(file);
        for (const reference of moduleReferences(contents)) {
          pending.push(...resolvedModuleReferenceCandidates(path.posix.dirname(file), reference, workspacePackages).map((candidatePath) => ({ file: candidatePath, depth: depth + 1 })));
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

function commandFileReferences(directory: string, command: string): string[] {
  const tokens = command.match(/"[^"]+"|'[^']+'|[^\s;&|]+/gu) ?? [];
  return tokens.flatMap((raw) => {
    const unquoted = raw.replace(/^["']|["']$/gu, "");
    const value = (unquoted.includes("=") ? unquoted.slice(unquoted.indexOf("=") + 1) : unquoted).replaceAll("\\", "/");
    return looksLikeFileReference(value) ? resolvedReferenceCandidates(directory, value) : [];
  });
}

function moduleReferences(contents: string): string[] {
  const references: string[] = [];
  for (const match of contents.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire(?:\.resolve)?\s*\(|\b(?:readFileSync|spawn|execFile)\s*\()\s*["']([^"']+)["']/gu)) references.push(match[1]!);
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
  workspacePackages: ReadonlyMap<string, readonly string[]>
): string[] {
  if (reference.startsWith(".")) return resolvedReferenceCandidates(directory, reference);
  const packageName = reference.startsWith("@") ? reference.split("/").slice(0, 2).join("/") : reference.split("/")[0]!;
  const entries = workspacePackages.get(packageName);
  if (entries === undefined) return [];
  const subpath = reference.slice(packageName.length).replace(/^\//u, "");
  return subpath.length === 0 ? [...entries] : resolvedReferenceCandidates(path.posix.dirname(entries[0]!), `./${subpath}`);
}

function workspacePackageFromManifest(contents: string | null, manifestPath: string): { name: string; entries: string[] } | undefined {
  const manifest = parseManifest(contents);
  if (typeof manifest.name !== "string" || manifest.name.length === 0) return undefined;
  const directory = path.posix.dirname(manifestPath);
  const declaredEntries = [manifest.exports, manifest.module, manifest.main, manifest.types].flatMap(manifestEntryStrings);
  const entries = (declaredEntries.length > 0 ? declaredEntries : ["./src/index.ts", "./index.ts", "./index.js"])
    .flatMap((entry) => resolvedReferenceCandidates(directory, entry));
  return { name: manifest.name, entries: [...new Set(entries)] };
}

function manifestEntryStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap(manifestEntryStrings);
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
    const parsed = JSON.parse(contents) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function testScriptsFromManifest(contents: string | null, manifestPath: string): Record<string, string> {
  try {
    const scripts = parseManifest(contents).scripts;
    if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return {};
    const commands = Object.fromEntries(Object.entries(scripts as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const relevant = new Set(Object.keys(commands).filter((name) => name === "test" || name === "pretest" || name === "posttest" || name.startsWith("test:")));
    const pending = [...relevant];
    while (pending.length > 0) {
      const command = commands[pending.shift()!];
      if (command === undefined) continue;
      for (const referenced of referencedPackageScripts(command, Object.keys(commands))) {
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

function referencedPackageScripts(command: string, scriptNames: readonly string[]): string[] {
  if (!/\b(?:npm|pnpm|yarn|bun)\b/u.test(command)) return [];
  const tokens = new Set(command.match(/[A-Za-z0-9:_-]+/gu) ?? []);
  return scriptNames.filter((name) => tokens.has(name));
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
