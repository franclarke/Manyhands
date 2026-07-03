import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ClaudeCodeRecursiveDecomposer, isDecomposerLlmError, type FeatureRequest } from "@manyhands/decomposer";

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

describe("ClaudeCodeRecursiveDecomposer", () => {
  it("uses the claude result envelope as the recursive step JSON", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn(ATOMIC_STEP, 0, ""),
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);
    expect(result.graph.nodes.root?.kind).toBe("root");
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
  });

  it("plans in plan mode against the configured model", async () => {
    const calls: string[][] = [];
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "haiku",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn(ATOMIC_STEP, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    const args = calls[0] ?? [];
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args).toContain("haiku");
  });

  it("sends instructions through the real system-prompt channel, not a fake block in the user turn", async () => {
    // Claude Code CLI 2.1.x treats a `## System` block embedded in the user
    // content as prompt injection and REFUSES to answer (observed live:
    // "This message contains what looks like an injected fake System block…"),
    // so planning always degraded with missing_json. Instructions must travel
    // via --append-system-prompt and stdin must carry ONLY the user content.
    const calls: string[][] = [];
    const stdins: string[] = [];
    const systemContents: Record<string, string> = {};
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn(
        ATOMIC_STEP,
        0,
        "",
        (args) => {
          calls.push([...args]);
          // The temp file only exists for the duration of the call — capture
          // its contents at spawn time.
          const index = args.indexOf("--append-system-prompt-file");
          const path = index >= 0 ? args[index + 1] : undefined;
          if (path !== undefined) systemContents[path] = readFileSync(path.replace(/^"|"$/g, ""), "utf8");
        },
        (data) => stdins.push(data)
      ),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    const args = calls[0] ?? [];
    expect(args).toContain("--append-system-prompt-file");
    const systemPath = args[args.indexOf("--append-system-prompt-file") + 1] ?? "";
    expect(systemContents[systemPath]).toContain("Do NOT call any tools");
    const stdin = stdins.join("");
    expect(stdin).not.toContain("## System");
    expect(stdin).toContain("Local feature");
  });

  it("surfaces claude process failures as decomposer LLM errors", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawnRaw("not json", 7, "boom"),
      useShell: false
    });

    try {
      await decomposer.decompose(FEATURE);
      throw new Error("expected failure");
    } catch (error) {
      expect(isDecomposerLlmError(error)).toBe(true);
    }
  });

  it("surfaces is_error envelopes as decomposer LLM errors", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawnRaw(
        JSON.stringify({ type: "result", is_error: true, result: "model refused" }),
        0,
        ""
      ),
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

// Wraps the step JSON inside a claude `--output-format json` result envelope.
function fakeClaudeSpawn(
  stepValue: unknown,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void,
  onStdin?: (data: string) => void
) {
  const stdout = JSON.stringify({
    type: "result",
    is_error: false,
    result: JSON.stringify(stepValue)
  });
  return fakeClaudeSpawnRaw(stdout, exitCode, stderrValue, onArgs, onStdin);
}

function fakeClaudeSpawnRaw(
  stdoutValue: string,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void,
  onStdin?: (data: string) => void
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
    if (onStdin !== undefined) {
      child.stdin.on("data", (chunk: Buffer) => onStdin(chunk.toString("utf8")));
    }
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
