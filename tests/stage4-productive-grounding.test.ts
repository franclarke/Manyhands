import { execFile } from "node:child_process";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type { ProductRunDefinition } from "@manyhands/run-coordinator";

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
      spawnProcess: fakePlanningSpawn(() => {
        return JSON.stringify({
          rationale: "The board behavior and visual theme are separately verifiable.",
          children: [
            {
              key: "todo-board",
              objective: "Implement the todo board behavior",
              criterion: "The board shows todo items",
              reads: ["src/todo-board.ts"],
              writes: ["tests/todo-board.test.ts"]
            },
            {
              key: "visual-theme",
              objective: "Apply the visual theme",
              criterion: "The board uses a visible accent",
              reads: ["src/theme.ts"],
              writes: ["tests/theme.test.ts"]
            }
          ]
        });
      }, (value) => { prompt = value; })
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
  });
});

function definition(root: string, baseCommit: string): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage4",
    userPrompt: "Build a visual todo board",
    acceptanceCriteria: ["The board shows todo items", "The board uses a visible accent"],
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
