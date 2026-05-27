import path from "node:path";
import {
  JsonRunStore,
  readRunSnapshotFile,
  writeRunSnapshotFile,
  type RunQueryFilter
} from "@manyhands/run-store";

async function main(): Promise<void> {
  const [command = "list", ...args] = process.argv.slice(2);
  const store = createStore(args);

  if (command === "list") {
    await listRuns(store, args);
    return;
  }

  if (command === "show") {
    await showRun(store, args);
    return;
  }

  if (command === "import") {
    await importRun(store, args);
    return;
  }

  if (command === "export") {
    await exportRun(store, args);
    return;
  }

  throw new Error(`Unknown runs command: ${command}`);
}

async function listRuns(store: JsonRunStore, args: readonly string[]): Promise<void> {
  const filter = buildFilter(args);
  const runs = await store.listRunSnapshots(filter);

  console.log("ManyHands run snapshots");
  console.log("-----------------------");

  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }

  for (const run of runs) {
    console.log([
      run.runId,
      `feature=${run.featureId}`,
      `mode=${run.decompositionMode}`,
      `status=${run.status}`,
      `created=${run.createdAt}`,
      `inputHash=${shortHash(run.inputHash)}`,
      `outputHash=${shortHash(run.outputHash)}`
    ].join(" | "));
  }
}

async function showRun(store: JsonRunStore, args: readonly string[]): Promise<void> {
  const runId = positionalArgs(args)[0];

  if (!runId) {
    throw new Error("runs show requires a runId");
  }

  const snapshot = await store.exportRun(runId);

  console.log("ManyHands run snapshot");
  console.log("----------------------");
  console.log(`Run: ${snapshot.runId}`);
  console.log(`Feature: ${snapshot.featureId}`);
  console.log(`Mode: ${snapshot.decompositionMode}`);
  console.log(`Status: ${snapshot.status}`);
  console.log(`Schema: ${snapshot.metadata.schemaVersion}`);
  console.log(`Tasks: ${Object.keys(snapshot.graphSnapshot.nodes).length}`);
  console.log(`Contracts: ${snapshot.contracts.length}`);
  console.log(`Risks: ${snapshot.riskPredictions.length}`);
  console.log(`Batches: ${snapshot.scheduledBatches.length}`);
  console.log(`Agent results: ${snapshot.agentRunResults.length}`);
  console.log(`Scope validations: ${snapshot.scopeValidationResults.length}`);
  console.log(`Trace events: ${snapshot.traceEvents.length}`);
  console.log(`Input hash: ${snapshot.metadata.inputHash ?? "missing"}`);
  console.log(`Output hash: ${snapshot.metadata.outputHash ?? "missing"}`);
}

async function importRun(store: JsonRunStore, args: readonly string[]): Promise<void> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    throw new Error("runs import requires a JSON file path");
  }

  const snapshot = await readRunSnapshotFile(inputPath);
  await store.importRun(snapshot);
  console.log(`Imported: ${snapshot.runId}`);
}

async function exportRun(store: JsonRunStore, args: readonly string[]): Promise<void> {
  const runId = positionalArgs(args)[0];
  const outputPath = readOption(args, "--out");

  if (!runId) {
    throw new Error("runs export requires a runId");
  }

  if (!outputPath) {
    throw new Error("runs export requires --out <path>");
  }

  const snapshot = await store.exportRun(runId);
  await writeRunSnapshotFile(snapshot, outputPath);
  console.log(`Exported: ${path.resolve(outputPath)}`);
}

function createStore(args: readonly string[]): JsonRunStore {
  const storePath = readOption(args, "--store");
  return new JsonRunStore(storePath === undefined ? {} : { directory: storePath });
}

function buildFilter(args: readonly string[]): RunQueryFilter {
  const filter: RunQueryFilter = {};
  const featureId = readOption(args, "--feature");
  const status = readOption(args, "--status");
  const decompositionMode = readOption(args, "--mode");

  if (featureId !== undefined) {
    filter.featureId = featureId;
  }

  if (status !== undefined) {
    filter.status = status as RunQueryFilter["status"];
  }

  if (decompositionMode !== undefined) {
    filter.decompositionMode = decompositionMode as RunQueryFilter["decompositionMode"];
  }

  return filter;
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function positionalArgs(args: readonly string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current) {
      continue;
    }

    if (current === "--") {
      continue;
    }

    if (current.startsWith("--")) {
      index += 1;
      continue;
    }

    positional.push(current);
  }

  return positional;
}

function shortHash(value: string | undefined): string {
  return value === undefined ? "missing" : value.slice(0, 12);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
