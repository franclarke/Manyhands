import { describe, expect, it, vi } from "vitest";
import {
  RecursiveDecomposer,
  isDecomposerLlmError,
  type AnthropicLike,
  type FeatureRequest
} from "@manyhands/decomposer";
import { validateTaskGraph } from "@manyhands/task-graph";

const FEATURE: FeatureRequest = {
  id: "calc",
  title: "Expression calculator",
  description: "Evaluate arithmetic expression strings",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["calculate returns the numeric value of an expression"]
};

describe("RecursiveDecomposer recovery", () => {
  it("retries a step response with no JSON and succeeds with stricter feedback", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, promptsFor } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          raw("I think this should be a single task."),
          raw(`Here is the JSON:\n\n\`\`\`json\n${JSON.stringify(atomic(["src/calculate.ts"]))}\n\`\`\``)
        ]
      }
    ]);

    try {
      const result = await decomposer(client, { maxStepAttempts: 2 }).decompose(FEATURE);

      expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/calculate.ts"]);
      expect(promptsFor("Evaluate arithmetic expression strings")[1]).toContain("Previous attempt was rejected");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing_json"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("retries invalid JSON and succeeds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, callsFor } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [raw("{ invalid json }"), atomic(["src/calculate.ts"])]
      }
    ]);

    try {
      const result = await decomposer(client, { maxStepAttempts: 2 }).decompose(FEATURE);

      expect(result.graph.nodes["root-impl"]).toBeDefined();
      expect(callsFor("Evaluate arithmetic expression strings")).toBe(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid_json"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("retries a transient provider timeout and succeeds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, callsFor } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [new Error("timeout of 120000ms exceeded"), atomic(["src/calculate.ts"])]
      }
    ]);

    try {
      const result = await decomposer(client, { maxStepAttempts: 2 }).decompose(FEATURE);

      expect(result.contracts).toHaveLength(1);
      expect(callsFor("Evaluate arithmetic expression strings")).toBe(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("provider_timeout"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails the root with structured diagnostics after exhausting retries", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const statuses: string[] = [];
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [raw("no json here"), raw("still no json")]
      }
    ]);

    try {
      await decomposer(client, {
        maxStepAttempts: 2,
        onStepStatus: (event) => {
          statuses.push(`${event.nodeId}:${event.state}:${event.error?.kind ?? "none"}`);
        }
      }).decompose(FEATURE);
      throw new Error("expected root failure");
    } catch (error) {
      expect(isDecomposerLlmError(error)).toBe(true);
      if (!isDecomposerLlmError(error)) return;
      expect(error.details?.kind).toBe("missing_json");
      expect(error.details?.nodeId).toBe("root");
      expect(error.details?.attempt).toBe(2);
      expect(error.details?.maxAttempts).toBe(2);
      // The raw model text is the only evidence of WHY parsing failed (prose,
      // refusal, wrong language) — without it the operator can't diagnose.
      expect(error.details?.responseExcerpt).toContain("still no json");
      expect(statuses).toContain("root:retrying:missing_json");
      expect(statuses).toContain("root:failed:missing_json");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails schema-invalid root output with a structured schema error", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          {
            decision: "atomic",
            reasoning: "single unit",
            allowedPaths: ["src/**"],
            forbiddenPaths: [],
            expectedFiles: ["src/calculate.ts"]
          }
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({
        kind: "schema_invalid",
        nodeId: "root",
        attempt: 1
      })
    });
  });

  it("uses the first JSON object that passes the step schema when responses contain several objects", async () => {
    const valid = JSON.stringify(atomic(["src/calculate.ts"]));
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [raw(`debug: {"note": true}\n\nfinal:\n${valid}`)]
      }
    ]);

    const result = await decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE);

    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/calculate.ts"]);
  });

  it("rejects duplicate child ids before accepting a decompose step", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            children: [
              child("tokenize", "Tokenize", "Split the input into tokens"),
              child("tokenize", "Parse", "Build an AST from tokens")
            ]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({ kind: "duplicate_node_id", nodeId: "root" })
    });
  });

  it("rejects duplicate shared interface ids before accepting a decompose step", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            sharedInterfaces: [sharedInterface("ApiContract"), sharedInterface("ApiContract")],
            children: [
              child("api", "API", "Define the calculate API", { produces: ["ApiContract"] }),
              child("frontend", "Frontend", "Render the calculator UI", { consumes: ["ApiContract"] })
            ]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({
        stage: "validate",
        nodeId: "root",
        message: expect.stringContaining('duplicate interface id "ApiContract"')
      })
    });
  });

  it("rejects child interface references that are not declared or inherited", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            sharedInterfaces: [sharedInterface("ApiContract")],
            children: [
              child("api", "API", "Define the calculate API", { produces: ["ApiContract"] }),
              child("frontend", "Frontend", "Render the calculator UI", { consumes: ["MissingContract"] })
            ]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({
        stage: "validate",
        nodeId: "root",
        message: expect.stringContaining('references unknown interface "MissingContract"')
      })
    });
  });

  it("rejects dependencies that reference missing child nodes", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            dependencies: [{ fromTaskId: "tokenize", toTaskId: "missing", type: "contractual" }]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({ kind: "dangling_dependency", nodeId: "root" })
    });
  });

  it("rejects dependency cycles before accepting a decompose step", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            dependencies: [
              { fromTaskId: "tokenize", toTaskId: "parse", type: "contractual" },
              { fromTaskId: "parse", toTaskId: "tokenize", type: "contractual" }
            ]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({ kind: "cycle_detected", nodeId: "root" })
    });
  });

  it("rejects a shared interface that no child produces", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            sharedInterfaces: [sharedInterface("ApiContract")],
            children: [
              child("frontend", "Frontend", "Render the calculator UI", { consumes: ["ApiContract"] }),
              child("logic", "Logic", "Compute the tip split", { consumes: ["ApiContract"] })
            ]
          })
        ]
      }
    ]);

    await expect(decomposer(client, { maxStepAttempts: 1 }).decompose(FEATURE)).rejects.toMatchObject({
      details: expect.objectContaining({ kind: "graph_invalid", nodeId: "root" })
    });
  });

  it("retries an orphan shared interface and succeeds once a producer is assigned", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, promptsFor } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            sharedInterfaces: [sharedInterface("ApiContract")],
            children: [
              child("api", "API", "Define the calculate API", { produces: [] }),
              child("frontend", "Frontend", "Render the calculator UI", { consumes: ["ApiContract"] })
            ]
          }),
          decomposeStep({
            sharedInterfaces: [sharedInterface("ApiContract")],
            children: [
              child("api", "API", "Define the calculate API", { produces: ["ApiContract"] }),
              child("frontend", "Frontend", "Render the calculator UI", { consumes: ["ApiContract"] })
            ]
          })
        ]
      },
      { match: "Define the calculate API", responses: [atomic(["src/api.ts"])] },
      { match: "Render the calculator UI", responses: [atomic(["src/ui.ts"])] }
    ]);

    try {
      const result = await decomposer(client, { maxStepAttempts: 2 }).decompose(FEATURE);

      expect(validateTaskGraph(result.graph)).toEqual([]);
      expect(result.graph.nodes.api?.contract?.producedInterfaces?.map((i) => i.id)).toEqual(["ApiContract"]);
      expect(promptsFor("Evaluate arithmetic expression strings")[1]).toContain("ApiContract");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("can materialize a failed non-root node as an explicit fallback leaf when opted in", async () => {
    const { client } = sequenceClient([
      {
        match: "Evaluate arithmetic expression strings",
        responses: [
          decomposeStep({
            children: [
              child("broken-child", "Broken child", "Plan a child that will fail"),
              child("healthy-child", "Healthy child", "Plan a child that will succeed")
            ]
          })
        ]
      },
      { match: "Plan a child that will fail", responses: [raw("no json")] },
      { match: "Plan a child that will succeed", responses: [atomic(["src/healthy.ts"])] }
    ]);

    const result = await decomposer(client, {
      allowNonRootFallback: true,
      maxParallelSteps: 1,
      maxStepAttempts: 1
    }).decompose(FEATURE);

    expect(validateTaskGraph(result.graph)).toEqual([]);
    expect(result.graph.nodes["broken-child"]?.kind).toBe("leaf");
    expect(result.graph.nodes["broken-child"]?.metadata?.planningState).toBe("fallback");
    expect(result.graph.nodes["broken-child"]?.metadata?.planningError).toMatchObject({
      kind: "missing_json",
      nodeId: "broken-child"
    });
    expect(result.graph.nodes["healthy-child"]?.contract?.expectedOutput.changedFiles).toEqual(["src/healthy.ts"]);
  });
});

