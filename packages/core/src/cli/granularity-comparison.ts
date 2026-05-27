import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EvaluationReportSchema,
  type EvaluationReport,
  type GranularityComparisonRow
} from "@manyhands/evaluator";
import { DecompositionModeSchema, type DecompositionMode } from "@manyhands/decomposer";
import { JsonRunStore } from "@manyhands/run-store";
import {
  DEFAULT_GRANULARITY_COMPARISON_MODES,
  runGranularityComparisonFlow
} from "../granularity-comparison-flow";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exportPath = readOption(args, "--export");
  const storePath = readOption(args, "--store");
  const fixturePath = readOption(args, "--fixture");
  const repositoryPath = readOption(args, "--repository");
  const repositoryId = readOption(args, "--repository-id");
  const modes = readModes(args);
  const withStaticSignals = !args.includes("--no-static-signals");
  const saveRuns = args.includes("--save-runs");
  const result = await runGranularityComparisonFlow({
    ...(fixturePath ? { fixturePath } : {}),
    ...(repositoryPath ? { repositoryPath } : {}),
    ...(repositoryId ? { repositoryId } : {}),
    modes,
    withStaticSignals
  });
  const report = EvaluationReportSchema.parse(result.report);

  printReport(report, result.repositoryIndexHash);

  if (exportPath !== undefined) {
    await writeEvaluationReportFile(report, exportPath);
    console.log(`Exported report: ${path.resolve(exportPath)}`);
  }

  if (saveRuns) {
    const store = new JsonRunStore(storePath === undefined ? {} : { directory: storePath });

    for (const snapshot of result.snapshots) {
      await store.saveRunSnapshot(snapshot);
      console.log(`Saved run: ${store.filePathForRun(snapshot.runId)}`);
    }
  }
}

function printReport(report: EvaluationReport, repositoryIndexHash: string | undefined): void {
  console.log("ManyHands granularity comparison");
  console.log("--------------------------------");
  console.log(`Report: ${report.id}`);
  console.log(`Feature: ${report.comparison?.featureId ?? "unknown"}`);
  console.log(`Schema: ${report.metadata.schemaVersion}`);
  console.log(`Report hash: ${report.metadata.reportHash ?? "missing"}`);

  if (repositoryIndexHash !== undefined) {
    console.log(`Repository index hash: ${repositoryIndexHash}`);
  }

  console.log("");
  printRows(report.comparison?.rows ?? []);
  console.log("");
  console.log("Warnings:");

  for (const warning of report.warnings) {
    console.log(`- ${warning.code}: ${warning.message}`);
  }

  if ((report.comparison?.observations.length ?? 0) > 0) {
    console.log("");
    console.log("Observations:");

    for (const observation of report.comparison?.observations ?? []) {
      console.log(`- ${observation.code}: ${observation.message}`);
    }
  }
}

function printRows(rows: readonly GranularityComparisonRow[]): void {
  const columns = [
    "mode",
    "leaves",
    "deps",
    "risks",
    "static",
    "high",
    "block",
    "batches",
    "avgBatch",
    "simMs",
    "wallMs",
    "scope",
    "traces",
    "overhead",
    "outputHash"
  ];
  const rowValues = rows.map((row) => [
    row.mode,
    String(row.leafCount),
    String(row.dependencyCount),
    String(row.riskPredictionCount),
    String(row.staticSignalCount),
    String(row.highRiskCount),
    String(row.blockingRiskCount),
    String(row.batchCount),
    row.avgBatchSize.toFixed(2),
    String(row.simulatedDurationMs),
    String(row.estimatedWallClockMs),
    String(row.scopeViolationCount),
    String(row.traceEventCount),
    String(row.coordinationOverheadUnits),
    shortHash(row.outputHash)
  ]);
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rowValues.map((row) => row[index]?.length ?? 0))
  );

  console.log(formatRow(columns, widths));
  console.log(formatRow(widths.map((width) => "-".repeat(width)), widths));

  for (const row of rowValues) {
    console.log(formatRow(row, widths));
  }
}

async function writeEvaluationReportFile(
  report: EvaluationReport,
  outputPath: string
): Promise<void> {
  const absolutePath = path.resolve(outputPath);
  const parsed = EvaluationReportSchema.parse(report);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function readModes(args: readonly string[]): readonly DecompositionMode[] {
  const raw = readOption(args, "--modes");

  if (raw === undefined) {
    return DEFAULT_GRANULARITY_COMPARISON_MODES;
  }

  return raw.split(",").map((mode) => DecompositionModeSchema.parse(mode.trim()));
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function formatRow(values: readonly string[], widths: readonly number[]): string {
  return values.map((value, index) => value.padEnd(widths[index] ?? value.length)).join("  ");
}

function shortHash(value: string | undefined): string {
  return value === undefined ? "missing" : value.slice(0, 12);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
