import { describe, expect, it, vi } from "vitest";
import {
  RecursiveDecomposer,
  type AnthropicLike,
  type FeatureRequest
} from "@manyhands/decomposer";
import { validateExecutableTaskGraph } from "@manyhands/task-graph";

/**
 * Mock LLM client: routes each step call to a scripted JSON response by matching
 * a unique substring of the node goal that appears in the user prompt. One entry
 * per node visited during the recursion.
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

const FEATURE: FeatureRequest = {
  id: "calc",
  title: "Expression calculator",
  description: "Evaluate arithmetic expression strings",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["calculate returns the numeric value of an expression"]
};

const EVAL_API = {
  id: "EvalApi",
  kind: "function" as const,
  signature: "function evaluate(input: string): number",
  description: "evaluate an arithmetic expression to a number"
};

describe("RecursiveDecomposer — nested interface production obligation", () => {
  it("rejects a decompose step that drops an inherited production obligation onto a composite child", async () => {
    // root assigns the seam "EvalApi" to the `producer` child, but `producer`
    // then decomposes into leaves that produce NOTHING — so no leaf in the whole
    // tree produces "EvalApi", while the `consumer` leaf consumes it. The step's
    // own sharedInterfaces orphan check passes (producer declares produces:
    // ["EvalApi"]), so without propagating the obligation downward the broken
    // plan slips through decomposition and only blows up later at the executable
    // boundary with orphan_consumed_interface.
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "decompose",
          reasoning: "producer/consumer split around the eval seam",
          sharedInterfaces: [EVAL_API],
          children: [
            { id: "producer", title: "Producer", goal: "Produce the evaluation API", consumes: [], produces: ["EvalApi"] },
            { id: "consumer", title: "Consumer", goal: "Consume the evaluation API", consumes: ["EvalApi"], produces: [] }
          ],
          dependencies: [{ fromTaskId: "producer", toTaskId: "consumer", type: "contractual" }],
          parentValidationCommands: []
        }
      },
      {
        match: "Produce the evaluation API",
        response: {
          decision: "decompose",
          reasoning: "split the producer but forget to carry the seam down",
          sharedInterfaces: [],
          children: [
            { id: "prod-core", title: "Core", goal: "Core production piece", consumes: [], produces: [] },
            { id: "prod-helper", title: "Helper", goal: "Helper production piece", consumes: [], produces: [] }
          ],
          dependencies: [],
          parentValidationCommands: []
        }
      },
      { match: "Core production piece", response: atomic(["src/core.ts"]) },
      { match: "Helper production piece", response: atomic(["src/helper.ts"]) },
      { match: "Consume the evaluation API", response: atomic(["src/consumer.ts"]) }
    ]);

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high",
      maxStepAttempts: 1,
      stepRetryBaseDelayMs: 0
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(decomposer.decompose(FEATURE)).rejects.toThrow(/EvalApi/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("accepts a decompose step that carries the inherited obligation down to a grandchild leaf", async () => {
    // Same shape, but the producer composite reassigns "EvalApi" to one of its
    // own leaves, so the obligation reaches a real producer. The plan is valid
    // at the executable boundary — the fix must not over-reject this case.
    const client = scriptedClient([
      {
        match: "Evaluate arithmetic expression strings",
        response: {
          decision: "decompose",
          reasoning: "producer/consumer split around the eval seam",
          sharedInterfaces: [EVAL_API],
          children: [
            { id: "producer", title: "Producer", goal: "Produce the evaluation API", consumes: [], produces: ["EvalApi"] },
            { id: "consumer", title: "Consumer", goal: "Consume the evaluation API", consumes: ["EvalApi"], produces: [] }
          ],
          dependencies: [{ fromTaskId: "producer", toTaskId: "consumer", type: "contractual" }],
          parentValidationCommands: []
        }
      },
      {
        match: "Produce the evaluation API",
        response: {
          decision: "decompose",
          reasoning: "split the producer and carry the seam to the core leaf",
          sharedInterfaces: [],
          children: [
            { id: "prod-core", title: "Core", goal: "Core production piece", consumes: [], produces: ["EvalApi"] },
            { id: "prod-helper", title: "Helper", goal: "Helper production piece", consumes: [], produces: [] }
          ],
          dependencies: [],
          parentValidationCommands: []
        }
      },
      { match: "Core production piece", response: atomic(["src/core.ts"]) },
      { match: "Helper production piece", response: atomic(["src/helper.ts"]) },
      { match: "Consume the evaluation API", response: atomic(["src/consumer.ts"]) }
    ]);

    const decomposer = new RecursiveDecomposer({
      client,
      model: "test-model",
      userPrompt: "build a calculator",
      aggressiveness: "high",
      maxStepAttempts: 1,
      stepRetryBaseDelayMs: 0
    });

    const result = await decomposer.decompose(FEATURE);

    // The grandchild leaf is the real producer of the inherited seam.
    expect(result.graph.nodes["prod-core"]?.contract?.producedInterfaces?.map((i) => i.id)).toEqual(["EvalApi"]);
    // And the plan is sound at the executable boundary — no orphan_consumed_interface.
    const issues = validateExecutableTaskGraph(result.graph).filter((issue) => issue.severity === "error");
    expect(issues).toEqual([]);
  });
});
