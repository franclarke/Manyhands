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
    const [docsReadme, thesisReadme, claudeGuide, conflictRiskReadme, orchestratorReadme] = await Promise.all([
      readFile(path.join(root, "docs", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "tesis", "README.md"), "utf8"),
      readFile(path.join(root, "CLAUDE.md"), "utf8"),
      readFile(path.join(root, "packages", "conflict-risk", "README.md"), "utf8"),
      readFile(path.join(root, "packages", "orchestrator-graph", "README.md"), "utf8")
    ]);

    expect(docsReadme).toContain("Stage 11");
    expect(docsReadme).toContain("Stage 0 baseline");
    expect(thesisReadme).toContain("Historical draft — not current evidence");
    expect(thesisReadme).toContain("must not be used to close any current architecture gate");
    for (const currentGuide of [docsReadme, claudeGuide, conflictRiskReadme, orchestratorReadme]) {
      expect(currentGuide).not.toMatch(/Stage (?:1[2-9]|[2-9]\d)/u);
    }
    expect(claudeGuide).toContain("Stage 11");
    expect(conflictRiskReadme).toContain("Stage 6");
    expect(orchestratorReadme).toContain("GProd");
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

  it("records the attributable Stage 3 closure and leaves Stage 4 not started", async () => {
    const [docsReadme, plan, stage2, stage3, handoff] = await Promise.all([
      readFile(path.join(root, "docs", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "plans", "2026-08-12-correctness-first-system-redesign.md"), "utf8"),
      readFile(path.join(root, "docs", "audits", "stage-2", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "audits", "stage-3", "README.md"), "utf8"),
      readFile(path.join(root, "docs", "handoffs", "2026-08-12-stage-2-to-stage-3.md"), "utf8")
    ]);

    expect(docsReadme).toContain("[`audits/stage-2/`](audits/stage-2/)");
    expect(plan).toContain("| Stage 2 / GD0+GD1 | `pass` |");
    expect(plan).toContain("../audits/stage-2/");
    expect(plan).toContain("../handoffs/2026-08-12-stage-2-to-stage-3.md");
    expect(stage2).toContain("**Status:** `pass`");
    expect(stage2).toContain("1c9c742687ec98c54b8d9330a0fe483c6d9d2ed3");
    expect(stage2).toContain("8e21667c03d27b5f588dd4811ff2e0ab159ae2c3");
    expect(handoff).toContain("**Stage 3 / GR:** `not_started`");
    expect(docsReadme).toContain("[`audits/stage-3/`](audits/stage-3/)");
    expect(plan).toContain("| Stage 3 / GR | `pass` |");
    expect(plan).toContain("| Stages 4–11 | `not_started` |");
    expect(stage3).toContain("**Status:** `pass`");
    expect(stage3).toContain("4e495abd0805c62f7641dc73c19b82ffc7eedc38");
    expect(stage3).toContain("84a59b1d9db2ee978d87b6a079dafee281e38a64");
  });
});

function tableIds(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^\\| (${prefix}\\d+) \\|`, "gmu"))].map((match) => match[1]!);
}

function numberedIds(prefix: string, start: number, end: number): string[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => `${prefix}${start + offset}`);
}
