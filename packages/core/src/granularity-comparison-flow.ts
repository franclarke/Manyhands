import path from "node:path";
import {
  evaluateRunSnapshots,
  type EvaluationReport
} from "@manyhands/evaluator";
import type { DecompositionMode } from "@manyhands/decomposer";
import {
  buildRepositoryIndex,
  computeRepositoryIndexHash,
  type RepositoryIndex
} from "@manyhands/repository-index";
import type { RunSnapshot } from "@manyhands/run-store";
import {
  runMockExecutionFlow,
  type MockExecutionFlowOptions,
  type MockExecutionFlowResult
} from "./mock-execution-flow";

export const DEFAULT_GRANULARITY_COMPARISON_MODES: readonly DecompositionMode[] = [
  "coarse",
  "balanced",
  "fine"
];

export interface GranularityComparisonFlowOptions {
  fixturePath?: string;
  repositoryPath?: string;
  repositoryId?: string;
  modes?: readonly DecompositionMode[];
  maxParallel?: number;
  withStaticSignals?: boolean;
  createdAt?: string;
  repositoryIndex?: RepositoryIndex;
  runnerOptions?: MockExecutionFlowOptions["runnerOptions"];
}

export interface GranularityComparisonFlowResult {
  runs: MockExecutionFlowResult[];
  snapshots: RunSnapshot[];
  report: EvaluationReport;
  repositoryIndex?: RepositoryIndex;
  repositoryIndexHash?: string;
}

const DEFAULT_FEATURE_FIXTURE_PATH = "examples/features/passwordless-login.json";
const DEFAULT_REPOSITORY_PATH = "examples/repos/aprobado-lite";
const DEFAULT_REPOSITORY_ID = "aprobado-lite";
const DEFAULT_MAX_PARALLEL = 3;

export async function runGranularityComparisonFlow(
  options: GranularityComparisonFlowOptions = {}
): Promise<GranularityComparisonFlowResult> {
  const fixturePath = path.resolve(options.fixturePath ?? DEFAULT_FEATURE_FIXTURE_PATH);
  const modes = [...(options.modes ?? DEFAULT_GRANULARITY_COMPARISON_MODES)];
  const withStaticSignals = options.withStaticSignals ?? true;
  const repositoryIndex = withStaticSignals
    ? options.repositoryIndex ?? await buildRepositoryIndex({
        rootPath: path.resolve(options.repositoryPath ?? DEFAULT_REPOSITORY_PATH),
        repositoryId: options.repositoryId ?? DEFAULT_REPOSITORY_ID
      })
    : undefined;
  const runs: MockExecutionFlowResult[] = [];

  for (const mode of modes) {
    runs.push(await runMockExecutionFlow({
      fixturePath,
      mode,
      maxParallel: options.maxParallel ?? DEFAULT_MAX_PARALLEL,
      ...(repositoryIndex ? { repositoryIndex } : {}),
      ...(options.runnerOptions ? { runnerOptions: options.runnerOptions } : {})
    }));
  }

  const snapshots = runs.map((run) => run.snapshot);
  const report = evaluateRunSnapshots(snapshots, {
    mode: "granularity_comparison",
    ...(options.createdAt ? { createdAt: options.createdAt } : {})
  });
  const result: GranularityComparisonFlowResult = {
    runs,
    snapshots,
    report
  };

  if (repositoryIndex !== undefined) {
    result.repositoryIndex = repositoryIndex;
    result.repositoryIndexHash = computeRepositoryIndexHash(repositoryIndex);
  }

  return result;
}
