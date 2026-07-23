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
  dedupeScaffoldContracts,
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

function contract(
  partial: Partial<InterfaceContract> & {
    id: string;
    signature: string;
    targetPathHints?: string[];
    sourceNodeIds?: string[];
  }
): InterfaceContract & { targetPathHints?: string[]; sourceNodeIds?: string[] } {
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

  it("scaffolds non-path TypeScript contracts using target path hints", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "NoteDomain",
          signature:
            "export type Note = { id: string; title: string };\n" +
            "export const createNoteSchema: z.ZodType<Note>;",
          targetPathHints: ["src/notes.ts", "src/notes.test.ts"]
        }),
        contract({
          id: "NoteStore",
          signature: "export interface NoteStore { list(): Note[]; }\nexport function createInMemoryNoteStore(): NoteStore;",
          targetPathHints: ["src/notes.ts", "src/notes.test.ts"]
        })
      ]
    });

    expect(outcome.unresolved).toEqual([]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]?.path).toBe("src/notes.ts");
    expect(outcome.files[0]?.content).toContain("export type Note");
    expect(outcome.files[0]?.content).toContain("export interface NoteStore");
    expect(outcome.files[0]?.content).toContain("export function createInMemoryNoteStore()");
    expect(outcome.files[0]?.content).toContain("throw new Error");
  });

  it("extracts TypeScript declarations from mixed HTTP contract prose", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "NotesHttpApi",
          kind: "module",
          signature:
            "GET /api/notes -> 200 { notes: Note[] };\n" +
            "POST /api/notes body CreateNoteInput -> 201 { note: Note };\n" +
            "export function createApp(options?: { store?: NoteStore; staticDir?: string }): express.Express;",
          targetPathHints: ["src/app.ts", "src/app.test.ts"]
        })
      ]
    });

    expect(outcome.unresolved).toEqual([]);
    expect(outcome.files[0]?.path).toBe("src/app.ts");
    expect(outcome.files[0]?.content).toContain("export function createApp");
    expect(outcome.files[0]?.content).not.toContain("GET /api/notes");
  });

  it("deduplicates identical contracts and merges path/source metadata", () => {
    const deduped = dedupeScaffoldContracts([
      contract({
        id: "BrowserNotesApiClient",
        kind: "module",
        signature: "export type BrowserNotesApiClient = { list(): Promise<Note[]> };",
        targetPathHints: ["tests/browserNotesApiClient.test.ts"],
        sourceNodeIds: ["root"]
      }),
      contract({
        id: "BrowserNotesApiClient",
        kind: "module",
        signature: "export type BrowserNotesApiClient = { list(): Promise<Note[]> };",
        targetPathHints: ["src/browserNotesApiClient.ts"],
        sourceNodeIds: ["browser-notes-api-client"]
      })
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.targetPathHints).toEqual(["tests/browserNotesApiClient.test.ts", "src/browserNotesApiClient.ts"]);
    expect(deduped[0]?.sourceNodeIds).toEqual(["root", "browser-notes-api-client"]);
  });

  it("scaffolds common notes-app frontend/backend seams deterministically after dedupe", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "ProjectRuntime",
          kind: "module",
          signature: 'package.json scripts: { "test": "vitest run" }; TypeScript ESM project.',
          targetPathHints: ["package.json", "tsconfig.json"]
        }),
        contract({
          id: "NoteDomain",
          signature: "export type Note = { id: string; title: string; content: string };",
          targetPathHints: ["src/notes.ts"]
        }),
        contract({
          id: "NoteDomain",
          signature: "export type Note = { id: string; title: string; content: string };",
          targetPathHints: ["src/notes.ts"]
        }),
        contract({
          id: "NotesHttpApi",
          kind: "module",
          signature:
            "GET /api/notes -> 200 { notes: Note[] };\n" +
            "export function createApp(options?: { store?: NoteStore }): express.Express;",
          targetPathHints: ["src/app.ts", "src/app.test.ts"]
        }),
        contract({
          id: "FrontendDomContract",
          kind: "module",
          signature:
            "export type FrontendDomContract = {\n" +
            "  formSelector: '#note-form';\n" +
            "  titleInputSelector: '#note-title';\n" +
            "  contentInputSelector: '#note-content';\n" +
            "  notesListSelector: '#notes-list';\n" +
            "};",
          targetPathHints: ["public/index.html", "public/styles.css"]
        }),
        contract({
          id: "NotesFrontendApp",
          kind: "module",
          signature: "export function startNotesApp(options?: { root?: ParentNode }): void;",
          targetPathHints: ["public/app.js", "tests/notes-ui.test.ts"]
        })
      ]
    });

    expect(outcome.unresolved.map((entry) => entry.id)).toEqual(["ProjectRuntime"]);
    expect(outcome.files.map((file) => file.path).sort()).toEqual([
      "public/app.js",
      "public/index.html",
      "src/app.ts",
      "src/notes.ts"
    ]);
    expect(outcome.files.find((file) => file.path === "public/index.html")?.content).toContain('id="note-form"');
    expect(outcome.files.find((file) => file.path === "public/index.html")?.content).toContain('type="module"');
  });

  it("merges DOM selectors from multiple contracts targeting the same HTML file", () => {
    const outcome = scaffoldInterfaces({
      contracts: [
        contract({
          id: "FrontendDomForm",
          kind: "module",
          signature: "Selector: '#note-form'\nSelector: '#note-title'",
          targetPathHints: ["public/index.html"]
        }),
        contract({
          id: "FrontendDomList",
          kind: "module",
          signature: "Selector: '#notes-list'\nSelector: '#empty-state'",
          targetPathHints: ["public/index.html"]
        })
      ]
    });

    expect(outcome.unresolved).toEqual([]);
    expect(outcome.files).toHaveLength(1);
    const html = outcome.files[0]?.content ?? "";
    expect(html).toContain('id="note-form"');
    expect(html).toContain('id="note-title"');
    expect(html).toContain('id="notes-list"');
    expect(html).toContain('id="empty-state"');
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
  options: AgentExecutorOptions[] = [];
  constructor(
    private readonly onExecute?: () => Promise<void>,
    private readonly outcome: ExecutorRunOutcome = { exitCode: 0, durationMs: 1, timedOut: false, stdout: "", stderr: "" }
  ) {}
  async execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome> {
    this.calls += 1;
    this.models.push(options.model);
    this.options.push(options);
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
    childrenIds: leaves.map((leaf) => leaf.id)
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
    expect(executor.options[0]?.bypassApprovals).toBe(false);
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
    ).rejects.toThrow(/GroundingAgent LLM fallback failed[\s\S]*contracts=TaskStore[\s\S]*exitCode=1/);
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

  it("includes actionable timeout diagnostics for fallback failures", async () => {
    const executor = new FakeExecutor(undefined, {
      exitCode: 124,
      durationMs: 120_001,
      timedOut: true,
      stdout: "thinking",
      stderr: "still working",
      commandLine: "codex --sandbox workspace-write --ask-for-approval never exec -"
    });
    const git = new FakeGitRunner({ heads: { [repoRoot]: "HEAD_SHA" } });
    const agent = new GroundingAgent({ executor, git, buildExportIndex: async () => new Map(), executorTimeoutMs: 120_000 });
    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "ProjectRuntime", kind: "module", signature: "package.json scripts: { test: vitest }" })
        ])
      ],
      repoRoot
    );

    await expect(
      agent.run({
        repoRoot,
        graph,
        selection: { executorId: "codex-cli", model: "gpt-5.5" },
        runId: "run-timeout"
      })
    ).rejects.toThrow(
      /stage=grounding\.llm_fallback[\s\S]*contracts=ProjectRuntime[\s\S]*timeoutMs=120000[\s\S]*timedOut=true[\s\S]*stderrTail:\nstill working/
    );
  });

  it("splits LLM fallback into one contract per batch by default", async () => {
    const executor = new FakeExecutor();
    const git = new FakeGitRunner({
      heads: { [repoRoot]: "HEAD_SHA" },
      diffCachedNameOnly: [],
      commitSha: "SKELETON_SHA"
    });
    const agent = new GroundingAgent({ executor, git, buildExportIndex: async () => new Map() });
    const graph = makeGraph(
      [
        makeLeafWithSeams("leaf-1", [
          contract({ id: "ProjectRuntime", kind: "module", signature: "package.json scripts: { test: vitest }" }),
          contract({ id: "UnknownRuntime", kind: "module", signature: "external runtime setup" })
        ])
      ],
      repoRoot
    );

    await agent.run({
      repoRoot,
      graph,
      selection: { executorId: "codex-cli", model: "gpt-5.5" },
      runId: "run-batches"
    });

    expect(executor.calls).toBe(2);
  });
});
