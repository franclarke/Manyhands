import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CodexRecursiveDecomposer, isDecomposerLlmError, type FeatureRequest } from "@manyhands/decomposer";

const FEATURE: FeatureRequest = {
  id: "local-feature",
  title: "Local feature",
  description: "Implement a local feature",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["feature works"]
};

describe("CodexRecursiveDecomposer", () => {
  it("uses codex exec output as the recursive step JSON", async () => {
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }),
      readFile: async () => {
        throw new Error("no output file");
      },
      writeFile: async () => undefined,
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);
    expect(result.graph.nodes.root?.kind).toBe("root");
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
  });

  it("surfaces codex process failures as decomposer LLM errors", async () => {
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawn("not json", 7, "boom"),
      readFile: async () => {
        throw new Error("no output file");
      },
      writeFile: async () => undefined,
      useShell: false
    });

    try {
      await decomposer.decompose(FEATURE);
      throw new Error("expected failure");
    } catch (error) {
      expect(isDecomposerLlmError(error)).toBe(true);
    }
  });
});

function fakeCodexSpawn(stdoutValue: unknown, exitCode = 0, stderrValue = "") {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setTimeout(() => {
      child.stdout.write(typeof stdoutValue === "string" ? stdoutValue : JSON.stringify(stdoutValue));
      if (stderrValue.length > 0) child.stderr.write(stderrValue);
      child.emit("close", exitCode);
    }, 0);
    return child as never;
  };
}
