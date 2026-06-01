import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
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
    const previousPlanning = process.env.MANYHANDS_CODEX_PLANNING_REASONING;
    const previousShared = process.env.MANYHANDS_CODEX_REASONING;
    delete process.env.MANYHANDS_CODEX_PLANNING_REASONING;
    delete process.env.MANYHANDS_CODEX_REASONING;
    const calls: string[][] = [];

    try {
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
        }, 0, "", (args) => calls.push([...args])),
        readFile: async () => {
          throw new Error("no output file");
        },
        writeFile: async () => undefined,
        useShell: false
      });

      const result = await decomposer.decompose(FEATURE);
      expect(result.graph.nodes.root?.kind).toBe("root");
      expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
      expect(calls[0]).toContain("model_reasoning_effort=low");
    } finally {
      restoreEnv("MANYHANDS_CODEX_PLANNING_REASONING", previousPlanning);
      restoreEnv("MANYHANDS_CODEX_REASONING", previousShared);
    }
  });

  it("allows planning reasoning effort to be overridden", async () => {
    const calls: string[][] = [];
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      reasoningEffort: "medium",
      spawn: fakeCodexSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }, 0, "", (args) => calls.push([...args])),
      readFile: async () => {
        throw new Error("no output file");
      },
      writeFile: async () => undefined,
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    expect(calls[0]).toContain("model_reasoning_effort=medium");
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

function fakeCodexSpawn(
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
