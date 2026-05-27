import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BenchmarkFeatureSchema,
  BenchmarkManifestSchema,
  BenchmarkReportSchema,
  evaluateBenchmarkRuns,
  type BenchmarkConfiguration,
  type BenchmarkFeature,
  type BenchmarkManifest,
  type BenchmarkReport,
  type EvaluationConfiguration
} from "@manyhands/evaluator";
import {
  MetadataDrivenMockDecomposer,
  SingleTaskDecomposer,
  type Decomposer,
  type DecompositionMode
} from "@manyhands/decomposer";
import {
  buildRepositoryIndex,
  type RepositoryIndex
} from "@manyhands/repository-index";
import { JsonRunStore, type RunSnapshot } from "@manyhands/run-store";
import type { MockAgentRunOverride } from "@manyhands/worktree-runner";
import {
  runMockExecutionFlow,
  type MockExecutionFlowResult
} from "./mock-execution-flow";

export const DEFAULT_BENCHMARK_MANIFEST_PATH = "benchmarks/mock-v0/benchmark.json";

export interface RunBenchmarkMockFlowOptions {
  manifestPath?: string;
  featureIds?: readonly string[];
  configurationIds?: readonly EvaluationConfiguration[];
  createdAt?: string;
  workspaceRoot?: string;
}

export interface BenchmarkMockRunRecord {
  feature: BenchmarkFeature;
  configuration: BenchmarkConfiguration;
  result: MockExecutionFlowResult;
}

export interface BenchmarkMockFlowResult {
  manifest: BenchmarkManifest;
  features: BenchmarkFeature[];
  runs: BenchmarkMockRunRecord[];
  snapshots: RunSnapshot[];
  report: BenchmarkReport;
  repositoryIndex?: RepositoryIndex;
}

export async function runBenchmarkMockFlow(
  options: RunBenchmarkMockFlowOptions = {}
): Promise<BenchmarkMockFlowResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const manifestPath = resolveWorkspacePath(
    workspaceRoot,
    options.manifestPath ?? DEFAULT_BENCHMARK_MANIFEST_PATH
  );
  const manifest = await loadBenchmarkManifest(manifestPath);
  const manifestDirectory = path.dirname(manifestPath);
  const selectedFeatureRefs = manifest.features.filter((featureRef) =>
    options.featureIds === undefined || options.featureIds.includes(featureRef.id)
  );
  const selectedConfigurations = manifest.configurations.filter((configuration) =>
    options.configurationIds === undefined || options.configurationIds.includes(configuration.id)
  );

  if (selectedFeatureRefs.length === 0) {
    throw new Error("Benchmark selection did not include any features");
  }

  if (selectedConfigurations.length === 0) {
    throw new Error("Benchmark selection did not include any configurations");
  }

  const features = await Promise.all(selectedFeatureRefs.map(async (featureRef) => {
    const featurePath = resolveManifestRelativePath(manifestDirectory, featureRef.path);
    return loadBenchmarkFeature(featurePath);
  }));
  const needsRepositoryIndex = selectedConfigurations.some((configuration) =>
    configuration.repositoryIndex || configuration.staticSignals
  );
  const repositoryIndex = needsRepositoryIndex
    ? await buildRepositoryIndex({
        rootPath: resolveWorkspacePath(workspaceRoot, manifest.repositoryFixture),
        repositoryId: "aprobado-lite"
      })
    : undefined;
  const runs: BenchmarkMockRunRecord[] = [];

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const feature = features[featureIndex];
    const featureRef = selectedFeatureRefs[featureIndex];

    if (!feature || !featureRef) {
      continue;
    }

    const featurePath = resolveManifestRelativePath(manifestDirectory, featureRef.path);

    for (const configuration of selectedConfigurations) {
      const runInput: {
        manifest: BenchmarkManifest;
        feature: BenchmarkFeature;
        featurePath: string;
        configuration: BenchmarkConfiguration;
        repositoryIndex?: RepositoryIndex;
      } = {
        manifest,
        feature,
        featurePath,
        configuration
      };

      if (repositoryIndex !== undefined) {
        runInput.repositoryIndex = repositoryIndex;
      }

      const executionResult = await runBenchmarkConfiguration(runInput);

      runs.push({
        feature,
        configuration,
        result: executionResult
      });
    }
  }

  const evaluationInput: Parameters<typeof evaluateBenchmarkRuns>[0] = {
    manifest,
    runs: runs.map((run) => ({
      configurationId: run.configuration.id,
      snapshot: run.result.snapshot
    }))
  };

  if (options.createdAt !== undefined) {
    evaluationInput.createdAt = options.createdAt;
  }

  const report = evaluateBenchmarkRuns(evaluationInput);

  return {
    manifest,
    features,
    runs,
    snapshots: runs.map((run) => run.result.snapshot),
    report,
    ...(repositoryIndex ? { repositoryIndex } : {})
  };
}

