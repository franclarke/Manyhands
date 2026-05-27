import {
  DEFAULT_BENCHMARK_MANIFEST_PATH,
  runBenchmarkMockFlow,
  saveBenchmarkRunSnapshots,
  writeBenchmarkReportFile
} from "../benchmark-mock-flow";
import type { EvaluationConfiguration } from "@manyhands/evaluator";

interface CliOptions {
  manifestPath: string;
  exportPath?: string;
  saveRuns: boolean;
  storeDirectory?: string;
  featureIds: string[];
  configurationIds: EvaluationConfiguration[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const flowOptions: Parameters<typeof runBenchmarkMockFlow>[0] = {
    manifestPath: options.manifestPath
  };

  if (options.featureIds.length > 0) {
    flowOptions.featureIds = options.featureIds;
  }

  if (options.configurationIds.length > 0) {
    flowOptions.configurationIds = options.configurationIds;
  }

  const result = await runBenchmarkMockFlow(flowOptions);

  printReport(result);

  if (options.exportPath !== undefined) {
    await writeBenchmarkReportFile(result.report, options.exportPath);
    console.log(`\nExported benchmark report: ${options.exportPath}`);
  }

  if (options.saveRuns) {
    await saveBenchmarkRunSnapshots(result.snapshots, options.storeDirectory);
    console.log(`Saved ${result.snapshots.length} run snapshot(s) to ${options.storeDirectory ?? ".manyhands/runs"}`);
  }
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: DEFAULT_BENCHMARK_MANIFEST_PATH,
    saveRuns: false,
    featureIds: [],
    configurationIds: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--manifest") {
      options.manifestPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--export") {
      options.exportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--save-runs") {
      options.saveRuns = true;
      continue;
    }

    if (arg === "--store") {
      options.storeDirectory = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--feature") {
      options.featureIds.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--config") {
      options.configurationIds.push(parseConfigurationId(requireValue(args, index, arg)));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printReport(result: Awaited<ReturnType<typeof runBenchmarkMockFlow>>): void {
  console.log("ManyHands mock benchmark");
  console.log("------------------------");
  console.log(`Benchmark: ${result.manifest.id}`);
  console.log(`Features: ${result.features.length}`);
  console.log(`Configurations: ${result.report.configurationIds.join(", ")}`);
  console.log("");
  console.log(formatTable([
    [
      "Configuration",
      "Runs",
      "Avg leaves",
      "Avg high",
      "Avg blocking",
      "Avg batches",
      "Gate required",
      "Serialized by gate",
      "Blocked by gate",
      "Scope violations",
      "Warnings"
    ],
    ...result.report.configurations.map((configuration) => [
      configuration.configurationId,
      String(configuration.runCount),
      String(configuration.avgLeafCount),
      String(configuration.avgHighRiskCount),
      String(configuration.avgBlockingRiskCount),
      String(configuration.avgBatchCount),
      String(configuration.avgGateRequiredCount),
      String(configuration.avgSerializedByGateCount),
      String(configuration.avgBlockedByGateCount),
      String(configuration.totalScopeViolations),
      String(configuration.warningCount)
    ])
  ]));
  console.log("");
  console.log(`Report hash: ${result.report.metadata.reportHash ?? "not-computed"}`);
}

function formatTable(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]?.map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex]?.length ?? 0))
  ) ?? [];

  return rows
    .map((row, rowIndex) => {
      const line = row
        .map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 0))
        .join("  ");

      if (rowIndex === 0) {
        const separator = widths.map((width) => "-".repeat(width)).join("  ");
        return `${line}\n${separator}`;
      }

      return line;
    })
    .join("\n");
}

function requireValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parseConfigurationId(value: string): EvaluationConfiguration {
  if (value === "B0" || value === "B1" || value === "B2" || value === "B3" || value === "B4") {
    return value;
  }

  throw new Error(`Unsupported benchmark configuration id: ${value}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
