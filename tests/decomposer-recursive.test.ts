import { describe, it, expect, vi } from "vitest";
import { RecursiveDecomposer } from "@manyhands/decomposer";
import type { AnthropicLike } from "@manyhands/decomposer";
import type { FeatureRequest } from "@manyhands/decomposer";

/**
 * Mock LLM client: routes each step call to a scripted JSON response by matching
 * a unique substring of the node goal that appears in the user prompt
 * (`- goal: ...`). One entry per node visited during the recursion.
 */
function scriptedClient(script: Array<{ match: string; response: unknown }>): AnthropicLike {
  return {
    messages: {
      async create(args) {
        const content = args.messages[0]?.content ?? "";
        const entry = script.find((s) => content.includes(s.match));
        if (entry === undefined) {
          throw new Error(`no scripted response matched prompt:\n${content}`);
        }
        return { content: [{ type: "text", text: JSON.stringify(entry.response) }] };
      }
    }
  };
}

const FEATURE: FeatureRequest = {
  id: "calc",
  title: "Expression calculator",
  description: "Evaluate arithmetic expression strings",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["calculate returns the numeric value of an expression"]
};

describe("RecursiveDecomposer — atomic root (single-agent shape)", () => {
  it("produces a root with a single leaf when the root is atomic", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "atomic",
          reasoning: "small enough for one agent at low aggressiveness",
          allowedPaths: ["src/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/calculate.ts"],
          acceptanceCriteria: ["calculate returns the numeric value of an expression"]
        }
      }
    ]);
    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "low"
    });

    const result = await decomposer.decompose(FEATURE);
    const nodes = Object.values(result.graph.nodes);

    expect(result.graph.rootId).toBe("root");
    expect(result.graph.nodes.root?.kind).toBe("root");
    const leaves = nodes.filter((n) => n.kind === "leaf");
    expect(leaves).toHaveLength(1);
    expect(result.contracts).toHaveLength(1);
    expect(leaves[0]?.contract?.executionScope?.implementationPaths).toEqual(["src/**"]);
  });

  it("threads atomic leaf validation commands into the generated contract", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "atomic",
          reasoning: "small enough for one agent at low aggressiveness",
          allowedPaths: ["src/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/calculate.ts"],
          acceptanceCriteria: ["calculate returns the numeric value of an expression"],
          leafValidationCommands: [{ command: "npm", args: ["test", "--", "src/calculate.test.ts"] }]
        }
      }
    ]);
    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "low"
    });

    const result = await decomposer.decompose(FEATURE);

    expect(result.contracts[0]?.leafValidationCommands).toEqual([
      { command: "npm", args: ["test", "--", "src/calculate.test.ts"], timeoutMs: 60_000, cwd: "worktree" }
    ]);
  });

  it("defaults atomic leaf validation commands to an empty executable command list", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "atomic",
          reasoning: "small enough for one agent at low aggressiveness",
          allowedPaths: ["src/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/calculate.ts"],
          acceptanceCriteria: ["calculate returns the numeric value of an expression"]
        }
      }
    ]);
    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "low"
    });

    const result = await decomposer.decompose(FEATURE);

    expect(result.contracts[0]?.leafValidationCommands).toEqual([]);
  });

  it("emits recursive planning step lifecycle events", async () => {
    const events: string[] = [];
    const completedChildren: string[][] = [];
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "atomic",
          reasoning: "small enough for one agent at low aggressiveness",
          allowedPaths: ["src/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/calculate.ts"],
          acceptanceCriteria: ["calculate returns the numeric value of an expression"]
        }
      }
    ]);
    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "low",
      onStepStarted: (event) => {
        events.push(`start:${event.nodeId}:${event.depth}`);
      },
      onStepCompleted: (event) => {
        events.push(`done:${event.nodeId}:${event.decision}:${event.childIds.length}`);
        completedChildren.push(event.children.map((child) => child.nodeId));
      }
    });

    await decomposer.decompose(FEATURE);

    expect(events).toEqual(["start:root:0", "done:root:atomic:0"]);
    expect(completedChildren).toEqual([[]]);
  });
});

