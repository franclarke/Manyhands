import { describe, it, expect } from "vitest";
import { RecursiveDecomposer, type AnthropicLike, type FeatureRequest } from "@manyhands/decomposer";
import { runPlanningFlow } from "@manyhands/orchestrator-graph";

/**
 * End-to-end planning integration: the recursive decomposer flows through the
 * product's planning pipeline (runPlanningFlow → validate graph + contracts
 * → scheduler) without issues. Proves the new decomposer is a drop-in for the
 * pipeline, not just correct in isolation.
 */
function scriptedClient(script: Array<{ match: string; response: unknown }>): AnthropicLike {
  return {
    messages: {
      async create(args) {
        const content = args.messages[0]?.content ?? "";
        const entry = script.find((s) => content.includes(s.match));
        if (entry === undefined) throw new Error(`no scripted response for:\n${content}`);
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

function atomic(files: string[]): unknown {
  return {
    decision: "atomic",
    reasoning: "single cohesive unit",
    allowedPaths: files.map((f) => f.replace(/[^/]+$/, "**")),
    forbiddenPaths: [],
    expectedFiles: files,
    acceptanceCriteria: ["the module behaves per its contract"]
  };
}

describe("RecursiveDecomposer through the planning pipeline", () => {
  it("produces a schedulable, validation-clean planning result", async () => {
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "decompose",
          reasoning: "pipeline with seams",
          sharedInterfaces: [
            { id: "Token", kind: "type", signature: "type Token = { kind: string }", description: "token" },
            { id: "Ast", kind: "type", signature: "type Ast = number | { op: string }", description: "tree" }
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

    const result = await runPlanningFlow({
      feature: FEATURE,
      decomposer,
      mode: "fine",
      generatedAt: "2026-05-31T00:00:00.000Z"
    });

    expect(result.summary.validationIssues).toEqual([]);
    expect(result.summary.leafCount).toBe(3);
    expect(result.summary.contractCount).toBe(3);
    expect(result.summary.dependencyCount).toBe(2);
    // The scheduler produced an executable batch plan from the recursive graph.
    expect(result.summary.batchCount).toBeGreaterThan(0);
  });
});
