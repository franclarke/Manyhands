import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateRunTitle, RunTitlerError } from "@/lib/server/runs/run-titler";

/**
 * Fake child process matching the subset of the node:child_process API that
 * the titler's spawn uses: stdout/stderr `.on("data")`, `.on("error"|"close")`,
 * stdin `.on("error")` + `.end()`, and `.kill()`.
 */
function makeFakeSpawn(opts: { stdout?: string; stderr?: string; exitCode?: number; emitError?: Error }) {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter & { end: (data?: string) => void };
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const stdin = new EventEmitter() as EventEmitter & { end: (data?: string) => void };
    stdin.end = () => undefined;
    child.stdin = stdin;
    child.kill = () => undefined;
    // Emit asynchronously so listeners are attached first.
    setImmediate(() => {
      if (opts.emitError !== undefined) {
        child.emit("error", opts.emitError);
        return;
      }
      if (opts.stdout !== undefined) child.stdout.emit("data", Buffer.from(opts.stdout, "utf8"));
      if (opts.stderr !== undefined) child.stderr.emit("data", Buffer.from(opts.stderr, "utf8"));
      child.emit("close", opts.exitCode ?? 0);
    });
    return child as never;
  };
}

function makeRecordingSpawn(opts: { stdout?: string; stderr?: string; exitCode?: number; emitError?: Error }) {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const fakeSpawn = makeFakeSpawn(opts);
  return {
    calls,
    spawn: (command: string, args: readonly string[], options: SpawnOptions) => {
      calls.push({ command, args, options });
      return fakeSpawn();
    }
  };
}

describe("generateRunTitle", () => {
  it("parses a clean title and summary from direct JSON output", async () => {
    const spawn = makeFakeSpawn({
      stdout: JSON.stringify({
        title: "Habit counter mini-app",
        summary: "Una mini-app que crea, lista y resetea hábitos, persistidos en localStorage."
      })
    });
    const result = await generateRunTitle({ userPrompt: "Construí una mini-app...", model: "sonnet", spawn });
    expect(result.title).toBe("Habit counter mini-app");
    expect(result.summary).toContain("hábitos");
  });

  it("unwraps the Claude Code `result` envelope", async () => {
    const inner = JSON.stringify({ title: "Task API DELETE", summary: "Implementa DELETE /tasks/:id con persistencia y tests." });
    const spawn = makeFakeSpawn({ stdout: JSON.stringify({ type: "result", result: inner }) });
    const result = await generateRunTitle({ userPrompt: "Implement DELETE", model: "m", spawn });
    expect(result.title).toBe("Task API DELETE");
  });

  it("uses cmd.exe without shell:true when Windows shell mode is needed", async () => {
    const { spawn, calls } = makeRecordingSpawn({
      stdout: JSON.stringify({ title: "Task title", summary: "Short summary." })
    });

    await generateRunTitle({ userPrompt: "Implement task", model: "sonnet", spawn, platform: "win32" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command.toLowerCase()).toContain("cmd");
    expect(calls[0]?.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "claude"]);
    expect(calls[0]?.args).toContain("--model");
    expect(calls[0]?.args).toContain("sonnet");
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("throws RunTitlerError on non-zero exit", async () => {
    const spawn = makeFakeSpawn({ stdout: "", stderr: "boom", exitCode: 1 });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });

  it("throws RunTitlerError when no parseable JSON is produced", async () => {
    const spawn = makeFakeSpawn({ stdout: "I could not produce JSON." });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });

  it("throws RunTitlerError on spawn error", async () => {
    const spawn = makeFakeSpawn({ emitError: new Error("ENOENT") });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });
});