describe("RecursiveDecomposer — decompose with shared interfaces", () => {
  it("wires consumed/produced interfaces and parent validation onto the children", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "decompose",
          reasoning: "pipeline with real seams",
          sharedInterfaces: [
            { id: "Token", kind: "type", signature: "type Token = { kind: string; value: string }", description: "lexical token" },
            { id: "Ast", kind: "type", signature: "type Ast = { op: string; args: Ast[] } | number", description: "parsed expression tree" }
          ],
          children: [
            { id: "tokenize", title: "Tokenize", goal: "Split the input into tokens", consumes: [], produces: ["Token"] },
            { id: "parse", title: "Parse", goal: "Build an AST from tokens", consumes: ["Token"], produces: ["Ast"] },
            { id: "evaluate", title: "Evaluate", goal: "Compute the result from the AST", consumes: ["Ast"], produces: [] }
          ],
          dependencies: [
            { fromTaskId: "tokenize", toTaskId: "parse", type: "contractual" },
            { fromTaskId: "parse", toTaskId: "evaluate", type: "contractual" }
          ],
          parentValidationCommands: [{ command: "npm", args: ["test"] }]
        }
      },
      { match: "Split the input into tokens", response: atomic(["src/tokenizer.ts"]) },
      { match: "Build an AST from tokens", response: atomic(["src/parser.ts"]) },
      { match: "Compute the result from the AST", response: atomic(["src/evaluator.ts"]) }
    ]);

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high"
    });

    const result = await decomposer.decompose(FEATURE);

    // Structure: root + 3 leaves, 2 dependencies.
    const leaves = Object.values(result.graph.nodes).filter((n) => n.kind === "leaf");
    expect(leaves.map((l) => l.id).sort()).toEqual(["evaluate", "parse", "tokenize"]);
    expect(result.graph.dependencies).toHaveLength(2);

    // The parser leaf consumes Token and produces Ast.
    const parse = result.graph.nodes.parse;
    expect(parse?.contract?.consumedInterfaces?.map((i) => i.id)).toEqual(["Token"]);
    expect(parse?.contract?.producedInterfaces?.map((i) => i.id)).toEqual(["Ast"]);
    // The consumed interface carries the real signature + provenance.
    expect(parse?.contract?.consumedInterfaces?.[0]?.signature).toContain("type Token");
    expect(parse?.contract?.consumedInterfaces?.[0]?.definedAtNodeId).toBe("root");

    // The tokenizer leaf produces Token, consumes nothing.
    const tokenize = result.graph.nodes.tokenize;
    expect(tokenize?.contract?.producedInterfaces?.map((i) => i.id)).toEqual(["Token"]);
    expect(tokenize?.contract?.consumedInterfaces).toBeUndefined();

    // The root composite carries the parent validation command for the Composer.
    expect(result.graph.nodes.root?.contract?.parentValidationCommands?.[0]?.command).toBe("npm");
    expect(result.graph.nodes.root?.contract?.parentValidationCommands?.[0]?.args).toEqual(["test"]);
  });

  it("syncs node.dependencies (shortcut) with graph.dependencies", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "decompose",
          reasoning: "pipeline with real seams",
          sharedInterfaces: [
            { id: "Token", kind: "type", signature: "type Token = { kind: string; value: string }", description: "lexical token" },
            { id: "Ast", kind: "type", signature: "type Ast = { op: string; args: Ast[] } | number", description: "parsed expression tree" }
          ],
          children: [
            { id: "tokenize", title: "Tokenize", goal: "Split the input into tokens", consumes: [], produces: ["Token"] },
            { id: "parse", title: "Parse", goal: "Build an AST from tokens", consumes: ["Token"], produces: ["Ast"] },
            { id: "evaluate", title: "Evaluate", goal: "Compute the result from the AST", consumes: ["Ast"], produces: [] }
          ],
          dependencies: [
            { fromTaskId: "tokenize", toTaskId: "parse", type: "contractual" },
            { fromTaskId: "parse", toTaskId: "evaluate", type: "contractual" }
          ],
          parentValidationCommands: [{ command: "npm", args: ["test"] }]
        }
      },
      { match: "Split the input into tokens", response: atomic(["src/tokenizer.ts"]) },
      { match: "Build an AST from tokens", response: atomic(["src/parser.ts"]) },
      { match: "Compute the result from the AST", response: atomic(["src/evaluator.ts"]) }
    ]);

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high"
    });

    const result = await decomposer.decompose(FEATURE);

    // graph.dependencies is canonical; node.dependencies is its synced shortcut.
    // The edge from→to means `from` is the prerequisite, so node[to].dependencies
    // must list each fromTaskId (and the prerequisite-less node stays empty).
    expect(result.graph.nodes.parse?.dependencies).toEqual(["tokenize"]);
    expect(result.graph.nodes.evaluate?.dependencies).toEqual(["parse"]);
    expect(result.graph.nodes.tokenize?.dependencies).toEqual([]);
  });

  it("retries a step schema failure with feedback that includes the invalid value", async () => {
    const rootPrompts: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client: AnthropicLike = {
      messages: {
        async create(args) {
          const content = args.messages[0]?.content ?? "";
          if (content.includes("Evaluate arithmetic expression strings")) {
            rootPrompts.push(content);
            if (rootPrompts.length === 1) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      decision: "decompose",
                      reasoning: "split the renderer into focused pieces",
                      sharedInterfaces: [
                        {
                          id: "TaskViewModel",
                          kind: "type",
                          signature: "type TaskViewModel = { id: string; title: string }",
                          description: "task shape rendered by the board"
                        }
                      ],
                      children: [
                        {
                          id: "render-columns",
                          title: "Render columns",
                          goal: "Render task status columns",
                          consumes: [],
                          produces: ["TaskViewModel"]
                        },
                        {
                          id: "render-card-list",
                          title: "Render card list",
                          goal: "Render task cards within a column",
                          consumes: ["TaskViewModel"],
                          produces: []
                        },
                        {
                          id: "Task Cards",
                          title: "Render task cards",
                          goal: "Render individual task cards",
                          consumes: ["TaskViewModel"],
                          produces: []
                        }
                      ],
                      dependencies: [],
                      parentValidationCommands: [{ command: "npm", args: ["test"] }]
                    })
                  }
                ]
              };
            }

            expect(content).toContain("children.2.id");
            expect(content).toContain("\"Task Cards\"");
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    decision: "decompose",
                    reasoning: "split the renderer into focused pieces",
                    sharedInterfaces: [
                      {
                        id: "TaskViewModel",
                        kind: "type",
                        signature: "type TaskViewModel = { id: string; title: string }",
                        description: "task shape rendered by the board"
                      }
                    ],
                    children: [
                      {
                        id: "render-columns",
                        title: "Render columns",
                        goal: "Render task status columns",
                        consumes: [],
                        produces: ["TaskViewModel"]
                      },
                      {
                        id: "render-card-list",
                        title: "Render card list",
                        goal: "Render task cards within a column",
                        consumes: ["TaskViewModel"],
                        produces: []
                      },
                      {
                        id: "task-cards",
                        title: "Render task cards",
                        goal: "Render individual task cards",
                        consumes: ["TaskViewModel"],
                        produces: []
                      }
                    ],
                    dependencies: [],
                    parentValidationCommands: [{ command: "npm", args: ["test"] }]
                  })
                }
              ]
            };
          }

          if (content.includes("Render task status columns")) {
            return { content: [{ type: "text", text: JSON.stringify(atomic(["src/columns.ts"])) }] };
          }
          if (content.includes("Render task cards within a column")) {
            return { content: [{ type: "text", text: JSON.stringify(atomic(["src/card-list.ts"])) }] };
          }
          if (content.includes("Render individual task cards")) {
            return { content: [{ type: "text", text: JSON.stringify(atomic(["src/task-card.ts"])) }] };
          }

          throw new Error(`no scripted response matched prompt:\n${content}`);
        }
      }
    };

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high"
    });

    try {
      const result = await decomposer.decompose(FEATURE);

      expect(rootPrompts).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('(received "Task Cards")'));
      expect(result.graph.nodes["task-cards"]).toBeDefined();
      expect(result.graph.nodes["Task Cards"]).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("expands sibling child steps concurrently by default", async () => {
    let activeChildCalls = 0;
    let maxActiveChildCalls = 0;
    const client: AnthropicLike = {
      messages: {
        async create(args) {
          const content = args.messages[0]?.content ?? "";
          if (content.includes("Evaluate arithmetic expression strings")) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    decision: "decompose",
                    reasoning: "two independent slices",
                    sharedInterfaces: [],
                    children: [
                      { id: "first-child", title: "First child", goal: "Implement first child", consumes: [], produces: [] },
                      { id: "second-child", title: "Second child", goal: "Implement second child", consumes: [], produces: [] }
                    ],
                    dependencies: [],
                    parentValidationCommands: []
                  })
                }
              ]
            };
          }

          if (content.includes("Implement first child") || content.includes("Implement second child")) {
            activeChildCalls += 1;
            maxActiveChildCalls = Math.max(maxActiveChildCalls, activeChildCalls);
            await sleep(25);
            activeChildCalls -= 1;
            return { content: [{ type: "text", text: JSON.stringify(atomic(["src/child.ts"])) }] };
          }

          throw new Error(`unexpected prompt:\n${content}`);
        }
      }
    };

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high"
    });

    await decomposer.decompose(FEATURE);

    expect(maxActiveChildCalls).toBe(2);
  });

  it("honors maxParallelSteps when expanding siblings", async () => {
    let activeChildCalls = 0;
    let maxActiveChildCalls = 0;
    const client: AnthropicLike = {
      messages: {
        async create(args) {
          const content = args.messages[0]?.content ?? "";
          if (content.includes("Evaluate arithmetic expression strings")) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    decision: "decompose",
                    reasoning: "two independent slices",
                    sharedInterfaces: [],
                    children: [
                      { id: "first-child", title: "First child", goal: "Implement first child", consumes: [], produces: [] },
                      { id: "second-child", title: "Second child", goal: "Implement second child", consumes: [], produces: [] }
                    ],
                    dependencies: [],
                    parentValidationCommands: []
                  })
                }
              ]
            };
          }

          if (content.includes("Implement first child") || content.includes("Implement second child")) {
            activeChildCalls += 1;
            maxActiveChildCalls = Math.max(maxActiveChildCalls, activeChildCalls);
            await sleep(10);
            activeChildCalls -= 1;
            return { content: [{ type: "text", text: JSON.stringify(atomic(["src/child.ts"])) }] };
          }

          throw new Error(`unexpected prompt:\n${content}`);
        }
      }
    };

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high",
      maxParallelSteps: 1
    });

    await decomposer.decompose(FEATURE);

    expect(maxActiveChildCalls).toBe(1);
  });
});

function atomic(expectedFiles: string[]): unknown {
  return {
    decision: "atomic",
    reasoning: "single function",
    allowedPaths: expectedFiles.map((f) => f.replace(/[^/]+$/, "**")),
    forbiddenPaths: [],
    expectedFiles,
    acceptanceCriteria: ["the module behaves per its contract"]
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
