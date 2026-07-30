#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  assertWideGraphSeriesSelection,
  buildWideGraphPlan,
  wideGraphSelection,
  WIDE_GRAPH_DELIVERY_SELECTION_NAME
} from "./lib/wide-graph-study.mjs";
import {
  loadWideGraphOracleContract,
  WIDE_GRAPH_PROTOCOL
} from "./lib/wide-graph-oracle-contract.mjs";

const targetRepo = resolve(argument("--target") ?? fail("--target is required"));
const outDir = resolve(argument("--out") ?? "docs/tesis/evidence/warehouse/wide-graph/cells");
const dryRun = process.argv.includes("--dry-run");
const baseUrl = argument("--base-url") ?? "http://127.0.0.1:3111";
const runsDir = resolve(argument("--runs-dir") ?? ".manyhands/runs");
const plan = buildWideGraphPlan({ targetRepo });
const executorName = argument("--executor") ?? WIDE_GRAPH_DELIVERY_SELECTION_NAME;
const selection = wideGraphSelection(executorName);
const seriesKind = argument("--kind") ?? "delivery";
if (seriesKind !== "delivery" && seriesKind !== "measurement") {
  fail(`--kind must be delivery or measurement, received "${seriesKind}"`);
}
/**
 * The executor is the Architect, so a series that changes it produces different
 * candidate trees and is not comparable with the frozen delivery series. It may
 * still answer a policy question, but only as a measurement that stops at the
 * compiled plan — and it has to say so in its own manifest, because a later
 * synthesis reads the manifest, not this argument list.
 */
if (executorName !== WIDE_GRAPH_DELIVERY_SELECTION_NAME && seriesKind !== "measurement") {
  fail(
    `executor "${executorName}" is not comparable with the frozen `
    + `"${WIDE_GRAPH_DELIVERY_SELECTION_NAME}" delivery series; generate it with --kind measurement`
  );
}
const stopAfter = seriesKind === "measurement" ? "planning" : undefined;
const oracleContract = await loadWideGraphOracleContract();
const cells = plan.map((entry) => ({
  schemaVersion: 2,
  protocol: WIDE_GRAPH_PROTOCOL,
  ...entry,
  condition: "C",
  granularityCondition: "C",
  seriesKind,
  ...(stopAfter === undefined ? {} : { stopAfter }),
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
  oracleContract,
  goalSha256: sha(entry.goal)
}));
assertWideGraphSeriesSelection(cells, selection);

if (dryRun) {
  process.stdout.write(`${JSON.stringify({ targetRepo, outDir, cells }, null, 2)}\n`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
for (const cell of cells) {
  await writeFile(join(outDir, `${cell.cellId}.json`), `${JSON.stringify(cell, null, 2)}\n`, "utf8");
}
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
  schemaVersion: 2,
  protocol: WIDE_GRAPH_PROTOCOL,
  title: "Warehouse wide graph pilot",
  baseSha: plan[0]?.baseSha,
  granularityCondition: "C",
  seriesKind,
  ...(stopAfter === undefined ? {} : { stopAfter }),
  comparableWith: seriesKind === "measurement" ? [] : [WIDE_GRAPH_DELIVERY_SELECTION_NAME],
  executorSelection: selection,
  oracleContract,
  moduleCounts: plan.map((entry) => entry.moduleCount),
  cells: cells.map(({ cellId, position, moduleCount, baseSha, goalSha256 }) => ({ cellId, position, moduleCount, baseSha, goalSha256 }))
}, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${cells.length} wide graph cells to ${outDir}\n`);

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
