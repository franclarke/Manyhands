import path from "node:path";
import { DecompositionModeSchema, type DecompositionMode } from "@manyhands/decomposer";
import { buildRepositoryIndex } from "@manyhands/repository-index";
import { JsonRunStore } from "@manyhands/run-store";
import {
  exportMockExecutionRun,
  runMockExecutionFlow
} from "../mock-execution-flow";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");
const defaultRepositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exportPath = readOption(args, "--export");
  const storePath = readOption(args, "--store");
  const repositoryPath = readOption(args, "--repository");
  const withStaticSignals = args.includes("--with-static-signals") || repositoryPath !== undefined;
  const mode = readMode(args);
  const repositoryIndex = withStaticSignals
    ? await buildRepositoryIndex({
        rootPath: path.resolve(repositoryPath ?? defaultRepositoryPath),
        repositoryId: "aprobado-lite"
      })
    : undefined;
  const save = args.includes("--save");
  const flowOptions: Parameters<typeof runMockExecutionFlow>[0] = {
    fixturePath,
    mode,
    maxParallel: 3
  };

  if (repositoryIndex !== undefined) {
    flowOptions.repositoryIndex = repositoryIndex;
  }

  const result = await runMockExecutionFlow(flowOptions);
  const { summary } = result;

  console.log("ManyHands deterministic mock execution run");
  console.log("-------------------------------------------");
  console.log(`Run: ${summary.runId}`);
  console.log(`Feature: ${summary.featureId}`);
  console.log(`Mode: ${summary.mode}`);
  console.log(`Planning batches: ${summary.planning.batchCount}`);
  console.log(`Executed tasks: ${summary.execution.executedTasks}/${summary.execution.totalTasks}`);
  console.log(`Succeeded: ${summary.execution.succeededTasks}`);
  console.log(`Failed: ${summary.execution.failedTasks}`);
  console.log(`Scope valid: ${summary.execution.scopeValidTasks}`);
  console.log(`Scope violations: ${summary.execution.scopeViolationCount}`);
  console.log(`Simulated diffs: ${summary.execution.simulatedDiffCount}`);
  console.log(`Validation commands: ${summary.execution.validationCommandCount}`);
  console.log(`Trace events: ${summary.traceEventCount}`);

  if (result.planning.repositoryIndexHash) {
    console.log(`Repository index hash: ${result.planning.repositoryIndexHash}`);
    console.log(`Static conflict signals: ${result.planning.staticConflictSignals.length}`);
  }

  for (const batch of summary.planning.batches) {
    console.log(`- ${batch.id}: ${batch.taskIds.join(", ")}`);
  }

  if (exportPath) {
    await exportMockExecutionRun(result, exportPath);
    console.log(`Exported: ${path.resolve(exportPath)}`);
  }

  if (save) {
    const store = new JsonRunStore(storePath === undefined ? {} : { directory: storePath });
    await store.saveRunSnapshot(result.snapshot);
    console.log(`Saved: ${store.filePathForRun(result.snapshot.runId)}`);
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const optionIndex = args.indexOf(name);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

function readMode(args: readonly string[]): DecompositionMode {
  const value = readOption(args, "--mode") ?? "balanced";
  return DecompositionModeSchema.parse(value);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
