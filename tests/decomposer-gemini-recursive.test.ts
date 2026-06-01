import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { GeminiRecursiveDecomposer, isDecomposerLlmError, type FeatureRequest } from "@manyhands/decomposer";

const FEATURE: FeatureRequest = {
  id: "local-feature",
  title: "Local feature",
  description: "Implement a local feature",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["feature works"]
};

describe("GeminiRecursiveDecomposer", () => {
  it("uses gemini stdout as the recursive step JSON", async () => {
    const calls: string[][] = [];

    const decomposer = new GeminiRecursiveDecomposer({
      model: "gemini-2.5-pro",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeGeminiSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);
    expect(result.graph.nodes.root?.kind).toBe("root");
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
  });

  it("plans in read-only mode against the configured model", async () => {
    const calls: string[][] = [];
    const decomposer = new GeminiRecursiveDecomposer({
      model: "gemini-2.5-flash",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeGeminiSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    const args = calls[0] ?? [];
    expect(args).toContain("--approval-mode");
    expect(args[args.indexOf("--approval-mode") + 1]).toBe("plan");
    expect(args).toContain("gemini-2.5-flash");
    expect(args).toContain("--skip-trust");
  });

  it("surfaces gemini process failures as decomposer LLM errors", async () => {
    const decomposer = new GeminiRecursiveDecomposer({
      model: "gemini-2.5-pro",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeGeminiSpawn("not json", 7, "boom"),
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

function fakeGeminiSpawn(
  stdoutValue: unknown,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void
) {
  return (_command: string, args: readonly string[], _options: SpawnOptions): ChildProcess => {
    onArgs?.(args);
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
