/**
 * Tests for the deterministic walking-skeleton scaffolder (Type Extractor)
 * and the GroundingAgent that drives it (LLM only as fallback).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GroundingAgent,
  scaffoldInterfaces,
  referencedTypeNames,
  type AgentExecutor,
  type AgentExecutorFactory,
  type AgentExecutorOptions,
  type ExecutorSelection,
  type ExecutorRunOutcome
} from "@manyhands/execution-core";
import type { InterfaceContract } from "@manyhands/contracts";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import { FakeGitRunner } from "./helpers/fake-git-runner";

function contract(partial: Partial<InterfaceContract> & { id: string; signature: string }): InterfaceContract {
  return {
    kind: "type",
    description: `seam ${partial.id}`,
    ...partial
  };
}

describe("scaffoldInterfaces", () => {
  it("scaffolds an interface signature into a syntax-clean export", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "src/tokens.ts",
          signature: "interface Token { kind: string; value: string }"
        })
      ]
    });

    expect(outcome.unresolved).toEqual([]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]?.path).toBe("src/tokens.ts");
    expect(outcome.files[0]?.content).toContain("export interface Token");
  });

  it("scaffolds a bodyless function signature with a throwing stub body", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "src/parser.ts",
          kind: "function",
          signature: "function parse(tokens: Token[]): Ast"
        })
      ]
    });

    expect(outcome.files[0]?.content).toContain("export function parse(tokens: Token[]): Ast {");
    expect(outcome.files[0]?.content).toContain('throw new Error("Not implemented: parse")');
  });

  it("extracts type references and emits imports resolved from the repo export index", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "src/parser.ts",
          kind: "function",
          signature: "function parse(tokens: Token[]): Ast"
        })
      ],
      repoExports: new Map([
        ["Token", "src/lexer/tokens.ts"],
        ["Ast", "src/ast.ts"],
        ["Unrelated", "src/other.ts"]
      ])
    });

    const content = outcome.files[0]?.content ?? "";
    expect(content).toContain('import type { Token } from "./lexer/tokens";');
    expect(content).toContain('import type { Ast } from "./ast";');
    expect(content).not.toContain("Unrelated");
  });

  it("merges several contracts targeting the same file", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({ id: "src/seams.ts", signature: "type Ast = number | { op: string; args: Ast[] }" }),
        contract({ id: "src/seams.ts", kind: "function", signature: "function evaluate(ast: Ast): number" })
      ]
    });

    expect(outcome.files).toHaveLength(1);
    const content = outcome.files[0]?.content ?? "";
    expect(content).toContain("export type Ast");
    expect(content).toContain("export function evaluate");
    // Locally declared Ast must not be imported.
    expect(content).not.toContain("import");
  });

  it("returns non-path ids as unresolved (LLM fallback territory)", () => {
    const outcome = scaffoldInterfaces({
      contracts: [contract({ id: "TaskStore", signature: "interface TaskStore { get(id: string): Task }" })]
    });

    expect(outcome.files).toEqual([]);
    expect(outcome.unresolved.map((entry) => entry.id)).toEqual(["TaskStore"]);
  });

  it("returns unparseable signatures as unresolved instead of writing garbage", () => {
    const outcome = scaffoldInterfaces({
      contracts: [contract({ id: "src/broken.ts", signature: "interface { this is not TypeScript" })]
    });

    expect(outcome.files).toEqual([]);
    expect(outcome.unresolved).toHaveLength(1);
  });

  it("rejects absolute and escaping paths", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({ id: "/etc/passwd.ts", signature: "type X = 1" }),
        contract({ id: "../outside.ts", signature: "type Y = 2" }),
        contract({ id: "C:\\windows\\evil.ts", signature: "type Z = 3" })
      ]
    });

    expect(outcome.files).toEqual([]);
    expect(outcome.unresolved).toHaveLength(3);
  });

  it("referencedTypeNames finds generic and heritage references, skipping type params", () => {
    const names = referencedTypeNames(
      "export interface Repo<T extends Entity> extends BaseRepo { find(query: Query<T>): Promise<T[]> }"
    );
    expect(names.has("Entity")).toBe(true);
    expect(names.has("BaseRepo")).toBe(true);
    expect(names.has("Query")).toBe(true);
    expect(names.has("T")).toBe(false);
    expect(names.has("Repo")).toBe(false);
  });
});

// ─── GroundingAgent ────────────────────────────────────────────────────────

class FakeExecutor implements AgentExecutor {
  calls = 0;
  models: string[] = [];
  constructor(
    private readonly onExecute?: () => Promise<void>,
    private readonly outcome: ExecutorRunOutcome = { exitCode: 0, durationMs: 1, timedOut: false, stdout: "", stderr: "" }
  ) {}
  async execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome> {
    this.calls += 1;
    this.models.push(options.model);
    await this.onExecute?.();
    return this.outcome;
  }
}

class FakeExecutorFactory implements AgentExecutorFactory {
  selections: ExecutorSelection[] = [];
  constructor(private readonly executor: AgentExecutor) {}
  create(selection: ExecutorSelection): AgentExecutor {
    this.selections.push(selection);
    return this.executor;
  }
}

function makeLeafWithSeams(id: string, produced: InterfaceContract[]): TaskNode {
  return {
    id,
    parentId: "root",
    kind: "leaf",
    title: id,
    goal: `goal ${id}`,
    status: "planned",
    granularity: "auto",
    depth: 1,
    childrenIds: [],
    dependencies: [],
    contract: {
      taskId: id,
      objective: "obj",
      context: { files: [], symbols: [], constraints: [] },
      allowed: { paths: [], symbols: [] },
      forbidden: { paths: [], symbols: [] },
      relevantSymbols: [],
      dependencies: [],
      acceptance: [{ id: `${id}-ac`, description: "done", verification: "tests" }],
      validationCommands: [],
      expectedOutput: { kind: "patch", description: "diff" },
      limits: { maxDurationMs: 1000, maxCostUsd: 1 },
      knownRisks: [],
      definitionOfDone: "done",
      producedInterfaces: produced
    } as unknown as NonNullable<TaskNode["contract"]>
  };
}

function makeGraph(leaves: TaskNode[], repo: string): TaskGraph {
  const root: TaskNode = {
    id: "root",
    parentId: null,
    kind: "root",
    title: "root",
    goal: "root",
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: leaves.map((leaf) => leaf.id),
    dependencies: []
  };
  return {
    id: "g",
    planId: "p",
    repo,
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "f",
    rootId: "root",
    createdAt: new Date().toISOString(),
    nodes: Object.fromEntries([root, ...leaves].map((node) => [node.id, node])),
    dependencies: []
  };
}

describe("GroundingAgent", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "mh-grounding-"));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("scaffolds deterministic seams to disk and commits without invoking the LLM", async () => {
    const executor = new FakeExecutor();
    const git = new FakeGitRunner({
      heads: { [repoRoot]: "HEAD_SHA" },
      diffCachedNameOnly: ["src/tokens.ts"],
      commitSha: "SKELETON_SHA"
    });
    const agent = new GroundingAgent({
      executor,
      git,
      buildExportIndex: async () => new Map()
    });

    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "src/tokens.ts", signature: "interface Token { kind: string }" })
        ])
      ],
      repoRoot
    );

    const sha = await agent.run({ repoRoot, graph, model: "gemini-2.5-pro", runId: "run-1" });

    expect(sha).toBe("SKELETON_SHA");
    expect(executor.calls).toBe(0);
    const written = await readFile(join(repoRoot, "src/tokens.ts"), "utf8");
    expect(written).toContain("export interface Token");
  });

  it("falls back to the LLM only for unresolved contracts", async () => {
    const executor = new FakeExecutor();
    const git = new FakeGitRunner({
      heads: { [repoRoot]: "HEAD_SHA" },
      diffCachedNameOnly: ["src/tokens.ts"],
      commitSha: "SKELETON_SHA"
    });
    const agent = new GroundingAgent({ executor, git, buildExportIndex: async () => new Map() });

    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "src/tokens.ts", signature: "interface Token { kind: string }" }),
          contract({ id: "TaskStore", signature: "interface TaskStore { get(id: string): unknown }" })
        ])
      ],
      repoRoot
    );

    await agent.run({ repoRoot, graph, model: "gemini-2.5-pro", runId: "run-2" });
    expect(executor.calls).toBe(1);
  });

  it("uses the provided executor selection for unresolved contracts", async () => {
    const executor = new FakeExecutor();
    const executorFactory = new FakeExecutorFactory(executor);
    const git = new FakeGitRunner({
      heads: { [repoRoot]: "HEAD_SHA" },
      diffCachedNameOnly: [],
      commitSha: "SKELETON_SHA"
    });
    const agent = new GroundingAgent({ executorFactory, git, buildExportIndex: async () => new Map() });

    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "TaskStore", signature: "interface TaskStore { get(id: string): unknown }" })
        ])
      ],
      repoRoot
    );

    await agent.run({
      repoRoot,
      graph,
      selection: { executorId: "codex-cli", model: "gpt-5.5" },
      runId: "run-selection"
    });

    expect(executorFactory.selections).toEqual([{ executorId: "codex-cli", model: "gpt-5.5" }]);
    expect(executor.models).toEqual(["gpt-5.5"]);
  });

  it("throws when the LLM fallback exits non-zero", async () => {
    const executor = new FakeExecutor(undefined, {
      exitCode: 1,
      durationMs: 1,
      timedOut: false,
      stdout: "",
      stderr: "model unavailable"
    });
    const git = new FakeGitRunner({ heads: { [repoRoot]: "HEAD_SHA" } });
    const agent = new GroundingAgent({ executor, git, buildExportIndex: async () => new Map() });

    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "TaskStore", signature: "interface TaskStore { get(id: string): unknown }" })
        ])
      ],
      repoRoot
    );

    await expect(
      agent.run({
        repoRoot,
        graph,
        selection: { executorId: "codex-cli", model: "gpt-5.5" },
        runId: "run-nonzero"
      })
    ).rejects.toThrow("GroundingAgent LLM fallback failed with exit code 1");
  });

  it("returns HEAD without committing when the plan declares no seams", async () => {
    const git = new FakeGitRunner({ heads: { [repoRoot]: "HEAD_SHA" } });
    const agent = new GroundingAgent({
      executor: new FakeExecutor(),
      git,
      buildExportIndex: async () => new Map()
    });

    const graph = makeGraph([makeLeafWithSeams("leaf-1", [])], repoRoot);
    const sha = await agent.run({ repoRoot, graph, model: "gemini-2.5-pro", runId: "run-3" });

    expect(sha).toBe("HEAD_SHA");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("throws (and does not commit) when the skeleton fails the syntax gate", async () => {
    // The LLM fallback writes a malformed file into the repo.
    const executor = new FakeExecutor(async () => {
      await writeFile(join(repoRoot, "broken.ts"), "export function oops( {", "utf8");
    });
    const git = new FakeGitRunner({
      heads: { [repoRoot]: "HEAD_SHA" },
      diffCachedNameOnly: ["broken.ts"],
      commitSha: "NEVER"
    });
    const agent = new GroundingAgent({ executor, git, buildExportIndex: async () => new Map() });

    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "NotAPath", signature: "interface NotAPath { x: number }" })
        ])
      ],
      repoRoot
    );

    await expect(agent.run({ repoRoot, graph, model: "gemini-2.5-pro", runId: "run-4" })).rejects.toThrow(
      /malformed skeleton/
    );
    expect(git.opsInvoked()).not.toContain("commit");
  });
});
