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
    expect(webReadme).toContain("GET /api/runs/[id]/run-events");
    expect(webReadme).not.toContain("GET /api/runs/[id]/diagnostics");
    expect(pkg).toContain('"web:build"');
  });

  it("does not present retired thesis evidence as proof of the correctness-first architecture", async () => {
    const [docsReadme, thesisReadme] = await Promise.all([
      readFile(path.join(root, "docs", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "tesis", "README.md"), "utf8")
    ]);

    expect(docsReadme).toContain("Stage 11");
    expect(docsReadme).not.toContain("Stage 14");
    expect(docsReadme).toContain("Stage 0 baseline");
    expect(thesisReadme).toContain("Historical draft — not current evidence");
    expect(thesisReadme).toContain("must not be used to close any current architecture gate");
  });

  it("keeps the Stage 0 transition ledger and required-cell registry complete", async () => {
    const [plan, baseline, ledger, cells] = await Promise.all([
      readFile(path.join(root, "docs", "plans", "2026-08-12-correctness-first-system-redesign.md"), "utf8"),
      readFile(path.join(root, "docs", "audits", "stage-0", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "audits", "stage-0", "transition-ledger.md"), "utf8"),
      readFile(path.join(root, "docs", "audits", "stage-0", "required-cells.md"), "utf8")
    ]);

    expect(plan).toContain("Stage 0 / G0");
    expect(plan).toContain("../audits/stage-0/");
    expect(baseline).toContain("What G0 does not prove");
    expect(tableIds(ledger, "I")).toEqual(numberedIds("I", 1, 43));
    expect(tableIds(ledger, "DoC")).toEqual(numberedIds("DoC", 1, 26));
    expect(tableIds(cells, "R")).toEqual(numberedIds("R", 0, 19));
    expect(cells.match(/\| `not_run` \|/gu)).toHaveLength(20);
  });
});

function tableIds(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^\\| (${prefix}\\d+) \\|`, "gmu"))].map((match) => match[1]);
}

function numberedIds(prefix: string, start: number, end: number): string[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => `${prefix}${start + offset}`);
}
