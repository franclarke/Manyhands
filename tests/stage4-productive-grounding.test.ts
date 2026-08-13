import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { buildProductiveRepositoryGrounding } from "../apps/daemon/src/current-lifecycle-adapters.js";

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
});

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
