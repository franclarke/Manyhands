import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve("packages/run-coordinator");

describe("run-coordinator package boundary", () => {
  it("depends only on domain-safe shared and schema packages", async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["@manyhands/contracts", "@manyhands/shared", "@manyhands/task-graph", "zod"]);
  });

  it("does not import frameworks, infrastructure, Git, filesystem or execution-core", async () => {
    const files = await sourceFiles(path.join(packageRoot, "src"));
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    for (const forbidden of [
      "@langchain/langgraph", "react", "next/", "node:fs", "node:path", "simple-git",
      "@manyhands/execution-core", "@manyhands/orchestrator-graph", "@manyhands/run-store"
    ]) expect(source).not.toContain(forbidden);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : Promise.resolve(entry.name.endsWith(".ts") ? [target] : []);
  }))).flat();
}
