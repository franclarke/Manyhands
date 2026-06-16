/**
 * GroundingAgent — initializes the walking skeleton before parallel leaves run.
 *
 * Strategy (docs/design/future-frontier-tasks.md §4):
 *  1. Deterministic scaffold: every InterfaceContract whose id is a TS file
 *     path is rendered to a syntax-verified skeleton file, with type imports
 *     resolved against the repository's export index (Type Extractor).
 *  2. LLM fallback: ONLY contracts the scaffolder could not resolve are
 *     handed to the agent executor.
 *  3. Syntax gate: every file the skeleton touched must parse before the
 *     orchestrator commits (D6) — a malformed skeleton would break every
 *     parallel leaf at once.
 */
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { CliAgentExecutor } from "../executor/cli-executor.js";
import { CLAUDE_CODE_PROFILE } from "../executor/profiles/claude-code.js";
import type { AgentExecutor } from "../executor/types.js";
import { SimpleGitRunner } from "../git/runner.js";
import type { GitRunner } from "../git/runner.js";
import { execLog, execWarn } from "../logging/log.js";
import { DEFAULT_ARTIFACT_GLOBS } from "../scope/artifacts.js";
import { checkRepairedFiles, describeSyntaxFindings } from "../integration/syntax-check.js";
import { scaffoldInterfaces, type ScaffoldOutcome } from "./skeleton-scaffolder.js";
import type { TaskGraph } from "@manyhands/task-graph";
import type { InterfaceContract } from "@manyhands/contracts";

export interface GroundingAgentParams {
  repoRoot: string;
  graph: TaskGraph;
  model: string;
  runId: string;
}

export interface GroundingAgentDeps {
  executor?: AgentExecutor;
  git?: GitRunner;
  /**
   * Builds the symbol → repo-relative-path map for type-import resolution.
   * Defaults to the repository-index scan; injectable for tests.
   */
  buildExportIndex?: (repoRoot: string) => Promise<ReadonlyMap<string, string>>;
  executorTimeoutMs?: number;
}

export class GroundingAgent {
  private readonly executor: AgentExecutor;
  private readonly git: GitRunner;
  private readonly buildExportIndex: (repoRoot: string) => Promise<ReadonlyMap<string, string>>;
  private readonly executorTimeoutMs: number;

  constructor(deps: GroundingAgentDeps = {}) {
    this.executor = deps.executor ?? new CliAgentExecutor(CLAUDE_CODE_PROFILE);
    this.git = deps.git ?? new SimpleGitRunner();
    this.buildExportIndex = deps.buildExportIndex ?? buildRepositoryExportIndex;
    this.executorTimeoutMs = deps.executorTimeoutMs ?? 300_000;
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

    // Same artifact filter as the recorder: the LLM fallback could have run a
    // package install, and the skeleton commit becomes every leaf's baseline.
    await this.git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS);
    const changedFiles = await this.git.diffCachedNameOnly(params.repoRoot);
    if (changedFiles.length === 0) {
      return this.git.head(params.repoRoot);
    }

    // Syntax gate: a malformed skeleton breaks every parallel leaf at once.
    const syntax = await checkRepairedFiles({ worktreePath: params.repoRoot, files: changedFiles });
    if (!syntax.passed) {
      throw new Error(
        `GroundingAgent produced a malformed skeleton:\n${describeSyntaxFindings(syntax.findings)}`
      );
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

    const prompt = [
      "You are the ManyHands GroundingAgent.",
      "Scaffold a 'walking skeleton' for the interface contracts below: create files containing",
      "only imports, empty types/interfaces, or minimal signatures (function bodies may simply",
      "`throw new Error('Not implemented')`) so parallel coding subagents can import and build",
      "against them without compilation errors.",
      "",
      "=== INTERFACES TO SCAFFOLD ===",
      ...scaffold.unresolved.map(
        (contract) =>
          `- Id: ${contract.id} (${contract.kind})\n  Signature: ${contract.signature}\n  Description: ${contract.description}`
      ),
      ...(scaffold.files.length > 0
        ? [
            "",
            "These seams were already scaffolded deterministically — do NOT modify them:",
            ...scaffold.files.map((file) => `- ${file.path}`)
          ]
        : []),
      "",
      "Instructions:",
      "1. Do NOT write full implementations — scaffolding only.",
      "2. Write the files directly into the repository workspace at sensible paths.",
      "3. Do NOT commit. The orchestrator commits (D6)."
    ].join("\n");

    const instructionFilePath = join(tmpdir(), `mh-grounding-${params.runId}.txt`);
    await writeFile(instructionFilePath, prompt, "utf8");

    const outcome = await this.executor.execute({
      cwd: params.repoRoot,
      instructionFilePath,
      model: params.model,
      timeoutMs: this.executorTimeoutMs,
      bypassApprovals: true,
      processOwnerId: params.runId
    });

    if (outcome.exitCode !== 0 || outcome.timedOut) {
      throw new Error(`GroundingAgent LLM fallback failed with exit code ${outcome.exitCode}`);
    }
  }
}

function collectProducedInterfaces(graph: TaskGraph): InterfaceContract[] {
  const contracts: InterfaceContract[] = [];
  for (const node of Object.values(graph.nodes)) {
    contracts.push(...(node.contract?.producedInterfaces ?? []));
  }
  return contracts;
}

/** Default Type Extractor: exported symbol → repo-relative path, via repository-index. */
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
