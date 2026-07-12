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

const ATOMIC_STEP = {
  decision: "atomic",
  reasoning: "single function",
  allowedPaths: ["src/**"],
  forbiddenPaths: [],
  expectedFiles: ["src/index.ts"],
  acceptanceCriteria: ["feature works"]
};

const ATOMIC_STEP_WITH_VALIDATION = {
  ...ATOMIC_STEP,
  leafValidationCommands: [{ command: "npm", args: ["test", "--", "src/index.test.ts"] }]
};

describe("CodexRecursiveDecomposer", () => {
  it("uses the raw codex stdout as the recursive step JSON", async () => {
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5-codex",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawn(ATOMIC_STEP, 0, ""),
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);
    expect(result.graph.nodes.root?.kind).toBe("root");
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
  });

  it("preserves leaf validation commands from codex recursive step JSON", async () => {
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5-codex",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawn(ATOMIC_STEP_WITH_VALIDATION, 0, ""),
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);

    expect(result.contracts[0]?.leafValidationCommands).toEqual([
      { command: "npm", args: ["test", "--", "src/index.test.ts"], timeoutMs: 60_000, cwd: "worktree" }
    ]);
  });

  it("plans in sandbox mode against the configured model", async () => {
    const calls: string[][] = [];
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5-codex",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawn(ATOMIC_STEP, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    const args = calls[0] ?? [];
    expect(args).toContain("exec");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5-codex");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect(args).toContain("--skip-git-repo-check");
  });

  it("passes reasoning effort to codex recursive planning when configured", async () => {
    const calls: string[][] = [];
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5-codex",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      reasoningEffort: "medium",
      spawn: fakeCodexSpawn(ATOMIC_STEP, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    expect(calls[0]).toContain('model_reasoning_effort="medium"');
  });

  it("surfaces codex process failures as decomposer LLM errors", async () => {
    const decomposer = new CodexRecursiveDecomposer({
      model: "gpt-5-codex",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeCodexSpawnRaw("not json", 7, "boom"),
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

// Wraps the step JSON as direct raw string output.
function fakeCodexSpawn(
  stepValue: unknown,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void
) {
  const stdout = JSON.stringify(stepValue);
  return fakeCodexSpawnRaw(stdout, exitCode, stderrValue, onArgs);
}

function fakeCodexSpawnRaw(
  stdoutValue: string,
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
      child.stdout.write(stdoutValue);
      if (stderrValue.length > 0) child.stderr.write(stderrValue);
      child.emit("close", exitCode);
    }, 0);
    return child as never;
  };
}
