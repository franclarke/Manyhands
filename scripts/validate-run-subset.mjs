import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  ExecutionConfigSchema,
  GeminiCliExecutor,
  RunExecutor,
  SimpleGitRunner
} from "../packages/execution-core/dist/index.js";
import { InMemoryTraceStore } from "../packages/trace-store/dist/index.js";

const execFileAsync = promisify(execFile);

const RUN_ID = "b7813334-933e-4001-bd94-fb1a3c165847";
const TASK_IDS = ["define-data-model", "scaffold-project-files"];
const PARENT_ID = "setup-project-and-core-types";

const repoRoot = process.cwd();
const runFile = path.join(repoRoot, ".manyhands", "runs", `${RUN_ID}.json`);
const targetRepo = "C:/Users/franc/Documents/Proyectos/Prueba";
const validationRoot = path.join(repoRoot, ".manyhands", "manual-validation", `${RUN_ID}-subset`);
const validationRepo = path.join(validationRoot, "repo");
const summaryFile = path.join(validationRoot, "summary.json");

async function main() {
  await recreateValidationRepo();

  const run = JSON.parse(await readFile(runFile, "utf8")).run;
  const originalGraph = run.planning.decomposition.graph;
  const baseCommit = await git(validationRepo, ["rev-parse", "HEAD"]);
  const baseBranch = await git(validationRepo, ["branch", "--show-current"]);
  const graph = buildSubsetGraph(originalGraph, { baseCommit, baseBranch });

  const traceStore = new InMemoryTraceStore();
  const executor = new RunExecutor({
    git: new SimpleGitRunner(),
    executor: new GeminiCliExecutor(),
    traceStore,
    repoRoot: validationRepo
  });

  const startedAt = new Date().toISOString();
  const result = await executor.run({
    graph,
    config: ExecutionConfigSchema.parse({
      maxParallel: 2,
      leafTimeoutMs: 180_000,
      integrationTimeoutMs: 60_000
    }),
    model: run.model,
    runId: `${RUN_ID}-subset`,
    policy: "parallel_naive"
  });
  const finishedAt = new Date().toISOString();

  const summary = {
    runId: RUN_ID,
    subsetRunId: `${RUN_ID}-subset`,
    targetRepo,
    validationRepo,
    taskIds: TASK_IDS,
    parentId: PARENT_ID,
    startedAt,
    finishedAt,
    result: {
      status: result.status,
      leafResults: result.leafResults.map((leaf) => ({
        taskId: leaf.taskId,
        status: leaf.status,
        changedFiles: leaf.changedFiles,
        commitSha: leaf.commitSha,
        scopePassed: leaf.scopeCheck.passed,
        scopeViolations: leaf.scopeCheck.violations,
        exitCode: leaf.executorExitCode,
        timedOut: leaf.executorTimedOut,
        durationMs: leaf.executorDurationMs,
        stderrTail: leaf.stderrTail,
        stdoutTail: leaf.stdoutTail
      })),
      integrationResults: result.integrationResults.map((entry) => ({
        compositeTaskId: entry.compositeTaskId,
        status: entry.status,
        integrationCommitSha: entry.integrationCommitSha,
        repairAttempted: entry.repairAttempted,
        conflictFiles: entry.conflictDetails?.files ?? []
      })),
      validationPassed: result.validationResult?.passed,
      totalDurationMs: result.totalDurationMs
    },
    traceEvents: traceStore.list().map((event) => ({
      type: event.type,
      taskId: event.taskId,
      actor: event.actor,
      payload: event.payload
    }))
  };

  await mkdir(validationRoot, { recursive: true });
  await writeFile(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

function buildSubsetGraph(originalGraph, refs) {
  const root = cloneNode(originalGraph.nodes.root);
  const parent = cloneNode(originalGraph.nodes[PARENT_ID]);
  const leaves = Object.fromEntries(TASK_IDS.map((taskId) => [taskId, cloneNode(originalGraph.nodes[taskId])]));

  root.childrenIds = [PARENT_ID];
  root.status = "planned";
  parent.parentId = root.id;
  parent.childrenIds = TASK_IDS;
  parent.status = "planned";

  for (const leaf of Object.values(leaves)) {
    leaf.parentId = PARENT_ID;
    leaf.childrenIds = [];
    leaf.dependencies = [];
    leaf.status = "planned";
  }

  return {
    ...originalGraph,
    id: `${originalGraph.id}:subset`,
    planId: `${originalGraph.planId}:subset`,
    repo: validationRepo,
    baseBranch: refs.baseBranch,
    baseCommit: refs.baseCommit,
    rootId: root.id,
    nodes: {
      [root.id]: root,
      [PARENT_ID]: parent,
      ...leaves
    },
    dependencies: [],
    createdAt: new Date().toISOString()
  };
}

async function recreateValidationRepo() {
  await assertInsideWorkspace(validationRoot);
  await rm(validationRoot, { recursive: true, force: true });
  await mkdir(validationRoot, { recursive: true });
  await execFileAsync("git", ["clone", "--quiet", "--no-local", targetRepo, validationRepo]);
  await git(validationRepo, ["config", "user.email", "manyhands@local"]);
  await git(validationRepo, ["config", "user.name", "ManyHands Validation"]);
  await git(validationRepo, ["config", "commit.gpgsign", "false"]);
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

async function assertInsideWorkspace(candidate) {
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(repoRoot + path.sep)) {
    throw new Error(`Refusing to touch path outside workspace: ${resolved}`);
  }
}

function cloneNode(value) {
  return JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
