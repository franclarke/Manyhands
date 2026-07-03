/**
 * GroundingAgent initializes the walking skeleton before parallel leaves run.
 *
 * Strategy:
 * 1. Deterministic scaffold for mechanically resolvable interface contracts.
 * 2. Bounded LLM fallback only for unresolved contracts, split into small batches.
 * 3. Syntax gate before the orchestrator commits the skeleton (D6).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TaskGraph } from "@manyhands/task-graph";
import { DefaultAgentExecutorFactory, FixedAgentExecutorFactory, type AgentExecutorFactory } from "../executor/factory.js";
import type { AgentExecutor, ExecutorRunOutcome } from "../executor/types.js";
import { resolveLegacyModelSelection, type ExecutorSelection } from "../executor/registry.js";
import { SimpleGitRunner, type GitRunner } from "../git/runner.js";
import { checkRepairedFiles, describeSyntaxFindings } from "../integration/syntax-check.js";
import { execLog, execWarn } from "../logging/log.js";
import { DEFAULT_ARTIFACT_GLOBS } from "../scope/artifacts.js";
import { GROUNDING_STUB_MARKER } from "./grounding-stub.js";
import { scaffoldInterfaces, type ScaffoldContract, type ScaffoldOutcome } from "./skeleton-scaffolder.js";

export interface GroundingAgentParams {
  repoRoot: string;
  graph: TaskGraph;
  selection?: ExecutorSelection;
  /** Legacy compatibility for tests/old callers; product code passes selection. */
  model?: string;
  runId: string;
}

export interface GroundingAgentDeps {
  executor?: AgentExecutor;
  executorFactory?: AgentExecutorFactory;
  git?: GitRunner;
  /**
   * Builds the symbol -> repo-relative-path map for type-import resolution.
   * Defaults to the repository-index scan; injectable for tests.
   */
  buildExportIndex?: (repoRoot: string) => Promise<ReadonlyMap<string, string>>;
  executorTimeoutMs?: number;
  fallbackBatchSize?: number;
}

export class GroundingAgent {
  private readonly executorFactory: AgentExecutorFactory;
  private readonly git: GitRunner;
  private readonly buildExportIndex: (repoRoot: string) => Promise<ReadonlyMap<string, string>>;
  private readonly executorTimeoutMs: number;
  private readonly fallbackBatchSize: number;

  constructor(deps: GroundingAgentDeps = {}) {
    this.executorFactory =
      deps.executorFactory ?? (deps.executor !== undefined ? new FixedAgentExecutorFactory(deps.executor) : new DefaultAgentExecutorFactory());
    this.git = deps.git ?? new SimpleGitRunner();
    this.buildExportIndex = deps.buildExportIndex ?? buildRepositoryExportIndex;
    this.executorTimeoutMs = deps.executorTimeoutMs ?? 300_000;
    this.fallbackBatchSize = deps.fallbackBatchSize ?? 1;
  }

  /** Scaffold the skeleton and commit it (D6). Returns the skeleton commit sha. */
  async run(params: GroundingAgentParams): Promise<string> {
    const contracts = collectProducedInterfaces(params.graph);
    if (contracts.length === 0) {
      return this.git.head(params.repoRoot);
    }

    const repoExports = await this.buildExportIndex(params.repoRoot).catch(() => new Map<string, string>());
    const scaffold = scaffoldInterfaces({ contracts, repoExports });
    execLog("grounding", "deterministic scaffold computed", {
      run: params.runId,
      contracts: contracts.length,
      deterministicFiles: scaffold.files.length,
      unresolved: scaffold.unresolved.length
    });

    for (const file of scaffold.files) {
      const absolute = join(params.repoRoot, file.path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content, "utf8");
    }

    if (scaffold.unresolved.length > 0) {
      await this.runLlmFallback(params, scaffold);
    }

    await this.git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS);
    const changedFiles = await this.git.diffCachedNameOnly(params.repoRoot);
    if (changedFiles.length === 0) {
      return this.git.head(params.repoRoot);
    }

    const syntax = await checkRepairedFiles({ worktreePath: params.repoRoot, files: changedFiles });
    if (!syntax.passed) {
      throw new Error(`GroundingAgent produced a malformed skeleton:\n${describeSyntaxFindings(syntax.findings)}`);
    }

    return this.git.commit({
      cwd: params.repoRoot,
      message: "mh-grounding: walking skeleton scaffold"
    });
  }

  private async runLlmFallback(params: GroundingAgentParams, scaffold: ScaffoldOutcome): Promise<void> {
    execWarn("grounding", "LLM fallback for non-deterministic contracts", {
      run: params.runId,
      contracts: scaffold.unresolved.map((contract) => contract.id)
    });

    const selection = params.selection ?? resolveLegacyModelSelection(params.model);
    const executor = this.executorFactory.create(selection);
    const batches = chunk(scaffold.unresolved, this.fallbackBatchSize);

    for (const [index, batch] of batches.entries()) {
      const instructionFilePath = join(tmpdir(), `mh-grounding-${params.runId}-${index + 1}.txt`);
      await writeFile(
        instructionFilePath,
        buildFallbackPrompt({
          batch,
          batchIndex: index + 1,
          batchCount: batches.length,
          deterministicFiles: scaffold.files.map((file) => file.path)
        }),
        "utf8"
      );

      const outcome = await executor.execute({
        cwd: params.repoRoot,
        instructionFilePath,
        model: selection.model,
        timeoutMs: this.executorTimeoutMs,
        bypassApprovals: false,
        processOwnerId: params.runId
      });

      if (outcome.exitCode !== 0 || outcome.timedOut) {
        throw new Error(
          formatFallbackFailure({
            batch,
            batchIndex: index + 1,
            batchCount: batches.length,
            instructionFilePath,
            outcome,
            selection,
            timeoutMs: this.executorTimeoutMs
          })
        );
      }
    }
  }
}

