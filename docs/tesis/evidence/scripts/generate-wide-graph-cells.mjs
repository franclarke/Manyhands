#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildWideGraphPlan } from "./lib/wide-graph-study.mjs";

const targetRepo = resolve(argument("--target") ?? fail("--target is required"));
const outDir = resolve(argument("--out") ?? "docs/tesis/evidence/warehouse/wide-graph/cells");
const dryRun = process.argv.includes("--dry-run");
const baseUrl = argument("--base-url") ?? "http://127.0.0.1:3111";
const runsDir = resolve(argument("--runs-dir") ?? ".manyhands/runs");
const plan = buildWideGraphPlan({ targetRepo });
const selection = { executorId: "codex-cli", model: "gpt-5.5", effort: "high" };
const cells = plan.map((entry) => ({
  ...entry,
  baseUrl,
  workspaceName: "warehouse-wide-graph",
  planningSelection: selection,
  executionSelection: selection,
  repairSelection: selection,
  executionConfig: {
    maxParallel: 2,
    scopePolicy: "strict",
    leafTimeoutMs: 1_800_000,
    integrationTimeoutMs: 1_800_000,
    unexpectedCommitPolicy: "reject"
  },
  runsDir,
  pollIntervalMs: 10_000,
  wallClockLimitMs: 7_200_000,
  goalSha256: sha(entry.goal)
}));

if (dryRun) {
  process.stdout.write(`${JSON.stringify({ targetRepo, outDir, cells }, null, 2)}\n`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
for (const cell of cells) {
  await writeFile(join(outDir, `${cell.cellId}.json`), `${JSON.stringify(cell, null, 2)}\n`, "utf8");
}
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  title: "Warehouse wide graph pilot",
  baseSha: plan[0]?.baseSha,
  moduleCounts: plan.map((entry) => entry.moduleCount),
  cells: cells.map(({ cellId, position, moduleCount, baseSha, goalSha256 }) => ({ cellId, position, moduleCount, baseSha, goalSha256 }))
}, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${cells.length} wide graph cells to ${outDir}\n`);

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
