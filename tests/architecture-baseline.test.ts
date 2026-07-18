import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunRecordSchema } from "@/lib/server/runs/schema";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
describe("target architecture migration baseline", () => {
  it("keeps V1 records out of the canonical V2 cache schema", async () => {
    const fixture = JSON.parse(
      await readFile(path.join(REPO_ROOT, "tests", "fixtures", "current-run-record-v1.json"), "utf8")
    ) as unknown;
    expect(RunRecordSchema.safeParse(fixture).success).toBe(false);
  });

  it("keeps packages independent from application-layer imports", async () => {
    const packageSources = await sourceFiles(path.join(REPO_ROOT, "packages"));
    const violations: string[] = [];

    for (const file of packageSources) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'](?:@\/|apps\/|[^"']*\/apps\/)/u.test(source)) {
        violations.push(relativePath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids productive @manyhands/core consumers", async () => {
    const productSources = [
      ...(await sourceFiles(path.join(REPO_ROOT, "apps", "web", "src"))),
      ...(await sourceFiles(path.join(REPO_ROOT, "packages")))
    ];
    const consumers: string[] = [];

    for (const file of productSources) {
      if ((await readFile(file, "utf8")).includes("@manyhands/core")) {
        consumers.push(relativePath(file));
      }
    }

    expect(consumers).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dist" && entry.name !== "node_modules") {
        result.push(...(await sourceFiles(entryPath)));
      }
    } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      result.push(entryPath);
    }
  }
  return result;
}

function relativePath(file: string): string {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}