function collectProducedInterfaces(graph: TaskGraph): ScaffoldContract[] {
  const contracts: ScaffoldContract[] = [];
  for (const node of Object.values(graph.nodes)) {
    const pathHints = contractPathHints(node.contract);
    for (const contract of node.contract?.producedInterfaces ?? []) {
      contracts.push({
        ...contract,
        targetPathHints: pathHints,
        sourceNodeIds: [node.id]
      });
    }
  }
  return contracts;
}

function contractPathHints(contract: TaskGraph["nodes"][string]["contract"]): string[] {
  return uniqueStrings([
    ...(contract?.expectedOutput.changedFiles ?? []),
    ...(contract?.executionScope?.implementationPaths ?? []),
    ...(contract?.executionScope?.testPaths ?? []),
    ...(contract?.allowed.paths ?? [])
  ]);
}

function buildFallbackPrompt(input: {
  batch: readonly ScaffoldContract[];
  batchIndex: number;
  batchCount: number;
  deterministicFiles: readonly string[];
}): string {
  return [
    "You are the ManyHands GroundingAgent.",
    `Scaffold walking-skeleton interface contracts for batch ${input.batchIndex}/${input.batchCount}.`,
    "Create only imports, empty types/interfaces, or minimal signatures.",
    `Stub every unimplemented function body with exactly: throw new Error("${GROUNDING_STUB_MARKER}: <functionName>"); — a leaf agent replaces it later. This marker is how the orchestrator tells an unfinished stub from a deliverable that is already complete.`,
    "Do not write full implementations. Do not commit.",
    "",
    "=== INTERFACES TO SCAFFOLD ===",
    ...input.batch.map(formatContractForPrompt),
    ...(input.deterministicFiles.length > 0
      ? [
          "",
          "These files were already scaffolded deterministically. Do not modify them unless required for imports:",
          ...input.deterministicFiles.map((file) => `- ${file}`)
        ]
      : []),
    "",
    "Instructions:",
    "1. Prefer the target path hints when present.",
    "2. Write files directly into the repository workspace.",
    "3. Keep output small and mechanical; this is a skeleton for later leaf agents."
  ].join("\n");
}

function formatContractForPrompt(contract: ScaffoldContract): string {
  return [
    `- Id: ${contract.id} (${contract.kind})`,
    contract.sourceNodeIds !== undefined && contract.sourceNodeIds.length > 0
      ? `  Source nodes: ${contract.sourceNodeIds.join(", ")}`
      : undefined,
    contract.targetPathHints !== undefined && contract.targetPathHints.length > 0
      ? `  Target path hints: ${contract.targetPathHints.join(", ")}`
      : undefined,
    `  Signature: ${contract.signature}`,
    `  Description: ${contract.description}`
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatFallbackFailure(input: {
  batch: readonly ScaffoldContract[];
  batchIndex: number;
  batchCount: number;
  instructionFilePath: string;
  outcome: ExecutorRunOutcome;
  selection: ExecutorSelection;
  timeoutMs: number;
}): string {
  const contracts = input.batch.map((contract) => contract.id).join(", ");
  const command = input.outcome.commandLine ?? `${input.selection.executorId} ${input.selection.model}`;
  return [
    "GroundingAgent LLM fallback failed.",
    `stage=grounding.llm_fallback batch=${input.batchIndex}/${input.batchCount}`,
    `contracts=${contracts}`,
    `executor=${input.selection.executorId} model=${input.selection.model}`,
    `command=${command}`,
    `timeoutMs=${input.timeoutMs} durationMs=${input.outcome.durationMs}`,
    `exitCode=${input.outcome.exitCode} timedOut=${input.outcome.timedOut}`,
    `instructionFile=${input.instructionFilePath}`,
    tail(input.outcome.stderr) !== undefined ? `stderrTail:\n${tail(input.outcome.stderr)}` : undefined,
    tail(input.outcome.stdout) !== undefined ? `stdoutTail:\n${tail(input.outcome.stdout)}` : undefined,
    "suggestion=Reduce or path-back the listed contract(s), or retry after fixing the executor/model/auth issue."
  ].filter((line): line is string => line !== undefined).join("\n");
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const normalizedSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    batches.push(items.slice(index, index + normalizedSize));
  }
  return batches;
}

function tail(text: string | undefined, limit = 4_000): string | undefined {
  if (text === undefined || text.length === 0) return undefined;
  return text.length <= limit ? text : text.slice(-limit);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Default Type Extractor: exported symbol -> repo-relative path, via repository-index. */
async function buildRepositoryExportIndex(repoRoot: string): Promise<ReadonlyMap<string, string>> {
  const { buildRepositoryIndex } = await import("@manyhands/repository-index");
  const index = await buildRepositoryIndex({ rootPath: repoRoot });
  const map = new Map<string, string>();
  for (const file of index.files) {
    for (const symbol of file.exportedSymbols) {
      if (!map.has(symbol)) {
        map.set(symbol, file.path);
      }
    }
  }
  return map;
}