interface RawResponse {
  raw: string;
}

type ScriptedResponse = unknown | RawResponse | Error;

function sequenceClient(script: Array<{ match: string; responses: ScriptedResponse[] }>): {
  client: AnthropicLike;
  callsFor: (match: string) => number;
  promptsFor: (match: string) => string[];
} {
  const calls = new Map<string, number>();
  const prompts = new Map<string, string[]>();
  return {
    callsFor: (match) => calls.get(match) ?? 0,
    promptsFor: (match) => prompts.get(match) ?? [],
    client: {
      messages: {
        async create(args) {
          const content = args.messages[0]?.content ?? "";
          const entry = script.find((item) => content.includes(item.match));
          if (entry === undefined) {
            throw new Error(`no scripted response matched prompt:\n${content}`);
          }
          const index = calls.get(entry.match) ?? 0;
          calls.set(entry.match, index + 1);
          prompts.set(entry.match, [...(prompts.get(entry.match) ?? []), content]);
          const response = entry.responses[Math.min(index, entry.responses.length - 1)];
          if (response instanceof Error) {
            throw response;
          }
          const text = isRawResponse(response) ? response.raw : JSON.stringify(response);
          return { content: [{ type: "text", text }] };
        }
      }
    }
  };
}

function decomposer(
  client: AnthropicLike,
  options: Partial<ConstructorParameters<typeof RecursiveDecomposer>[0]> = {}
): RecursiveDecomposer {
  return new RecursiveDecomposer({
    client,
    model: "test-model",
    userPrompt: "build a calculator",
    aggressiveness: "high",
    stepRetryBaseDelayMs: 0,
    ...options
  });
}

