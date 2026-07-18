import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve("apps/web/src");
const TEXT_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const MOJIBAKE_MARKERS = ["Ã", "Â", "â", "�"];

describe("web UI copy encoding", () => {
  it("contains no common UTF-8 mojibake sequences", async () => {
    const offenders: string[] = [];
    for (const filePath of await sourceFiles(SOURCE_ROOT)) {
      const contents = await readFile(filePath, "utf8");
      if (MOJIBAKE_MARKERS.some((marker) => contents.includes(marker))) {
        offenders.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [filePath] : [];
  }));
  return nested.flat();
}
