import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GeminiCliExecutor,
  buildGeminiArgs,
  type AgentExecutorOptions
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);

function optionsFor(cwd: string): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "gemini-2.5-pro",
    timeoutMs: 300_000,
    sandboxMode: "workspace-write",
    bypassApprovals: true
  };
}

/** Minimal ChildProcess double: an EventEmitter with piped stdio. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: (signal?: string) => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  return child;
}

/** Default deps for injected-spawn tests: fake child + in-memory instructions. */
function depsFor(child: ReturnType<typeof fakeChild>) {
  return {
    spawn: () => child as never,
    readInstructions: async () => "do the thing",
    // Keep tests platform-independent: never shell out to taskkill.
    useShell: false
  };
}

describe("buildGeminiArgs", () => {
  it("threads the model and headless flags; the prompt goes over stdin (-p is only the trigger)", () => {
    const args = buildGeminiArgs(optionsFor("/repo"));
    expect(args).toEqual([
      "--model",
      "gemini-2.5-pro",
      "--approval-mode",
      "yolo",
      "--skip-trust",
      "-o",
      "text",
      "-p",
      "Follow-instructions-on-stdin"
    ]);
  });

  it("auto-approves tool calls so a headless run never blocks on a prompt", () => {
    const args = buildGeminiArgs(optionsFor("/repo"));
    const idx = args.indexOf("--approval-mode");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("yolo");
    expect(args).toContain("--skip-trust");
  });

  it("maps danger-full-access to the same auto-approve mode (Gemini has no OS sandbox tier)", () => {
    const args = buildGeminiArgs({ ...optionsFor("/repo"), sandboxMode: "danger-full-access" });
    const idx = args.indexOf("--approval-mode");
    expect(args[idx + 1]).toBe("yolo");
  });

  it("never passes the instruction text as an argument (it is piped over stdin)", () => {
    const args = buildGeminiArgs(optionsFor("/repo"));
    expect(args).not.toContain("/repo/instructions.txt");
  });
});

describe("GeminiCliExecutor (injected spawn)", () => {
  it("captures stdout/stderr and the exit code on clean close", async () => {
    const child = fakeChild();
    const executor = new GeminiCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.stdout.emit("data", Buffer.from("done\n"));
    child.stderr.emit("data", Buffer.from("warn\n"));
    child.emit("close", 0);

    const outcome = await promise;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("done\n");
    expect(outcome.stderr).toBe("warn\n");
    expect(outcome.timedOut).toBe(false);
  });

  it("invokes onOutput for stdout/stderr chunks as they arrive", async () => {
    const child = fakeChild();
    const executor = new GeminiCliExecutor(depsFor(child));
    const chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];

    const promise = executor.execute({ ...optionsFor("/repo"), onOutput: (chunk) => chunks.push(chunk) });
    child.stdout.emit("data", Buffer.from("thinking\n"));
    child.stderr.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0);

    await promise;
    expect(chunks).toEqual([
      { stream: "stdout", chunk: "thinking\n" },
      { stream: "stderr", chunk: "warning\n" }
    ]);
  });

  it("reports a non-zero exit code", async () => {
    const child = fakeChild();
    const executor = new GeminiCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("close", 1);

    const outcome = await promise;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.timedOut).toBe(false);
  });

  it("surfaces a spawn error as a non-zero exit outcome with the cause on stderr", async () => {
    const child = fakeChild();
    const executor = new GeminiCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn gemini ENOENT"));

    const outcome = await promise;
    expect(outcome.exitCode).toBe(127);
    expect(outcome.stderr).toContain("ENOENT");
  });

  it("kills the process and flags timedOut when the timeout elapses", async () => {
    const child = fakeChild();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    const executor = new GeminiCliExecutor(depsFor(child));

    const outcome = await executor.execute({ ...optionsFor("/repo"), timeoutMs: 5 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).toBe(124);
    expect(killed).toBe(true);
  });

  it("kills the process and returns an aborted outcome when the signal fires", async () => {
    const child = fakeChild();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    const controller = new AbortController();
    const executor = new GeminiCliExecutor(depsFor(child));

    const promise = executor.execute({ ...optionsFor("/repo"), signal: controller.signal });
    controller.abort();

    const outcome = await promise;
    expect(killed).toBe(true);
    expect(outcome.exitCode).toBe(130);
    expect(outcome.timedOut).toBe(false);
  });

  it("returns an aborted outcome without spawning when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;
    const executor = new GeminiCliExecutor({
      spawn: () => {
        spawned = true;
        return fakeChild() as never;
      },
      readInstructions: async () => "x",
      useShell: false
    });

    const outcome = await executor.execute({ ...optionsFor("/repo"), signal: controller.signal });
    expect(spawned).toBe(false);
    expect(outcome.exitCode).toBe(130);
  });
});

// Opt-in E2E: only runs with MANYHANDS_E2E_GEMINI=1 and a real `gemini` on PATH.
const E2E = process.env.MANYHANDS_E2E_GEMINI === "1";

describe.skipIf(!E2E)("GeminiCliExecutor (real gemini, opt-in)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "mh-gemini-e2e-"));
    await writeFile(
      join(workDir, "instructions.txt"),
      "Create a file named hello.txt containing the text 'hello'.\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("invokes the real gemini binary and returns an outcome", async () => {
    await execFileAsync("gemini", ["--version"]);
    const executor = new GeminiCliExecutor();
    const outcome = await executor.execute({
      ...optionsFor(workDir),
      timeoutMs: 120_000
    });
    expect(typeof outcome.exitCode).toBe("number");
    expect(outcome.timedOut).toBe(false);
  });
});
