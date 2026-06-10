import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliAgentExecutor,
  GEMINI_PROFILE,
  buildGeminiArgs,
  parseGeminiOutcome,
  type AgentExecutorOptions,
  type ExecutorRunOutcome
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);

function optionsFor(cwd: string, overrides: Partial<AgentExecutorOptions> = {}): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "gemini-2.5-pro",
    timeoutMs: 300_000,
    bypassApprovals: true,
    ...overrides
  };
}

function outcome(partial: Partial<ExecutorRunOutcome>): ExecutorRunOutcome {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 5, ...partial };
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
  it("uses yolo approval, structured JSON output, and the stdin directive", () => {
    expect(buildGeminiArgs(optionsFor("/repo"))).toEqual([
      "--model",
      "gemini-2.5-pro",
      "--approval-mode",
      "yolo",
      "--skip-trust",
      "-o",
      "json",
      "-p",
      "Follow-instructions-on-stdin"
    ]);
  });

  it("never passes the instruction text as an argument (it is piped over stdin)", () => {
    const args = buildGeminiArgs(optionsFor("/repo"));
    expect(args).not.toContain("/repo/instructions.txt");
  });
});

describe("parseGeminiOutcome", () => {
  it("extracts the response text and reported token usage from JSON stats", () => {
    const stdout = JSON.stringify({
      response: "All files updated.",
      stats: {
        models: {
          "gemini-2.5-pro": { tokens: { prompt: 900, candidates: 180, total: 1080 } }
        }
      }
    });

    const parsed = parseGeminiOutcome(outcome({ stdout }));

    expect(parsed.stdout).toBe("All files updated.");
    expect(parsed.tokensIn).toBe(900);
    expect(parsed.tokensOut).toBe(180);
  });

  it("sums usage across models when several were involved", () => {
    const stdout = JSON.stringify({
      response: "done",
      stats: {
        models: {
          "gemini-2.5-pro": { tokens: { prompt: 100, candidates: 20 } },
          "gemini-2.5-flash": { tokens: { prompt: 40, candidates: 10 } }
        }
      }
    });

    const parsed = parseGeminiOutcome(outcome({ stdout }));

    expect(parsed.tokensIn).toBe(140);
    expect(parsed.tokensOut).toBe(30);
  });

  it("surfaces a structured error payload on stderr", () => {
    const stdout = JSON.stringify({ error: { type: "ApiError", message: "quota exceeded", code: 429 } });

    const parsed = parseGeminiOutcome(outcome({ stdout, exitCode: 1 }));

    expect(parsed.stderr).toContain("quota exceeded");
  });

  it("passes non-JSON output through untouched", () => {
    const raw = outcome({ stdout: "plain text response" });
    expect(parseGeminiOutcome(raw)).toEqual(raw);
  });
});

describe("CliAgentExecutor with the Gemini profile (injected spawn)", () => {
  it("captures stdout/stderr, exit code, and parses structured output", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ response: "ok", stats: { models: { m: { tokens: { prompt: 7, candidates: 3 } } } } })
      )
    );
    child.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      exitCode: 0,
      stdout: "ok",
      tokensIn: 7,
      tokensOut: 3,
      timedOut: false
    });
  });

  it("invokes onOutput for stdout/stderr chunks as they arrive", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));
    const chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];

    const promise = executor.execute(optionsFor("/repo", { onOutput: (chunk) => chunks.push(chunk) }));
    child.stdout.emit("data", Buffer.from("thinking\n"));
    child.stderr.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0);

    await promise;
    expect(chunks).toEqual([
      { stream: "stdout", chunk: "thinking\n" },
      { stream: "stderr", chunk: "warning\n" }
    ]);
  });

  it("reports agent MH_STATUS lines through onAgentStatus while preserving raw output", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));
    const statuses: Array<{ message: string }> = [];
    const chunks: string[] = [];

    const promise = executor.execute(
      optionsFor("/repo", {
        onAgentStatus: (status) => statuses.push(status),
        onOutput: (chunk) => chunks.push(chunk.chunk)
      })
    );
    child.stdout.emit("data", Buffer.from('MH_STATUS {"message":"scaffolding types"}\n'));
    child.stdout.emit("data", Buffer.from("regular output\n"));
    child.emit("close", 0);
    await promise;

    expect(statuses).toEqual([{ message: "scaffolding types" }]);
    expect(chunks.join("")).toContain("MH_STATUS");
    expect(chunks.join("")).toContain("regular output");
  });

  it("surfaces a spawn error as a non-zero exit outcome with the cause on stderr", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn gemini ENOENT"));

    const result = await promise;
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("ENOENT");
  });

  it("kills the process and flags timedOut when the timeout elapses", async () => {
    const child = fakeChild();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));

    const result = await executor.execute(optionsFor("/repo", { timeoutMs: 5 }));
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
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
    const executor = new CliAgentExecutor(GEMINI_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo", { signal: controller.signal }));
    controller.abort();

    const result = await promise;
    expect(killed).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(result.timedOut).toBe(false);
  });

  it("returns an aborted outcome without spawning when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;
    const executor = new CliAgentExecutor(GEMINI_PROFILE, {
      spawn: () => {
        spawned = true;
        return fakeChild() as never;
      },
      readInstructions: async () => "x",
      useShell: false
    });

    const result = await executor.execute(optionsFor("/repo", { signal: controller.signal }));
    expect(spawned).toBe(false);
    expect(result.exitCode).toBe(130);
  });
});

// Opt-in E2E: only runs with MANYHANDS_E2E_GEMINI=1 and a real `gemini` on PATH.
const E2E = process.env.MANYHANDS_E2E_GEMINI === "1";

describe.skipIf(!E2E)("Gemini executor (real gemini, opt-in)", () => {
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
    const executor = new CliAgentExecutor(GEMINI_PROFILE);
    const result = await executor.execute({
      ...optionsFor(workDir),
      timeoutMs: 120_000
    });
    expect(typeof result.exitCode).toBe("number");
    expect(result.timedOut).toBe(false);
  });
});
