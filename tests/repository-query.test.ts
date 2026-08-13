import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  composeRepositoryView,
  createRepositoryQuery,
  inspectRepositoryModelWithSnapshot
} from "@manyhands/repository-index";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RepositoryQuery", () => {
  it("returns deterministic, provenance-complete answers under an explicit budget", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({
        name: "weather-board",
        scripts: { test: "vitest run", typecheck: "tsc --noEmit" }
      }),
      "src/weather.ts": "export function loadWeather(city: string) { return city; }\n",
      "src/dashboard.ts": "import { loadWeather } from './weather.js';\nexport const dashboard = loadWeather('Rosario');\n",
      "tests/weather.test.ts": "import { loadWeather } from '../src/weather.js';\nvoid loadWeather('Cordoba');\n"
    });
    const baseCommit = await commitAll(root, "initial");
    const inspection = await inspectRepositoryModelWithSnapshot({
      rootPath: root,
      repositoryId: "weather-board",
      targetFingerprint: "target:weather-board",
      baseCommit
    });
    const view = await composeRepositoryView({ rootPath: root, inspection, overlays: [] });
    const query = createRepositoryQuery({ rootPath: root, view });
    const budget = { maxResults: 10, maxBytes: 4096, maxDepth: 2 };

    const first = query.searchGoalTerms(["weather", "dashboard"], budget);
    const second = query.searchGoalTerms(["weather", "dashboard"], budget);
    expect(first).toEqual(second);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.items.map((item) => item.locator)).toContain("module:src/weather.ts");
    expect(first.epistemic.state).toBe("known");

    const dependencies = query.dependencyNeighborhood("module:src/dashboard.ts", budget);
    expect(dependencies.items.map((item) => item.locator)).toContain("module:src/weather.ts");
    const relatedTests = query.relatedTests("module:src/weather.ts", budget);
    expect(relatedTests.items.map((item) => item.locator)).toContain("path:tests/weather.test.ts");
    const validation = query.validationCapabilities(budget);
    expect(validation.items.map((item) => item.name)).toEqual(["test", "typecheck"]);

    const evidenceIds = new Set(view.model.evidence.map((item) => item.id));
    for (const answer of [first, dependencies, relatedTests, validation]) {
      expect(answer.evidenceRefs.length).toBeGreaterThan(0);
      expect(answer.evidenceRefs.every((evidenceRef) => evidenceIds.has(evidenceRef))).toBe(true);
      expect(answer.cost.results).toBeLessThanOrEqual(answer.budget.maxResults);
      expect(answer.cost.bytes).toBeLessThanOrEqual(answer.budget.maxBytes);
    }
  });

  it("truncates honestly and reads only exact-view blobs", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "budgeted-query" }),
      "src/alpha.ts": "export const alpha = 'one';\nexport const alphabet = 'two';\n",
      "src/beta.ts": "export const beta = 'three';\n"
    });
    const baseCommit = await commitAll(root, "initial");
    const inspection = await inspectRepositoryModelWithSnapshot({
      rootPath: root,
      targetFingerprint: "target:budgeted-query",
      baseCommit
    });
    const view = await composeRepositoryView({ rootPath: root, inspection, overlays: [] });
    const query = createRepositoryQuery({ rootPath: root, view });
    const tiny = { maxResults: 1, maxBytes: 512, maxDepth: 0 };

    const search = query.searchGoalTerms(["alpha"], tiny);
    expect(search.items).toHaveLength(1);
    expect(search.truncated).toBe(true);
    expect(search.epistemic.state).toBe("partial");

    await writeFile(path.join(root, "src/alpha.ts"), "DIRTY WORKTREE CONTENT\n", "utf8");
    const excerpt = await query.readExcerpts(["path:src/alpha.ts"], {
      maxResults: 1,
      maxBytes: 4096,
      maxDepth: 0
    });
    expect(excerpt.items[0]?.text).toContain("export const alpha");
    expect(excerpt.items[0]?.text).not.toContain("DIRTY WORKTREE");
    expect(() => query.searchGoalTerms(["alpha"], { maxResults: 0, maxBytes: 1, maxDepth: 0 }))
      .toThrow(/maxResults/u);
  });
});

async function createRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-repository-query-"));
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
