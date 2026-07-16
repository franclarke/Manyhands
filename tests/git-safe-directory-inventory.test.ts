import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("product Git subprocess inventory", () => {
  it("routes every literal git subprocess through repo-scoped safeGitArgs", async () => {
    const roots = [
      path.join(process.cwd(), "apps", "web", "src", "lib", "server"),
      path.join(process.cwd(), "packages", "execution-core", "src")
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of await sourceFiles(root)) {
        const source = stripComments(await readFile(file, "utf8"));
        const literalExec = source.match(/execFile(?:Async)?\(\s*["']git["']/gu) ?? [];
        const scopedExec = source.match(
          /execFile(?:Async)?\(\s*["']git["']\s*,\s*safeGitArgs\s*\(/gu
        ) ?? [];
        const unsafeSpawn = /spawn\(\s*["']git["']/gu;
        if (literalExec.length !== scopedExec.length || unsafeSpawn.test(source)) {
          violations.push(path.relative(process.cwd(), file).replaceAll("\\", "/"));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
  }));
  return nested.flat();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}
