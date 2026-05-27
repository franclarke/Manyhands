import { describe, expect, it } from "vitest";
import {
  AnthropicDecomposer,
  DecomposerLlmError,
  type AnthropicLike
} from "@manyhands/decomposer";

const feature = {
  id: "login",
  title: "Add login",
  description: "Implement a passwordless login flow",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["Magic link works"]
};

function makeClient(impl: AnthropicLike["messages"]["create"]): AnthropicLike {
  return { messages: { create: impl } };
}

describe("AnthropicDecomposer", () => {
  it("returns a valid DecompositionResult when the LLM produces well-formed JSON", async () => {
    const json = {
      title: "Add login",
      summary: "Passwordless login feature",
      assumptions: [],
      risks: [],
      nodes: [
        {
          id: "root",
          parentId: null,
          title: "Add login",
          intent: "Implement passwordless login",
          kind: "composite",
          depth: 0,
          allowedPaths: ["src/**"],
          forbiddenPaths: [],
          expectedFiles: [],
          acceptanceCriteria: []
        },
        {
          id: "magic-link",
          parentId: "root",
          title: "Magic link issuance",
          intent: "Issue tokens",
          kind: "leaf",
          depth: 1,
          allowedPaths: ["src/auth/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/auth/magic-link.ts"],
          acceptanceCriteria: ["Endpoint emits signed token"]
        },
        {
          id: "session",
          parentId: "root",
          title: "Session lifecycle",
          intent: "Cookies after redemption",
          kind: "leaf",
          depth: 1,
          allowedPaths: ["src/auth/**"],
          forbiddenPaths: [],
          expectedFiles: ["src/auth/session.ts"],
          acceptanceCriteria: ["Session cookie set"]
        }
      ],
      dependencies: [
        { fromTaskId: "magic-link", toTaskId: "session", type: "logical" }
      ]
    };

    const client = makeClient(async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      usage: { input_tokens: 120, output_tokens: 240 }
    }));
    const decomposer = new AnthropicDecomposer({
      apiKey: "test",
      model: "claude-test",
      userPrompt: "Add passwordless login",
      client
    });
    const result = await decomposer.decompose(feature, { mode: "coarse" });
    expect(result.metadata.decomposer).toContain("anthropic");
    expect(Object.keys(result.graph.nodes).sort()).toEqual(["magic-link", "root", "session"]);
    const telemetry = decomposer.getLastResponse();
    expect(telemetry?.usage?.inputTokens).toBe(120);
  });

  it("throws DecomposerLlmError when the model returns non-JSON", async () => {
    const client = makeClient(async () => ({
      content: [{ type: "text", text: "Sorry, I cannot do this." }]
    }));
    const decomposer = new AnthropicDecomposer({
      apiKey: "test",
      model: "claude-test",
      userPrompt: "anything",
      client
    });
    await expect(decomposer.decompose(feature, { mode: "balanced" })).rejects.toBeInstanceOf(DecomposerLlmError);
  });

  it("throws DecomposerLlmError when JSON fails the schema", async () => {
    const client = makeClient(async () => ({
      content: [{ type: "text", text: JSON.stringify({ nope: true }) }]
    }));
    const decomposer = new AnthropicDecomposer({
      apiKey: "test",
      model: "claude-test",
      userPrompt: "anything",
      client
    });
    await expect(decomposer.decompose(feature, { mode: "balanced" })).rejects.toBeInstanceOf(DecomposerLlmError);
  });

  it("throws DecomposerLlmError when guards detect a cycle", async () => {
    const cyclic = {
      title: "x",
      summary: "x",
      assumptions: [],
      risks: [],
      nodes: [
        { id: "root", parentId: null, title: "root", intent: "x", kind: "composite", depth: 0, allowedPaths: [], forbiddenPaths: [], expectedFiles: [], acceptanceCriteria: [] },
        { id: "a", parentId: "root", title: "a", intent: "x", kind: "leaf", depth: 1, allowedPaths: [], forbiddenPaths: [], expectedFiles: [], acceptanceCriteria: ["x"] },
        { id: "b", parentId: "root", title: "b", intent: "x", kind: "leaf", depth: 1, allowedPaths: [], forbiddenPaths: [], expectedFiles: [], acceptanceCriteria: ["x"] }
      ],
      dependencies: [
        { fromTaskId: "a", toTaskId: "b", type: "logical" },
        { fromTaskId: "b", toTaskId: "a", type: "logical" }
      ]
    };
    const client = makeClient(async () => ({
      content: [{ type: "text", text: JSON.stringify(cyclic) }]
    }));
    const decomposer = new AnthropicDecomposer({
      apiKey: "test",
      model: "claude-test",
      userPrompt: "anything",
      client
    });
    await expect(decomposer.decompose(feature, { mode: "balanced" })).rejects.toBeInstanceOf(DecomposerLlmError);
  });
});
