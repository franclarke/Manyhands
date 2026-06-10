/**
 * Tests for checkRepairedFiles — the Composer's post-repair AST gate.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRepairedFiles, describeSyntaxFindings } from "@manyhands/execution-core";

describe("checkRepairedFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mh-syntax-check-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(file: string, content: string): Promise<void> {
    const full = join(dir, file);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  it("passes well-formed TypeScript", async () => {
    await write("src/ok.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["src/ok.ts"] });
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("rejects leftover git conflict markers in any text file", async () => {
    await write(
      "README.md",
      "# title\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n"
    );
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["README.md"] });
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.message).toMatch(/conflict markers/);
  });

  it("rejects TypeScript with parse errors and reports position + message", async () => {
    await write("src/broken.ts", "export function add(a: number, b: number): number {\n  return a + b;\n");
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["src/broken.ts"] });
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.file).toMatch(/^src\/broken\.ts:\d+:\d+$/);
    expect(result.findings[0]?.message).toContain("expected");
  });

  it("parses TSX with the TSX script kind", async () => {
    await write("src/view.tsx", "export function View(): JSX.Element {\n  return <div>ok</div>;\n}\n");
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["src/view.tsx"] });
    expect(result.passed).toBe(true);
  });

  it("skips deleted files instead of failing", async () => {
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["src/gone.ts"] });
    expect(result.passed).toBe(true);
  });

  it("does not parse non-code files beyond the marker scan", async () => {
    await write("data.json", "{ definitely: not valid json }");
    const result = await checkRepairedFiles({ worktreePath: dir, files: ["data.json"] });
    expect(result.passed).toBe(true);
  });

  it("describeSyntaxFindings renders a compiler-feedback block", () => {
    const text = describeSyntaxFindings([
      { file: "a.ts:1:2", message: "';' expected." },
      { file: "b.ts", message: "unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) remain" }
    ]);
    expect(text).toBe(
      "- a.ts:1:2: ';' expected.\n- b.ts: unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) remain"
    );
  });
});