function raw(value: string): RawResponse {
  return { raw: value };
}

function isRawResponse(value: unknown): value is RawResponse {
  return typeof value === "object" && value !== null && "raw" in value;
}

function atomic(expectedFiles: string[]): unknown {
  return {
    decision: "atomic",
    reasoning: "single cohesive unit",
    allowedPaths: expectedFiles.map((file) => file.replace(/[^/]+$/, "**")),
    forbiddenPaths: [],
    expectedFiles,
    acceptanceCriteria: ["the module behaves per its contract"]
  };
}

function decomposeStep(overrides: {
  sharedInterfaces?: unknown[];
  children?: unknown[];
  dependencies?: unknown[];
} = {}): unknown {
  return {
    decision: "decompose",
    reasoning: "pipeline with seams",
    sharedInterfaces: overrides.sharedInterfaces ?? [],
    children: overrides.children ?? [
      child("tokenize", "Tokenize", "Split the input into tokens"),
      child("parse", "Parse", "Build an AST from tokens")
    ],
    dependencies: overrides.dependencies ?? [],
    parentValidationCommands: []
  };
}

function sharedInterface(id: string): unknown {
  return {
    id,
    kind: "type",
    signature: `type ${id} = { value: number }`,
    description: `the ${id} seam`
  };
}

function child(
  id: string,
  title: string,
  goal: string,
  seams: { consumes?: string[]; produces?: string[] } = {}
): unknown {
  return { id, title, goal, consumes: seams.consumes ?? [], produces: seams.produces ?? [] };
}
