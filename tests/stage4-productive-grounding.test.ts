import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type { ProductRunDefinition } from "@manyhands/run-coordinator";
import { stage5Fixture } from "./helpers/stage5-fixture.js";

import {
  buildProductiveRepositoryGrounding,
  createCurrentPlannerPort
} from "../apps/daemon/src/current-lifecycle-adapters.js";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Stage 4 productive repository grounding", () => {
  it("grounds the transitional planner through bounded RepositoryQuery answers with exact provenance", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({
        name: "visual-todo",
        scripts: { test: "vitest run", build: "vite build" }
      }),
      "src/todo-board.ts": "export const todoBoard = ['todo'];\n",
      "src/theme.ts": "export const accent = '#ff00aa';\n",
      "tests/todo-board.test.ts": "import { todoBoard } from '../src/todo-board.js';\nvoid todoBoard;\n"
    });
    const baseCommit = await commitAll(root, "initial");

    const first = await buildProductiveRepositoryGrounding({
      rootPath: root,
      targetFingerprint: "target:visual-todo",
      baseCommit,
      goal: "Build a visual todo board",
      acceptanceCriteria: ["The todo board has an automated test"]
    });
    const second = await buildProductiveRepositoryGrounding({
      rootPath: root,
      targetFingerprint: "target:visual-todo",
      baseCommit,
      goal: "Build a visual todo board",
      acceptanceCriteria: ["The todo board has an automated test"]
    });

    expect(first.view.digest).toBe(second.view.digest);
    expect(first.queryDigests).toEqual(second.queryDigests);
    expect(first.evidence).toEqual(second.evidence);
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.evidence.length).toBeLessThanOrEqual(first.budget.maxResults * 3);
    expect(first.evidence.some((item) => item.kind === "path" && item.reference === "src/todo-board.ts"))
      .toBe(true);
    expect(first.evidence.some((item) => item.kind === "script" && item.reference === "test"))
      .toBe(true);
    expect(first.evidence.some((item) => item.confidence < 1)).toBe(true);
    const modelEvidence = new Set(first.view.model.evidence.map((item) => item.id));
    expect(first.evidence.every((item) => modelEvidence.has(item.id))).toBe(true);

    const productiveSource = await readFile(
      path.resolve("apps/daemon/src/current-lifecycle-adapters.ts"),
      "utf8"
    );
    expect(productiveSource).not.toContain("snapshot.index?.files");
    expect(productiveSource).not.toContain("buildFastRepositorySnapshot");
    expect(productiveSource).toContain("buildProductiveRepositoryGrounding");
  });

  it("carries bounded query evidence through the productive planner port and its journal inputs", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "visual-todo", scripts: { test: "vitest run" } }),
      "src/todo-board.ts": "export const todoBoard = ['todo'];\n",
      "src/theme.ts": "export const accent = '#ff00aa';\n"
    });
    const baseCommit = await commitAll(root, "initial");
    let prompt = "";
    const planner = createCurrentPlannerPort({
      spawnProcess: fakePlanningSpawn(() => canonicalResponse(prompt), (value) => { prompt = value; })
    });

    const result = await planner.plan({
      runId: "run:stage4-productive",
      definition: definition(root, baseCommit),
      events: []
    });
    const inspected = result.events.find((event) => event.type === "repository.inspected");
    expect(inspected?.payload).toMatchObject({
      repositoryModelDigest: expect.stringMatching(/^sha256:/u),
      repositoryView: {
        digest: expect.stringMatching(/^sha256:/u),
        resourceCatalogDigest: expect.stringMatching(/^sha256:/u)
      },
      queryDigests: expect.arrayContaining([expect.stringMatching(/^sha256:/u)])
    });
    expect(prompt).toContain("src/todo-board.ts");
    expect(prompt).toContain("vitest run");
    expect(result.events.find((event) => event.type === "planning.completed")?.payload.semanticPlan)
      .toMatchObject({ status: "ready", rootUnitId: "unit:root" });
    expect(result.events.find((event) => event.type === "graph.compiled")?.payload.graph)
      .toMatchObject({ semanticPlan: expect.objectContaining({ id: expect.stringMatching(/^plan:/u) }) });
    expect(result.events.find((event) => event.type === "graph.compiled")?.payload.evidenceAuthority)
      .toMatchObject({ goal: expect.objectContaining({ digest: expect.stringMatching(/^sha256:/u) }) });
  });

  it("keeps productive planner index caches in daemon state and reuses the target namespace", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "clean-target", scripts: { test: "vitest run" } }),
      "src/index.ts": "export const ready = true;\n"
    });
    const baseCommit = await commitAll(root, "initial");
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "manyhands-planner-state-"));
    tempRoots.push(stateRoot);
    let prompt = "";
    const planner = createCurrentPlannerPort({
      stateRoot,
      spawnProcess: fakePlanningSpawn(() => canonicalResponse(prompt), (value) => { prompt = value; })
    });
    const cacheRoot = path.join(
      stateRoot,
      "repository-index-cache",
      createHash("sha256").update("target:visual-todo").digest("hex")
    );
    const cachePath = path.join(cacheRoot, `index-${baseCommit}.json`);

    await planner.plan({
      runId: "run:external-cache-first",
      definition: definition(root, baseCommit),
      events: []
    });

    expect(await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
    const firstCache = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, unknown>;
    const firstModifiedAt = (await stat(cachePath, { bigint: true })).mtimeNs;
    expect(firstCache).toMatchObject({
      rootPath: path.resolve(root),
      repositoryId: path.basename(root),
      baseCommit
    });

    await planner.plan({
      runId: "run:external-cache-second",
      definition: definition(root, baseCommit),
      events: []
    });

    expect((await stat(cachePath, { bigint: true })).mtimeNs).toBe(firstModifiedAt);
    expect(await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
  });

  it("terminates the planning CLI process when the planning signal is aborted", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "cancel-planning", scripts: { test: "node --test" } }),
      "src/index.js": "export const ready = true;\n"
    });
    const baseCommit = await commitAll(root, "initial");
    const controller = new AbortController();
    let notifySpawned: (() => void) | undefined;
    const spawned = new Promise<void>((resolve) => { notifySpawned = resolve; });
    let childExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    const planner = createCurrentPlannerPort({
      planningStepTimeoutMs: 10_000,
      spawnProcess: ((_command: string, _args: readonly string[]) => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
          cwd: root,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32"
        });
        childExit = new Promise((resolve) => {
          child.once("exit", (code, signal) => resolve({ code, signal }));
        });
        notifySpawned?.();
        return child;
      }) as typeof spawn
    });

    const pending = planner.plan({
      runId: "run:stage4:cancel-planning",
      definition: definition(root, baseCommit),
      events: [],
      signal: controller.signal
    });
    await spawned;
    controller.abort("operation.cancel_requested is durable");

    await expect(pending).rejects.toThrow(/planning was cancelled/u);
    expect(await childExit).toMatchObject({ code: expect.anything() });
  });
});

