import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

/**
 * Architectural canary: scan all TypeScript source files for raw
 * `env: process.env` patterns that bypass buildAgentEnvironment().
 *
 * Files in this allowlist are known to use process.env legitimately
 * (e.g., for reading config, not for passing to child processes).
 */
const ALLOWLIST = new Set([
  // buildAgentEnvironment itself reads process.env as the default base
  "packages/execution-core/src/executor/agent-env.ts",
  // CLI binary resolution needs process.env for PATH lookup
  "packages/shared/src/node-cli-process.ts",
  // Test files are allowed
]);

const PROJECT_ROOT = join(__dirname, "..");

function collectTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    // Skip node_modules, dist, .git, tests
    if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "tests") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsFiles(full, files);
    } else if (extname(full) === ".ts" && !full.endsWith(".d.ts") && !full.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("security-env-audit: no raw env: process.env in spawn calls", () => {
  it("source files do not pass process.env directly to child process spawn options", () => {
    const sourceFiles = [
      ...collectTsFiles(join(PROJECT_ROOT, "packages")),
      ...collectTsFiles(join(PROJECT_ROOT, "apps"))
    ];

    const violations: Array<{ file: string; line: number; content: string }> = [];

    for (const file of sourceFiles) {
      const relPath = relative(PROJECT_ROOT, file).replaceAll("\\", "/");
      if (ALLOWLIST.has(relPath)) continue;

      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match `env: process.env` in spawn/exec option objects
        if (/env:\s*process\.env/u.test(line)) {
          violations.push({
            file: relPath,
            line: i + 1,
            content: line.trim()
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} — ${v.content}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} file(s) passing raw process.env to child processes.\n` +
        `Use buildAgentEnvironment() instead:\n${report}`
      );
    }
  });
});
