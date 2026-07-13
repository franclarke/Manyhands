import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("B-033 current product documentation", () => {
  it("documents Claude Code default, Codex alternative, and current pnpm commands without legacy executors", async () => {
    const [readme, webReadme, pkg] = await Promise.all([
      readFile(path.join(root, "README.md"), "utf8"),
      readFile(path.join(root, "apps", "web", "README.md"), "utf8"),
      readFile(path.join(root, "package.json"), "utf8")
    ]);
    expect(readme).toContain("Claude Code CLI");
    expect(readme).toContain("Codex CLI");
    expect(readme).not.toContain("executor por defecto es **Gemini CLI**");
    expect(webReadme).not.toContain("MANYHANDS_GEMINI_BIN");
    expect(webReadme).toContain("GET /api/runs/[id]/diagnostics");
    expect(pkg).toContain('"web:build"');
  });
});