function canonicalResponse(prompt: string): string {
  const criteria = [...prompt.matchAll(/^(criterion:[^:]+:[^:]+:\d+):/gmu)].map((match) => match[1]!);
  const resources = [...prompt.matchAll(/^(catalog-resource:[^\s]+) path:([^\r\n]+)$/gmu)];
  const evidence = [...prompt.matchAll(/^(evidence:[^\r\n]+)$/gmu)].map((match) => match[1]!);
  if (criteria.length !== 1 || resources.length < 2 || evidence.length === 0) {
    throw new Error(`Test prompt did not contain the canonical planning context: ${prompt}`);
  }
  const [firstResource, secondResource] = resources;
  if (firstResource === undefined || secondResource === undefined) {
    throw new Error("Test prompt did not contain two catalog resources.");
  }
  const firstResourceId = firstResource[1]!;
  const secondResourceId = secondResource[1]!;
  const firstResourcePath = firstResource[2]!;
  const secondResourcePath = secondResource[2]!;
  const material = structuredClone(stage5Fixture().plan) as unknown as Record<string, unknown>;
  delete material.digest;
  const rendered = JSON.stringify(material)
    .replaceAll("criterion:feature", criteria[0]!)
    .replaceAll("proof:feature", `proof:${criteria[0]!}`)
    .replaceAll("proof:a", `proof:${criteria[0]!}`)
    .replaceAll("proof:b", `proof:${criteria[0]!}`)
    .replaceAll("resource:a", firstResourceId)
    .replaceAll("resource:b", secondResourceId)
    .replaceAll("src/a.ts", firstResourcePath)
    .replaceAll("src/b.ts", secondResourcePath)
    .replace(/evidence:[^"\]]+/gu, evidence[0]!);
  return rendered;
}

function definition(root: string, baseCommit: string): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage4",
    userPrompt: "Build a visual todo board",
    acceptanceCriteria: ["The todo board has an automated test"],
    title: "Visual todo board",
    planningSelection: { executorId: "codex-cli", model: "deterministic-test" },
    executionSelection: { executorId: "codex-cli", model: "deterministic-test" },
    repairSelection: { executorId: "codex-cli", model: "deterministic-test" },
    executionConfig: { maxPlanningAttempts: 1 },
    targetContext: {
      fingerprint: "target:visual-todo",
      sourceBaseCommit: baseCommit,
      sourceBranch: "main",
      sourceRealPath: root
    }
  };
}

function fakePlanningSpawn(
  response: () => string,
  onPrompt: (prompt: string) => void
): typeof spawn {
  return (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    let input = "";
    child.stdin.on("data", (chunk) => { input += String(chunk); });
    child.stdin.on("finish", () => { onPrompt(input); });
    setTimeout(() => {
      child.stdout.write(response());
      child.emit("close", 0);
    }, 0);
    return child as unknown as ChildProcess;
  }) as typeof spawn;
}

async function createRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-productive-grounding-"));
  tempRoots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@manyhands.local"]);
  await git(root, ["config", "user.name", "ManyHands Tests"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return stdout.trim();
}
