import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexCliExecutor,
  ExecutionConfigSchema,
  RunExecutor,
  SimpleGitRunner
} from "@manyhands/execution-core";
import {
  createFixtureRepoProvisioner,
  type ProvisionedRepo
} from "@/lib/server/runs/repo-provisioner";

/**
 * Opt-in smoke test: proves ManyHands runs OUTSIDE the mock — real `codex exec`
 * against a real provisioned repo. Gated by MANYHANDS_E2E_CODEX=1 so the normal
 * suite never depends on the Codex binary or network. Asserts diff + commit
 * only (no npm install / npm test — that is Etapa 2A.2).
 */
const E2E = process.env.MANYHANDS_E2E_CODEX === "1";
const execFileAsync = promisify(execFile);

const RUN_ID = "run-real-smoke";
const REPO_ROOT = path.resolve(__dirname, "..");

let workRoot: string;
let provisioned: ProvisionedRepo;

function graph(): TaskGraph {
  return {
    id: "graph-real",
    planId: RUN_ID,
    repo: provisioned.repoRoot,
    baseBranch: provisioned.baseBranch,
    baseCommit: provisioned.baseCommit,
    featureRequest: "Complete the task-manager REST API.",
    rootId: "root",
    createdAt: "2026-05-29T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate the CRUD completion.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["impl-crud"],
        dependencies: []
      },
      "impl-crud": {
        id: "impl-crud",
        parentId: "root",
        kind: "leaf",
        title: "Implement PUT and DELETE",
        goal:
          "In src/routes/tasks.ts, implement PUT /tasks/:id (update an existing task) " +
          "and DELETE /tasks/:id (remove a task), replacing the 404 stubs.",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: [
          "PUT /tasks/:id updates a task and returns it",
          "DELETE /tasks/:id removes a task and returns 204"
        ]
      }
    }
  };
}

beforeEach(async () => {
  if (!E2E) return;
  workRoot = await mkdtemp(path.join(os.tmpdir(), "mh-real-"));
  const provisioner = createFixtureRepoProvisioner({
    benchmarksRoot: path.join(REPO_ROOT, "benchmarks"),
    workRoot
  });
  provisioned = await provisioner.provision({
    spec: { kind: "fixture", fixtureId: "task-manager-api" },
    runId: RUN_ID
  });
});

afterEach(async () => {
  if (!E2E) return;
  await rm(workRoot, { recursive: true, force: true });
});

describe.skipIf(!E2E)("RunExecutor real run (opt-in, real codex exec)", () => {
  it("provisions task-manager-api with a real base commit", () => {
    expect(provisioned.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(path.join(provisioned.repoRoot, "src", "routes", "tasks.ts"))).toBe(true);
  });

  it("runs a real leaf, produces a non-empty diff, and commits it", async () => {
    await execFileAsync("codex", ["--version"]); // fail fast if the binary is missing

    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git: new SimpleGitRunner(),
      codex: new CodexCliExecutor(),
      traceStore,
      repoRoot: provisioned.repoRoot
    });

    const result = await executor.run({
      graph: graph(),
      config: ExecutionConfigSchema.parse({}),
      model: "gpt-5-codex",
      runId: RUN_ID
    });

    const leaf = result.leafResults.find((entry) => entry.taskId === "impl-crud");
    expect(leaf).toBeDefined();
    // Real execution: Codex changed files and the orchestrator committed them (D5/D6).
    expect(leaf?.diff.length ?? 0).toBeGreaterThan(0);
    expect(leaf?.commitSha).toBeDefined();
    expect(leaf?.scopeCheck.passed).toBe(true);

    expect(traceStore.findByType("worktree_created").length).toBeGreaterThan(0);
    expect(traceStore.findByType("agent_committed").length).toBeGreaterThan(0);
    expect(traceStore.findByType("run_completed")).toHaveLength(1);
  }, 300_000);
});
