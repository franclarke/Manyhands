import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexCliExecutor,
  buildCodexArgs,
  type CodexCliExecutorOptions
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);

function optionsFor(cwd: string): CodexCliExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "gpt-5-codex",
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

describe("buildCodexArgs", () => {
  it("threads sandbox and model in order (prompt goes over stdin, not a flag)", () => {
    const options = { ...optionsFor("/repo"), bypassApprovals: false };
    const args = buildCodexArgs(options);
    expect(args).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5-codex"
    ]);
  });

  it("never passes a --instructions-file flag (codex exec reads stdin)", () => {
    const args = buildCodexArgs(optionsFor("/repo"));
    expect(args).not.toContain("--instructions-file");
  });

  it("never emits --ask-for-approval (codex exec is non-interactive by design)", () => {
    // bypassApprovals is a no-op at the arg layer: `codex exec` has no approval
    // flag and rejects the whole invocation if one is passed (codex-cli 0.135.0).
    const withBypass = buildCodexArgs(optionsFor("/repo"));
    const withoutBypass = buildCodexArgs({ ...optionsFor("/repo"), bypassApprovals: false });
    expect(withBypass).not.toContain("--ask-for-approval");
    expect(withoutBypass).not.toContain("--ask-for-approval");
    expect(withBypass).toEqual(withoutBypass);
  });

  it("honours danger-full-access sandbox mode", () => {
    const args = buildCodexArgs({ ...optionsFor("/repo"), sandboxMode: "danger-full-access" });
    expect(args).toContain("danger-full-access");
  });
});

describe("CodexCliExecutor (injected spawn)", () => {
  it("captures stdout/stderr and the exit code on clean close", async () => {
    const child = fakeChild();
    const executor = new CodexCliExecutor(depsFor(child));

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

  it("reports a non-zero exit code", async () => {
    const child = fakeChild();
    const executor = new CodexCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("close", 1);

    const outcome = await promise;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.timedOut).toBe(false);
  });

  it("surfaces a spawn error as a non-zero exit outcome", async () => {
    const child = fakeChild();
    const executor = new CodexCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn codex ENOENT"));

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
    const executor = new CodexCliExecutor(depsFor(child));

    const outcome = await executor.execute({ ...optionsFor("/repo"), timeoutMs: 5 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).toBe(124);
    expect(killed).toBe(true);
  });
});

// Opt-in E2E: only runs with MANYHANDS_E2E_CODEX=1 and a real `codex` on PATH.
const E2E = process.env.MANYHANDS_E2E_CODEX === "1";

describe.skipIf(!E2E)("CodexCliExecutor (real codex exec, opt-in)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "mh-codex-e2e-"));
    await writeFile(
      join(workDir, "instructions.txt"),
      "Create a file named hello.txt containing the text 'hello'.\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("invokes the real codex binary and returns an outcome", async () => {
    await execFileAsync("codex", ["--version"]);
    const executor = new CodexCliExecutor();
    const outcome = await executor.execute({
      ...optionsFor(workDir),
      timeoutMs: 120_000
    });
    expect(typeof outcome.exitCode).toBe("number");
    expect(outcome.timedOut).toBe(false);
  });
});