export async function loadBenchmarkManifest(filePath: string): Promise<BenchmarkManifest> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return BenchmarkManifestSchema.parse(JSON.parse(raw) as unknown);
}

export async function loadBenchmarkFeature(filePath: string): Promise<BenchmarkFeature> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return BenchmarkFeatureSchema.parse(JSON.parse(raw) as unknown);
}

export async function writeBenchmarkReportFile(report: BenchmarkReport, filePath: string): Promise<void> {
  const parsed = BenchmarkReportSchema.parse(report);
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function saveBenchmarkRunSnapshots(
  snapshots: readonly RunSnapshot[],
  storeDirectory?: string
): Promise<void> {
  const store = new JsonRunStore(storeDirectory === undefined ? {} : { directory: storeDirectory });

  for (const snapshot of snapshots) {
    await store.saveRunSnapshot(snapshot);
  }
}

function resolveManifestRelativePath(manifestDirectory: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(manifestDirectory, value);
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

async function runBenchmarkConfiguration(input: {
  manifest: BenchmarkManifest;
  feature: BenchmarkFeature;
  featurePath: string;
  configuration: BenchmarkConfiguration;
  repositoryIndex?: RepositoryIndex;
}): Promise<MockExecutionFlowResult> {
  const decomposer = decomposerForConfiguration(input.configuration);
  const mode = modeForConfiguration(input.configuration);
  const executionOptions: Parameters<typeof runMockExecutionFlow>[0] = {
    feature: input.feature,
    fixturePath: input.featurePath,
    mode,
    decomposer,
    schedulerPolicy: input.configuration.schedulerPolicy,
    runLabel: input.configuration.id,
    datasetVersion: `${input.manifest.id}.${input.manifest.version}`,
    humanGate: input.configuration.humanGate
  };

  if (input.configuration.repositoryIndex && input.repositoryIndex !== undefined) {
    executionOptions.repositoryIndex = input.repositoryIndex;
  }

  if (Object.keys(input.feature.mockRunOverrides).length > 0) {
    executionOptions.runnerOptions = {
      overrides: normalizeMockRunOverrides(input.feature.mockRunOverrides)
    };
  }

  return runMockExecutionFlow(executionOptions);
}

function decomposerForConfiguration(configuration: BenchmarkConfiguration): Decomposer {
  return configuration.decompositionMode === "single"
    ? new SingleTaskDecomposer()
    : new MetadataDrivenMockDecomposer();
}

function modeForConfiguration(configuration: BenchmarkConfiguration): DecompositionMode {
  return configuration.decompositionMode === "single"
    ? "coarse"
    : configuration.decompositionMode;
}

function normalizeMockRunOverrides(
  overrides: BenchmarkFeature["mockRunOverrides"]
): Record<string, MockAgentRunOverride> {
  return Object.fromEntries(Object.entries(overrides).map(([taskId, override]) => {
    const normalized: MockAgentRunOverride = {};

    if (override.changedFiles !== undefined) {
      normalized.changedFiles = override.changedFiles;
    }

    if (override.reportedSymbols !== undefined) {
      normalized.reportedSymbols = override.reportedSymbols;
    }

    if (override.executedValidationCommands !== undefined) {
      normalized.executedValidationCommands = override.executedValidationCommands;
    }

    if (override.stdout !== undefined) {
      normalized.stdout = override.stdout;
    }

    if (override.stderr !== undefined) {
      normalized.stderr = override.stderr;
    }

    if (override.fail !== undefined) {
      normalized.fail = override.fail;
    }

    return [taskId, normalized];
  }));
}
