import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepositoryIndex } from "@manyhands/repository-index";
import {
  effectivePlanningBudget,
  planningBudgetFingerprint
} from "@/lib/server/runs/effective-planning-budget";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("B-029 planning budget", () => {
  it("normalizes a complete, versioned budget and fingerprints its limiting policy", () => {
    const budget = effectivePlanningBudget({ maxIndexedFiles: 2, maxPlanningNodes: 7 });

    expect(budget).toMatchObject({ version: 1, maxIndexedFiles: 2, maxPlanningNodes: 7 });
    expect(budget.maxIndexBytes).toBeGreaterThan(0);
    expect(planningBudgetFingerprint(budget)).not.toBe(planningBudgetFingerprint({ ...budget, maxIndexedFiles: 3 }));
  });

  it("honors gitignore, rejects symlink escapes, and records deterministic omissions when indexing hits a budget", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-planning-budget-"));
    await writeFile(path.join(tempDir, ".gitignore"), "ignored.ts\n");
    await writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(tempDir, "ignored.ts"), "export const ignored = 1;\n");
    await mkdir(path.join(tempDir, "nested"));
    await writeFile(path.join(tempDir, "nested", "b.ts"), "export const b = 1;\n");
    const outside = path.join(tempDir, "..", `outside-${path.basename(tempDir)}.ts`);
    await writeFile(outside, "export const outside = true;\n");
    await symlink(outside, path.join(tempDir, "escape.ts"));

    const index = await buildRepositoryIndex({
      rootPath: tempDir,
      limits: { maxFiles: 1, maxBytes: 1_000, maxFileBytes: 1_000, maxSymbols: 20, maxImports: 20, maxExports: 20 }
    });

    expect(index.files).toHaveLength(1);
    expect(index.files.map((file) => file.path)).not.toContain("ignored.ts");
    expect(index.files.map((file) => file.path)).not.toContain("escape.ts");
    expect(index.diagnostics.map((diagnostic) => diagnostic.message)).toContain("repository index file budget reached");
    await rm(outside, { force: true });
  });
});
