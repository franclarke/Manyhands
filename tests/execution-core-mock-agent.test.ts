import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MockAgentExecutor,
  type AgentExecutorOptions
} from "@manyhands/execution-core";

let workDir: string;

function optionsFor(cwd: string): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "gpt-5-codex",
    timeoutMs: 300_000,
    sandboxMode: "workspace-write",
    bypassApprovals: true
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "mh-mock-codex-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("MockAgentExecutor", () => {
  it("writes configured files into the worktree", async () => {
    const executor = new MockAgentExecutor({
      behaviors: {
        [workDir]: {
          filesToWrite: { "src/routes/tasks.ts": "export const updated = true;\n" }
        }
      }
    });

    const outcome = await executor.execute(optionsFor(workDir));

    const written = await readFile(join(workDir, "src/routes/tasks.ts"), "utf8");
    expect(written).toBe("export const updated = true;\n");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    expect(executor.calls).toHaveLength(1);
  });

  it("returns the default empty behavior when no entry matches", async () => {
    const executor = new MockAgentExecutor();

    const outcome = await executor.execute(optionsFor(workDir));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("");
  });

  it("honours configured exit code, timeout, and token/cost metrics", async () => {
    const executor = new MockAgentExecutor({
      behaviors: {
        [workDir]: {
          exitCode: 124,
          timedOut: true,
          durationMs: 300_000,
          tokensIn: 1200,
          tokensOut: 800,
          costUsd: 0.05
        }
      }
    });

    const outcome = await executor.execute(optionsFor(workDir));

    expect(outcome).toMatchObject({
      exitCode: 124,
      timedOut: true,
      durationMs: 300_000,
      tokensIn: 1200,
      tokensOut: 800,
      costUsd: 0.05
    });
  });

  it("invokes the committer when commitUnexpectedly is set", async () => {
    const committed: string[] = [];
    const executor = new MockAgentExecutor({
      behaviors: { [workDir]: { commitUnexpectedly: true } },
      committer: async (cwd) => {
        committed.push(cwd);
      }
    });

    await executor.execute(optionsFor(workDir));

    expect(committed).toEqual([workDir]);
  });

  it("throws if commitUnexpectedly is set without a committer", async () => {
    const executor = new MockAgentExecutor({
      behaviors: { [workDir]: { commitUnexpectedly: true } }
    });

    await expect(executor.execute(optionsFor(workDir))).rejects.toThrow(/requires a committer/u);
  });
});
