import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GeminiCliExecutor,
  ExecutionConfigSchema,
  RunExecutor,
  SimpleGitRunner
} from "@manyhands/execution-core";
import {
  createFixtureRepoProvisioner,
  type ProvisionedRepo
} from "@/lib/server/runs/repo-provisioner";
import { rmWithRetry } from "@/lib/server/runs/fs-retry";

/**
 * Opt-in smoke test: proves ManyHands runs OUTSIDE the mock â€” real `codex exec`
 * against a real provisioned repo. Gated by MANYHANDS_E2E_GEMINI=1 so the normal
 * suite never depends on the Codex binary or network. Asserts diff + commit
 * only (no npm install / npm test â€” that is Etapa 2A.2).
 */
const E2E = process.env.MANYHANDS_E2E_GEMINI === "1";
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
        title: "Implement updateTask and deleteTask in the model",
        goal:
          "In src/models/task.ts, implement the `updateTask(id, input)` function " +
          "(find the task by id, apply the UpdateTaskInput fields, update `updatedAt`, " +
          "persist, and return the updated task; return undefined if not found) and the " +
          "`deleteTask(id)` function (remove the task from the Map and return true; " +
          "return false if not found). Both currently return stubs and cause PUT/DELETE " +
          "HTTP routes to always respond with 404.",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: [
          "updateTask(id, input) finds the task, merges UpdateTaskInput fields, refreshes updatedAt, and returns the updated task",
          "updateTask(id, input) returns undefined when the task id does not exist",
          "deleteTask(id) removes the task from the store and returns true",
          "deleteTask(id) returns false when the task id does not exist"
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
  await rmWithRetry(workRoot);
});

describe.skipIf(!E2E)("RunExecutor real run (opt-in, real codex exec)", () => {
  it("provisions task-manager-api with a real base commit", () => {
    expect(provisioned.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(path.join(provisioned.repoRoot, "src", "routes", "tasks.ts"))).toBe(true);
  });

  it("runs a real leaf, produces a non-empty diff, and commits it", async () => {
    // Resolve the codex binary the same way GeminiCliExecutor does. On Windows
    // the npm shim is `codex.cmd`, which execFile only finds through a shell.
    const codexBin = process.env.MANYHANDS_CODEX_BIN ?? "codex";
    await execFileAsync(codexBin, ["--version"], {
      shell: process.platform === "win32"
    }); // fail fast if the binary is missing

    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git: new SimpleGitRunner(),
      executor: new GeminiCliExecutor(),
      traceStore,
      repoRoot: provisioned.repoRoot
    });

    const result = await executor.run({
      graph: graph(),
      config: ExecutionConfigSchema.parse({}),
      // ChatGPT-account auth (no API key) rejects gpt-5-codex; use the account's
      // supported model. Overridable so other auth modes can pick another.
      model: process.env.MANYHANDS_CODEX_MODEL ?? "gpt-5.5",
      runId: RUN_ID
    });

    const leaf = result.leafResults.find((entry) => entry.taskId === "impl-crud");
    expect(leaf).toBeDefined();

    // Diagnostic: surface status/exit code on failure so we can pinpoint the
    // root cause without a second round-trip (diff empty vs. executor_error vs.
    // scope_violation are very different failure modes).
    if (!leaf || leaf.diff.length === 0 || !leaf.commitSha) {
      console.error("[smoke] leaf status:", leaf?.status);
      console.error("[smoke] codex exit:", leaf?.executorExitCode, "timedOut:", leaf?.executorTimedOut);
      console.error("[smoke] scope:", JSON.stringify(leaf?.scopeCheck));
      console.error("[smoke] diff (first 500):", leaf?.diff.slice(0, 500));
      console.error("[smoke] run status:", result.status);
    }

    // Real execution: Codex changed files and the orchestrator committed them (D5/D6).
    expect(leaf?.diff.length ?? 0).toBeGreaterThan(0);
    expect(leaf?.commitSha).toBeDefined();
    expect(leaf?.scopeCheck.passed).toBe(true);

    expect(traceStore.findByType("worktree_created").length).toBeGreaterThan(0);
    expect(traceStore.findByType("agent_committed").length).toBeGreaterThan(0);
    expect(traceStore.findByType("run_completed")).toHaveLength(1);
    // Test budget sits above the leaf timeout (D10 = 300s) so a leaf-level
    // timeout is handled by the pipeline instead of colliding with vitest's.
    // With MANYHANDS_CODEX_REASONING=low a real leaf finishes in ~60â€“90s.
  }, 600_000);
});
