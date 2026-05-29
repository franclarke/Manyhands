import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemContextPacker } from "@manyhands/execution-core";

let worktree: string;

beforeEach(async () => {
  worktree = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-"));
});

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true });
});

async function seed(rel: string, content: string): Promise<void> {
  const abs = path.join(worktree, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

describe("FileSystemContextPacker", () => {
  it("includes the current contents of existing target files", async () => {
    await seed("src/routes/tasks.ts", "export const stub = 404;\n");
    const packer = new FileSystemContextPacker();

    const result = await packer.pack({ worktreePath: worktree, files: ["src/routes/tasks.ts"] });

    expect(result.section).toContain("src/routes/tasks.ts");
    expect(result.section).toContain("export const stub = 404;");
    expect(result.includedFiles).toEqual(["src/routes/tasks.ts"]);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it("notes a file that does not exist yet without throwing", async () => {
    const packer = new FileSystemContextPacker();
    const result = await packer.pack({ worktreePath: worktree, files: ["src/new.ts"] });
    expect(result.section).toContain("does not exist yet");
    expect(result.includedFiles).toEqual([]);
  });

  it("returns an empty section for no files (no disk access)", async () => {
    const packer = new FileSystemContextPacker({
      readFile: async () => {
        throw new Error("should not read");
      }
    });
    const result = await packer.pack({ worktreePath: worktree, files: [] });
    expect(result.section).toBe("");
  });

  it("truncates content beyond the per-file byte cap", async () => {
    await seed("src/big.ts", "x".repeat(5_000));
    const packer = new FileSystemContextPacker({ maxBytesPerFile: 100 });
    const result = await packer.pack({ worktreePath: worktree, files: ["src/big.ts"] });
    expect(result.section).toContain("[truncated]");
    expect(result.totalBytes).toBeLessThanOrEqual(100);
  });

  it("skips paths that escape the worktree", async () => {
    const packer = new FileSystemContextPacker({
      readFile: async () => {
        throw new Error("should not read an escaping path");
      }
    });
    const result = await packer.pack({
      worktreePath: worktree,
      files: ["../secrets.env", "/etc/passwd"]
    });
    expect(result.section).toBe("");
    expect(result.includedFiles).toEqual([]);
  });
});
