import { access } from "node:fs/promises";
import path from "node:path";
import {
  loadBenchmarkManifest,
  runBenchmarkMockFlow,
  type RunSnapshot
} from "@manyhands/core";
import {
  EvaluationConfigurationSchema,
  type BenchmarkManifest,
  type EvaluationConfiguration
} from "@manyhands/evaluator";
import type {
  BenchmarkDetailResponse,
  BenchmarkRunResponse,
  BenchmarkSummary
} from "@/lib/api-types";

const benchmarkRegistry = [
  {
    id: "mock-v0",
    manifestPath: "benchmarks/mock-v0/benchmark.json"
  },
  {
    id: "conflict-v0",
    manifestPath: "benchmarks/conflict-v0/benchmark.json"
  }
] as const;

type BenchmarkId = (typeof benchmarkRegistry)[number]["id"];

export interface DemoRunSnapshotOptions {
  benchmarkId?: string;
  config?: unknown;
  featureId?: string;
}

export async function listBenchmarks(): Promise<BenchmarkSummary[]> {
  const workspaceRoot = await resolveWorkspaceRoot();

  return Promise.all(benchmarkRegistry.map(async (entry) => {
    const manifestPath = path.resolve(workspaceRoot, entry.manifestPath);
    const manifest = await loadBenchmarkManifest(manifestPath);

    return summarizeManifest(manifest, entry.manifestPath);
  }));
}

export async function getBenchmarkDetail(id: string): Promise<BenchmarkDetailResponse> {
  const entry = getRegistryEntry(id);
  const workspaceRoot = await resolveWorkspaceRoot();
  const manifestPath = path.resolve(workspaceRoot, entry.manifestPath);
  const manifest = await loadBenchmarkManifest(manifestPath);

  return {
    benchmark: summarizeManifest(manifest, entry.manifestPath),
    manifest
  };
}

export async function runBenchmark(id: string, config?: unknown): Promise<BenchmarkRunResponse> {
  const entry = getRegistryEntry(id);
  const workspaceRoot = await resolveWorkspaceRoot();
  const manifestPath = path.resolve(workspaceRoot, entry.manifestPath);
  const manifest = await loadBenchmarkManifest(manifestPath);
  const configurationId = parseConfigurationSelection(config, manifest);
  const result = await runBenchmarkMockFlow({
    manifestPath,
    workspaceRoot,
    ...(configurationId !== undefined ? { configurationIds: [configurationId] } : {})
  });

  return {
    benchmark: summarizeManifest(result.manifest, entry.manifestPath),
    report: result.report
  };
}

export async function getDemoRunSnapshot(options: DemoRunSnapshotOptions = {}): Promise<RunSnapshot> {
  const benchmarkId = options.benchmarkId ?? "conflict-v0";
  const entry = getRegistryEntry(benchmarkId);
  const workspaceRoot = await resolveWorkspaceRoot();
  const manifestPath = path.resolve(workspaceRoot, entry.manifestPath);
  const manifest = await loadBenchmarkManifest(manifestPath);
  const featureId = options.featureId ?? defaultDemoFeatureId(manifest);
  const configurationId = parseRequiredConfigurationSelection(
    options.config ?? defaultDemoConfigurationId(manifest),
    manifest
  );

  if (!manifest.features.some((feature) => feature.id === featureId)) {
    throw new BenchmarkSelectionError(`Feature ${featureId} is not available for benchmark ${manifest.id}`);
  }

  const result = await runBenchmarkMockFlow({
    manifestPath,
    workspaceRoot,
    featureIds: [featureId],
    configurationIds: [configurationId]
  });
  const snapshot = result.snapshots[0];

  if (!snapshot) {
    throw new Error(`No RunSnapshot was produced for ${manifest.id}/${configurationId}/${featureId}`);
  }

  return snapshot;
}

export async function resolveWorkspaceRoot(): Promise<string> {
  const candidates = [
    process.env.MANYHANDS_REPO_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), "../..")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const root = path.resolve(candidate);

    if (await hasKnownBenchmark(root)) {
      return root;
    }
  }

  throw new Error("Unable to resolve ManyHands workspace root. Set MANYHANDS_REPO_ROOT to the repository root.");
}

function getRegistryEntry(id: string): (typeof benchmarkRegistry)[number] {
  const entry = benchmarkRegistry.find((candidate) => candidate.id === id);

  if (!entry) {
    throw new BenchmarkNotFoundError(id);
  }

  return entry;
}

function summarizeManifest(manifest: BenchmarkManifest, manifestPath: string): BenchmarkSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    manifestPath,
    configurations: manifest.configurations.map((configuration) => configuration.id),
    featureCount: manifest.features.length
  };
}

function parseConfigurationSelection(
  config: unknown,
  manifest: BenchmarkManifest
): EvaluationConfiguration | undefined {
  if (config === undefined || config === null || config === "") {
    return undefined;
  }

  const parsed = EvaluationConfigurationSchema.safeParse(config);

  if (!parsed.success) {
    throw new BenchmarkSelectionError(`Unsupported benchmark configuration id: ${String(config)}`);
  }

  if (!manifest.configurations.some((configuration) => configuration.id === parsed.data)) {
    throw new BenchmarkSelectionError(`Configuration ${parsed.data} is not available for benchmark ${manifest.id}`);
  }

  return parsed.data;
}

function parseRequiredConfigurationSelection(
  config: unknown,
  manifest: BenchmarkManifest
): EvaluationConfiguration {
  const parsed = parseConfigurationSelection(config, manifest);

  if (parsed === undefined) {
    throw new BenchmarkSelectionError(`A configuration is required for benchmark ${manifest.id}`);
  }

  return parsed;
}

function defaultDemoFeatureId(manifest: BenchmarkManifest): string {
  if (
    manifest.id === "conflict-v0" &&
    manifest.features.some((feature) => feature.id === "shared-schema-conflict")
  ) {
    return "shared-schema-conflict";
  }

  const firstFeature = manifest.features[0];

  if (!firstFeature) {
    throw new BenchmarkSelectionError(`Benchmark ${manifest.id} does not declare any features`);
  }

  return firstFeature.id;
}

function defaultDemoConfigurationId(manifest: BenchmarkManifest): EvaluationConfiguration {
  if (manifest.configurations.some((configuration) => configuration.id === "B4")) {
    return "B4";
  }

  const firstConfiguration = manifest.configurations[0];

  if (!firstConfiguration) {
    throw new BenchmarkSelectionError(`Benchmark ${manifest.id} does not declare any configurations`);
  }

  return firstConfiguration.id;
}

async function hasKnownBenchmark(candidateRoot: string): Promise<boolean> {
  try {
    await access(path.resolve(candidateRoot, "benchmarks/mock-v0/benchmark.json"));
    await access(path.resolve(candidateRoot, "benchmarks/conflict-v0/benchmark.json"));
    return true;
  } catch {
    return false;
  }
}

export class BenchmarkNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown benchmark id: ${id}`);
    this.name = "BenchmarkNotFoundError";
  }
}

export class BenchmarkSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkSelectionError";
  }
}

export function isBenchmarkId(id: string): id is BenchmarkId {
  return benchmarkRegistry.some((entry) => entry.id === id);
}
