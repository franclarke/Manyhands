/**
 * Artifact hygiene against a REAL git repo — the postmortem regression where a
 * leaf ran `npm install` in a repo without .gitignore and the orchestrator
 * committed 4355 files of node_modules.
 *
 * Two layers under test:
 *  1. SimpleGitRunner.addAllExcluding — artifact globs never enter the index.
 *  2. ensureGitInfoExclude — provisioning writes .git/info/exclude idempotently.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ARTIFACT_GLOBS, SimpleGitRunner, safeGitArgs } from "@manyhands/execution-core";
import { ensureGitInfoExclude } from "@/lib/server/runs/repo-provisioner";

const execFileAsync = promisify(execFile);

let repoRoot: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout.trim();
}

async function write(relative: string, content = "x"): Promise<void> {
  const absolute = path.join(repoRoot, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-hygiene-"));
  await git("init", "-b", "main");
  await git("config", "user.email", "test@local");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  await write("README.md", "base");
  await git("add", "-A");
  await git("commit", "-m", "init");
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("SimpleGitRunner.addAllExcluding", () => {
  it("stages source changes but never node_modules (top-level or nested) nor dist", async () => {
    await write("src/x.ts", "export const x = 1;");
    await write("node_modules/a/index.js");
    await write("packages/p/node_modules/b/index.js");
    await write("dist/bundle.js");
    await write("app.log");

    const runner = new SimpleGitRunner();
    await runner.addAllExcluding(repoRoot, DEFAULT_ARTIFACT_GLOBS);

    const staged = await runner.diffCachedNameOnly(repoRoot);
    expect(staged).toEqual(["src/x.ts"]);
  });

  it("also covers a repo WITH .gitignore where the agent generates new artifact dirs", async () => {
    await write(".gitignore", "*.tmp\n"); // user ignores something else entirely
    await write("src/y.ts", "export const y = 2;");
    await write("coverage/lcov.info");
    await write(".next/build-manifest.json");

    const runner = new SimpleGitRunner();
    await runner.addAllExcluding(repoRoot, DEFAULT_ARTIFACT_GLOBS);

    const staged = (await runner.diffCachedNameOnly(repoRoot)).sort();
    expect(staged).toEqual([".gitignore", "src/y.ts"]);
  });
});

describe("safeGitArgs", () => {
  it("scopes the ownership exception to the selected repository", () => {
    const args = safeGitArgs("C:/Users/owner/project", ["status", "--porcelain"]);
    expect(args.slice(0, 2)).toEqual(["-c", expect.stringMatching(/^safe\.directory=/)]);
    expect(args.slice(2)).toEqual(["status", "--porcelain"]);
    expect(args[1]).toContain("project");
  });
});

describe("ensureGitInfoExclude", () => {
  it("appends the default block once and is idempotent across provisions", async () => {
    await ensureGitInfoExclude(repoRoot);
    await ensureGitInfoExclude(repoRoot);

    const exclude = await readFile(path.join(repoRoot, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("node_modules/");
    expect(exclude.match(/# --- manyhands defaults ---/g)).toHaveLength(1);
    expect(exclude.match(/^node_modules\/$/gm)).toHaveLength(1);
  });

  it("preserves pre-existing user content in info/exclude", async () => {
    const excludePath = path.join(repoRoot, ".git", "info", "exclude");
    await writeFile(excludePath, "my-secret-dir/\n", "utf8");

    await ensureGitInfoExclude(repoRoot);

    const exclude = await readFile(excludePath, "utf8");
    expect(exclude).toContain("my-secret-dir/");
    expect(exclude).toContain("node_modules/");
  });

  it("makes plain `git add -A` skip node_modules after provisioning (worktree-shared exclude)", async () => {
    await ensureGitInfoExclude(repoRoot);
    await write("node_modules/c/index.js");
    await write("src/z.ts");

    await git("add", "-A");
    const staged = await git("diff", "--cached", "--name-only");
    expect(staged.split("\n").filter(Boolean)).toEqual(["src/z.ts"]);
  });
});
