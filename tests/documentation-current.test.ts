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

  it("records the attributable Stage 6 closure and prepares Stage 7 without starting it", async () => {
    const [docsReadme, plan, runbook, stage2, stage3, stage4, stage5, stage5Review, stage6, historicalHandoff, stage4Handoff, stage5Handoff, stage6Handoff, stage6ToStage7, stage7Plan, study, stage8, stage8Review, stage9, stage10] =
      await Promise.all([
        readFile(path.join(root, "docs", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "plans", "2026-08-12-correctness-first-system-redesign.md"), "utf8"),
        readFile(path.join(root, "docs", "agents", "correctness-first-execution.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-2", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-3", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-4", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-5", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-5", "evidence", "review-go.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-6", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "handoffs", "2026-08-12-stage-2-to-stage-3.md"), "utf8"),
        readFile(path.join(root, "docs", "handoffs", "2026-08-13-stage-3-to-stage-4.md"), "utf8"),
        readFile(path.join(root, "docs", "handoffs", "2026-08-13-stage-4-to-stage-5.md"), "utf8"),
        readFile(path.join(root, "docs", "handoffs", "2026-08-13-stage-5-to-stage-6.md"), "utf8"),
        readFile(path.join(root, "docs", "handoffs", "2026-08-14-stage-6-to-stage-7.md"), "utf8"),
        readFile(path.join(root, "docs", "plans", "2026-08-14-stage-7-git-native-artifacts-and-exact-validation.md"), "utf8"),
        readFile(path.join(root, "docs", "plans", "2026-08-13-exploratory-longitudinal-study.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-8", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-8", "evidence", "review-gate.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-9", "README.md"), "utf8"),
        readFile(path.join(root, "docs", "audits", "stage-10", "README.md"), "utf8")
      ]);

    expect(docsReadme).toContain("[`audits/stage-2/`](audits/stage-2/)");
    expect(plan).toContain("| Stage 2 / GD0+GD1 | `pass` |");
    expect(plan).toContain("../audits/stage-2/");
    expect(plan).toContain("../handoffs/2026-08-12-stage-2-to-stage-3.md");
    expect(stage2).toContain("**Status:** `pass`");
    expect(stage2).toContain("1c9c742687ec98c54b8d9330a0fe483c6d9d2ed3");
    expect(stage2).toContain("8e21667c03d27b5f588dd4811ff2e0ab159ae2c3");
    expect(historicalHandoff).toContain("**Stage 3 / GR:** `not_started`");
    expect(docsReadme).toContain("[`audits/stage-3/`](audits/stage-3/)");
    expect(plan).toContain("| Stage 3 / GR | `pass` |");
    expect(stage3).toContain("**Status:** `pass`");
    expect(stage3).toContain("4e495abd0805c62f7641dc73c19b82ffc7eedc38");
    expect(stage3).toContain("84a59b1d9db2ee978d87b6a079dafee281e38a64");
    expect(stage3).toContain("../../handoffs/2026-08-13-stage-3-to-stage-4.md");
    expect(docsReadme).toContain("[`audits/stage-4/`](audits/stage-4/)");
    expect(plan).toContain("| Stage 4 / GRepo | `pass` |");
    expect(plan).toContain("| Stage 5 / GP0+GP1 | `pass` |");
    expect(plan).toContain("Stage 6 / GS passed");
    expect(plan).toContain("| Stage 7 / GA | `pass` |");
    expect(plan).toContain("| Stage 8 / GLeaf | `in_review` |");
    expect(plan).toContain("| Stage 9 / GI | `in_review` |");
    expect(plan).toContain("| Stage 10 / GDel | `in_review` |");
    expect(plan).toContain("| Stage 11 | `not_started` |");
    expect(stage10).toContain("**Status:** `in_review`");
    expect(stage10).toContain("f9ddecc1625c1f687f562ac37148b9d20e22651e");
    expect(stage10).toContain("e7a0990bea99e7af58427f2cb8b3fa45da69af28");
    // The sequencing deviation must stay visible in the audit, not only in the
    // commit that made it.
    expect(stage10).toContain("cannot close before Stages 8");
    expect(docsReadme).toContain("[`audits/stage-10/README.md`](audits/stage-10/README.md)");
    expect(stage9).toContain("**Status:** `in_review`");
    expect(stage9).toContain("97b4cea35c8245fce301da11cabfb4ac89e04eac");
    expect(stage9).toContain("ahead of the plan's normative order");
    expect(stage8).toContain("**Status:** `in_review`");
    expect(stage8Review).toContain("**Verdict:** `NO-GO`");
    expect(stage8Review).toContain("f8d1eed639a15aeb29d93b120423630933a03a85");
    expect(stage4).toContain("**Status:** `pass`");
    expect(stage4).toContain("292daaee3803404cdb473f929c1fbfa36a8b4964");
    expect(stage4).toContain("8cd98afa812d3e7927985d6edf99c1744e4b5f5d");
    expect(stage4).toContain("Stage 5 permanece");
    expect(stage4).toContain("../../handoffs/2026-08-13-stage-4-to-stage-5.md");
    expect(stage4Handoff).toContain("**Stage 4 / GRepo:** `not_started`");
    expect(stage4Handoff).toContain("`gpt-5.6-sol`");
    expect(stage4Handoff).toContain("**esfuerzo principal:** `high`");
    expect(stage4Handoff).toContain("4e495abd0805c62f7641dc73c19b82ffc7eedc38");
    expect(docsReadme).toContain("[`handoffs/2026-08-13-stage-4-to-stage-5.md`](handoffs/2026-08-13-stage-4-to-stage-5.md)");
    expect(stage5Handoff).toContain("**Stage 5 / GP0+GP1:** `not_started`");
    expect(stage5Handoff).toContain("292daaee3803404cdb473f929c1fbfa36a8b4964");
    expect(stage5Handoff).toContain("**conductor:** `gpt-5.6-sol`, razonamiento `ultra`");
    expect(stage5Handoff).toContain("exactamente las dos");
    expect(docsReadme).toContain("[`audits/stage-5/`](audits/stage-5/)");
    expect(docsReadme).toContain("[`handoffs/2026-08-13-stage-5-to-stage-6.md`](handoffs/2026-08-13-stage-5-to-stage-6.md)");
    expect(stage5).toContain("**Status:** `pass`");
    expect(stage5).toContain("94a3f27d959225643e4e0bdb6f3981c61ef0a7b5");
    expect(stage5).toContain("6fc75ab60e3f8739e0ad9b9b7c55c040cc8f2eae");
    expect(stage5).toContain("Stage 6 queda elegible pero `not_started`");
    expect(stage5Review).toContain("**Verdict:** `GO`");
    expect(stage5Review).toContain("94a3f27d959225643e4e0bdb6f3981c61ef0a7b5");
    expect(stage6Handoff).toContain("**Stage 6:** `not_started`");
    expect(stage6).toContain("**Status:** `pass`");
    expect(stage6).toContain("02f05e4cc320a11a0a1c762e2a2faa04d4bc1af0");
    expect(stage6ToStage7).toContain("**Stage 7 / GA:** not_started");
    expect(stage6ToStage7).toContain("GitRunner.cherryPick");
    expect(stage7Plan).toContain("## TDD execution tasks");
    expect(stage7Plan).toContain("Stage 8 remains not_started");
    expect(plan).toContain("D5.1 — Result taxonomy and canonical-plan boundary");
    expect(plan).toContain("D5.2 — Contract material belongs to the SemanticPlan");
    expect(plan).toContain("D5.3 — Unified budget, revision lineage and no-progress termination");
    expect(plan).toContain("D5.4 — Minimal attributable evidence for GP1");
    expect(runbook).toContain("Stage 5 / GP1 may execute only the two pre-registered");
    expect(plan).toContain("2026-08-13-stage-4-to-stage-5.md");
    expect(plan).toContain("2026-08-13-stage-3-to-stage-4.md");
    expect(plan).toContain("2026-08-13-exploratory-longitudinal-study.md");
    expect(study).toContain("Corrida 1 — producto visual inicial");
    expect(study).toContain("Corrida 2 — incremento sobre una base real");
    expect(study).toContain("Corrida 3 — opcional y condicionada");
    expect(study).toContain("no pretende demostrar causalidad");
  });
});

function tableIds(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^\\| (${prefix}\\d+) \\|`, "gmu"))].map((match) => match[1]!);
}

function numberedIds(prefix: string, start: number, end: number): string[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => `${prefix}${start + offset}`);
}
