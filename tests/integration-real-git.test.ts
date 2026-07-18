import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  IntegrationAgent,
  JsonIntegrationOperationJournal,
  MockAgentExecutor,
  SimpleGitRunner,
  type AgentExecutor,
  type AgentExecutionResult,
  type AgentExecutorOptions,
  type WorktreeRecord
} from "@manyhands/execution-core";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];
const CHILD_ATTEMPT_ID = "00000000-0000-4000-8000-000000000011";
const PARENT_ATTEMPT_ID = "00000000-0000-4000-8000-000000000012";

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("IntegrationAgent with real Git", () => {
  it("preserves the complete tree when a multi-commit composite is integrated by its parent", async () => {
    const fixture = await createFixture();
    const runner = new SimpleGitRunner();
    const journal = new JsonIntegrationOperationJournal(path.join(fixture.root, "journals"));
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git: runner,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: fixture.repoRoot
    });

    const childWorktree = await addIntegrationWorktree(
      runner,
      fixture,
      "child-composite",
      path.join(fixture.root, "child-integration")
    );
    const childIntegration = await agent.integrate({
      compositeTaskId: "child-composite",
      attemptId: CHILD_ATTEMPT_ID,
      worktree: childWorktree,
      childResults: [
        leafResult("leaf-a", fixture.base, fixture.leafA, "a.txt"),
        leafResult("leaf-b", fixture.base, fixture.leafB, "b.txt")
      ],
      repair: { model: "gpt-5-codex", timeoutMs: 1_000 },
      integrationOperation: { journal, runId: "run-real-git" }
    });

    expect(childIntegration.status).toBe("success");
    expect(childIntegration.integrationCommitSha).toMatch(/^[0-9a-f]{40}$/u);

    const parentWorktree = await addIntegrationWorktree(
      runner,
      fixture,
      "root",
      path.join(fixture.root, "parent-integration")
    );
    const parentIntegration = await agent.integrate({
      compositeTaskId: "root",
      attemptId: PARENT_ATTEMPT_ID,
      worktree: parentWorktree,
      childResults: [
        {
          ...leafResult(
            "child-composite",
            fixture.base,
            childIntegration.integrationCommitSha!,
            ""
          ),
          diff: "",
          changedFiles: [],
          ...(childIntegration.cherryPickMainline !== undefined
            ? { cherryPickMainline: childIntegration.cherryPickMainline }
            : {})
        }
      ],
      repair: { model: "gpt-5-codex", timeoutMs: 1_000 },
      integrationOperation: { journal, runId: "run-real-git" }
    });

    expect(parentIntegration.status).toBe("success");
    const finalSha = parentIntegration.integrationCommitSha!;
    expect(await runner.showFile({ cwd: parentWorktree.path, ref: finalSha, path: "a.txt" })).toBe("a\n");
    expect(await runner.showFile({ cwd: parentWorktree.path, ref: finalSha, path: "b.txt" })).toBe("b\n");

    for (const applied of childIntegration.appliedCommits ?? []) {
      expect(applied.resultSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(await runner.isAncestor({
        cwd: childWorktree.path,
        ancestor: applied.resultSha!,
        descendant: childIntegration.integrationCommitSha!
      })).toBe(true);
    }
    const handoffParents = (await git(
      childWorktree.path,
      "rev-list",
      "--parents",
      "-n",
      "1",
      childIntegration.integrationCommitSha!
    )).split(/\s+/u);
    expect(handoffParents).toHaveLength(3);
    expect(handoffParents[1]).toBe(fixture.base);

    const traceCount = traceStore.list().length;
    const recovered = await agent.integrate({
      compositeTaskId: "root",
      attemptId: PARENT_ATTEMPT_ID,
      worktree: parentWorktree,
      childResults: [
        {
          ...leafResult(
            "child-composite",
            fixture.base,
            childIntegration.integrationCommitSha!,
            ""
          ),
          diff: "",
          changedFiles: [],
          ...(childIntegration.cherryPickMainline !== undefined
            ? { cherryPickMainline: childIntegration.cherryPickMainline }
            : {})
        }
      ],
      repair: { model: "gpt-5-codex", timeoutMs: 1_000 },
      integrationOperation: { journal, runId: "run-real-git" }
    });
    expect(recovered.status).toBe("success");
    expect(recovered.integrationCommitSha).toBe(finalSha);
    expect(traceStore.list()).toHaveLength(traceCount);
  }, 90_000);

  it("treats a distinct child commit with an already-satisfied patch as redundant", async () => {
    const fixture = await createFixture();
    const equivalentLeafA = await createSiblingCommit(
      fixture,
      "leaf-a-equivalent",
      "a.txt",
      "a\n",
      "equivalent leaf a"
    );
    const runner = new SimpleGitRunner();
    const journal = new JsonIntegrationOperationJournal(path.join(fixture.root, "journals"));
    const agent = new IntegrationAgent({
      git: runner,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: fixture.repoRoot
    });
    const integrationWorktree = await addIntegrationWorktree(
      runner,
      fixture,
      "redundant-root",
      path.join(fixture.root, "redundant-integration")
    );

    const params = {
      compositeTaskId: "redundant-root",
      attemptId: "00000000-0000-4000-8000-000000000013",
      worktree: integrationWorktree,
      childResults: [
        leafResult("leaf-a", fixture.base, fixture.leafA, "a.txt"),
        leafResult("leaf-a-equivalent", fixture.base, equivalentLeafA, "a.txt")
      ],
      repair: { model: "gpt-5-codex", timeoutMs: 1_000 },
      integrationOperation: { journal, runId: "run-real-git" }
    };

    const result = await agent.integrate(params);

    expect(result.status).toBe("success");
    expect(result.appliedCommits?.map((entry) => entry.application)).toEqual([
      "cherry_picked",
      "already_satisfied"
    ]);
    expect(await runner.showFile({
      cwd: integrationWorktree.path,
      ref: result.integrationCommitSha!,
      path: "a.txt"
    })).toBe("a\n");
    expect(await runner.statusPorcelain(integrationWorktree.path)).toEqual([]);
    expect(await agent.integrate(params)).toEqual(result);
  });

  it("rejects and removes a commit created unexpectedly by the repair executor", async () => {
    const fixture = await createFixture();
    const first = await createSiblingCommit(fixture, "conflict-first", "base.txt", "first\n", "first");
    const second = await createSiblingCommit(fixture, "conflict-second", "base.txt", "second\n", "second");
    const runner = new SimpleGitRunner();
    const journal = new JsonIntegrationOperationJournal(path.join(fixture.root, "journals"));
    const committingExecutor = new CommittingRepairExecutor();
    const agent = new IntegrationAgent({
      git: runner,
      executor: committingExecutor,
      traceStore: new InMemoryTraceStore(),
      repoRoot: fixture.repoRoot
    });
    const integrationWorktree = await addIntegrationWorktree(
      runner,
      fixture,
      "d6-root",
      path.join(fixture.root, "d6-integration")
    );

    const result = await agent.integrate({
      compositeTaskId: "d6-root",
      attemptId: "00000000-0000-4000-8000-000000000014",
      worktree: integrationWorktree,
      childResults: [
        leafResult("first", fixture.base, first, "base.txt"),
        leafResult("second", fixture.base, second, "base.txt")
      ],
      repair: { model: "gpt-5-codex", timeoutMs: 10_000 },
      integrationOperation: { journal, runId: "run-real-git" }
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.repairResult).toMatchObject({
      status: "agent_committed_unexpectedly",
      agentCommittedUnexpectedly: true
    });
    expect(result.integrationCommitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(await runner.showFile({
      cwd: integrationWorktree.path,
      ref: result.integrationCommitSha!,
      path: "forbidden.txt"
    })).toBeNull();
    expect(await runner.showFile({
      cwd: integrationWorktree.path,
      ref: result.integrationCommitSha!,
      path: "base.txt"
    })).toBe("first\n");
    expect(await runner.statusPorcelain(integrationWorktree.path)).toEqual([]);
    expect(committingExecutor.commitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(await runner.isAncestor({
      cwd: integrationWorktree.path,
      ancestor: committingExecutor.commitSha!,
      descendant: result.integrationCommitSha!
    })).toBe(false);
  });
});

class CommittingRepairExecutor implements AgentExecutor {
  commitSha: string | undefined;

  async execute(options: AgentExecutorOptions) {
    await writeFile(path.join(options.cwd, "forbidden.txt"), "executor-owned\n", "utf8");
    await git(options.cwd, "add", "forbidden.txt");
    await git(options.cwd, "commit", "-m", "repair executor committed unexpectedly");
    this.commitSha = await git(options.cwd, "rev-parse", "HEAD");
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
  }
}

interface Fixture {
  root: string;
  repoRoot: string;
  base: string;
  leafA: string;
  leafB: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-real-integration-"));
  tempDirectories.push(root);
  const repoRoot = path.join(root, "repo");
  await mkdir(repoRoot, { recursive: true });
  await git(repoRoot, "init", "--initial-branch=main");
  await git(repoRoot, "config", "user.email", "manyhands-tests@example.invalid");
  await git(repoRoot, "config", "user.name", "ManyHands Tests");
  await git(repoRoot, "config", "commit.gpgsign", "false");
  await writeFile(path.join(repoRoot, "base.txt"), "base\n", "utf8");
  await git(repoRoot, "add", "base.txt");
  await git(repoRoot, "commit", "-m", "base");
  const base = await git(repoRoot, "rev-parse", "HEAD");

  await git(repoRoot, "switch", "--create", "leaf-a", base);
  await writeFile(path.join(repoRoot, "a.txt"), "a\n", "utf8");
  await git(repoRoot, "add", "a.txt");
  await git(repoRoot, "commit", "-m", "leaf a");
  const leafA = await git(repoRoot, "rev-parse", "HEAD");

  await git(repoRoot, "switch", "--create", "leaf-b", base);
  await writeFile(path.join(repoRoot, "b.txt"), "b\n", "utf8");
  await git(repoRoot, "add", "b.txt");
  await git(repoRoot, "commit", "-m", "leaf b");
  const leafB = await git(repoRoot, "rev-parse", "HEAD");
  await git(repoRoot, "switch", "main");

  return { root, repoRoot, base, leafA, leafB };
}

async function addIntegrationWorktree(
  runner: SimpleGitRunner,
  fixture: Fixture,
  taskId: string,
  worktreePath: string
): Promise<WorktreeRecord> {
  await runner.worktreeAdd({
    repoRoot: fixture.repoRoot,
    worktreePath,
    branch: `mh/run-real-git/${taskId}`,
    baseCommit: fixture.base
  });
  return {
    taskId,
    runId: "run-real-git",
    kind: "integration",
    path: worktreePath,
    branch: `mh/run-real-git/${taskId}`,
    baseCommit: fixture.base,
    status: "active",
    createdAt: "2026-07-15T00:00:00.000Z"
  };
}

async function createSiblingCommit(
  fixture: Fixture,
  branch: string,
  file: string,
  content: string,
  message: string
): Promise<string> {
  await git(fixture.repoRoot, "switch", "--create", branch, fixture.base);
  await writeFile(path.join(fixture.repoRoot, file), content, "utf8");
  await git(fixture.repoRoot, "add", file);
  await git(fixture.repoRoot, "commit", "-m", message);
  const sha = await git(fixture.repoRoot, "rev-parse", "HEAD");
  await git(fixture.repoRoot, "switch", "main");
  return sha;
}

function leafResult(
  taskId: string,
  baseHead: string,
  commitSha: string,
  changedFile: string
): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead,
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: changedFile.length > 0 ? `diff --git a/${changedFile} b/${changedFile}` : "",
    changedFiles: changedFile.length > 0 ? [changedFile] : [],
    commitSha,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 1,
    executorTimedOut: false
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
