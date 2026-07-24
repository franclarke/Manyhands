#!/usr/bin/env node
/**
 * Materializes the 12 pre-registered G5 cells from the protocol.
 *
 * The execution order, the tasks and the conditions come from
 * `docs/tesis/evidence/experiment/protocol.md` §3 and §5 and are reproduced here
 * as data, not re-decided: regenerating the cells must never be an opportunity
 * to change the design. The generator is deterministic, so a reviewer can
 * re-run it and diff the result against what was executed.
 *
 * Usage: node generate-cells.mjs --out <directory>
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const TARGET_REPO = "C:/Users/franc/manyhands-thesis-targets/expense-splitter";
const BASE_SHA = "1da878de6edd38cefb1ea4d8ceecdceea0bb6acc";
const BASE_URL = "http://127.0.0.1:3111";
const RUNS_DIR = "C:/Users/franc/Documents/Proyectos/Manyhands/.manyhands/runs";

const CODEX = { executorId: "codex-cli", model: "gpt-5.5", effort: "high" };

/**
 * §3 — two tasks deliberately on opposite sides of the decision threshold.
 *
 * Both goals are **self-contained**: every value a planner could otherwise stop
 * to ask about is stated. A goal that triggers a clarification loses the run,
 * because answering it mid-experiment would change the stimulus. That is an
 * instrument defect, not a result, and it costs runs from whichever condition
 * happens to draw it -- so it is fixed once, identically for every condition,
 * rather than answered case by case.
 */
const TASKS = {
  T1: {
    label: "multi-layer feature above the threshold",
    goal: [
      "Add expense categories to the splitter.",
      "Extend the Expense type with an optional category field that must be one of exactly",
      "\"food\", \"transport\", \"lodging\", \"entertainment\" or \"other\", rejecting any other value,",
      "add computeCategoryTotals to the domain, expose listCategoryTotals from the API layer,",
      "render a category breakdown in the web surface, and cover the new behaviour with tests.",
      "Preserve the existing balance behaviour and keep the current tests green."
    ].join(" ")
  },
  T2: {
    label: "narrow domain rule below the threshold",
    goal: [
      "Allow an expense to be split unequally between participants using explicit per-participant weights.",
      "A weight is a positive number, one per participant, and the weights must sum to exactly 1;",
      "each participant owes that fraction of the total. Reject an expense whose weights are not",
      "positive, do not cover every participant, or do not sum to 1, and cover the rule with tests.",
      "Keep the change inside the domain module and preserve the existing equal-split behaviour."
    ].join(" ")
  }
};

/** §5 — pre-registered order. Two blocks; the second inverts the conditions. */
const ORDER = [
  ["T1", "A", 1], ["T2", "B", 1], ["T1", "C", 1],
  ["T2", "A", 1], ["T1", "B", 1], ["T2", "C", 1],
  ["T2", "C", 2], ["T1", "B", 2], ["T2", "A", 2],
  ["T1", "C", 2], ["T2", "B", 2], ["T1", "A", 2]
];

const outDir = resolve(argOf("--out") ?? "docs/tesis/evidence/experiment/cells");
await mkdir(outDir, { recursive: true });

const manifest = [];
for (const [position, [taskId, condition, repetition]] of ORDER.entries()) {
  const cellId = `g5-${String(position + 1).padStart(2, "0")}-${taskId}-${condition}-r${repetition}`;
  const cell = {
    cellId,
    position: position + 1,
    taskId,
    taskLabel: TASKS[taskId].label,
    condition,
    repetition,
    workspaceName: "thesis-expense-splitter",
    baseUrl: BASE_URL,
    targetRepo: TARGET_REPO,
    baseSha: BASE_SHA,
    goal: TASKS[taskId].goal,
    granularityCondition: condition,
    planningSelection: CODEX,
    executionSelection: CODEX,
    repairSelection: CODEX,
    executionConfig: {
      maxParallel: 2,
      scopePolicy: "strict",
      leafTimeoutMs: 300000,
      integrationTimeoutMs: 600000,
      unexpectedCommitPolicy: "reject"
    },
    runsDir: RUNS_DIR,
    pollIntervalMs: 10000,
    wallClockLimitMs: 5400000
  };
  await writeFile(join(outDir, `${cellId}.json`), `${JSON.stringify(cell, null, 2)}\n`, "utf8");
  manifest.push({ cellId, position: cell.position, taskId, condition, repetition });
}

await writeFile(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ design: "2 tasks x 3 conditions x 2 repetitions", total: manifest.length, cells: manifest }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`wrote ${manifest.length} cells to ${outDir}\n`);

function argOf(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
