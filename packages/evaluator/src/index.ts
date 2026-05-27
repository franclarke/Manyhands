import { DecompositionModeSchema, FeatureRequestSchema } from "@manyhands/decomposer";
import {
  RUN_SNAPSHOT_SCHEMA_VERSION,
  RunSnapshotSchema,
  computeStableHash,
  type RunSnapshot
} from "@manyhands/run-store";
import {
  HumanGateMetricsSchema,
  SchedulingPolicySchema
} from "@manyhands/scheduler";
import { IsoTimestampSchema, nowIso, uniqueValues } from "@manyhands/shared";
import { z } from "zod";

export const EVALUATION_REPORT_SCHEMA_VERSION = "manyhands.evaluation-report.v1";
export const BENCHMARK_MANIFEST_SCHEMA_VERSION = "manyhands.benchmark-manifest.v1";
export const BENCHMARK_REPORT_SCHEMA_VERSION = "manyhands.benchmark-report.v2";
export const EVALUATOR_VERSION = "0.1.0";

export const EvaluationConfigurationSchema = z.union([
  z.literal("B0"),
  z.literal("B1"),
  z.literal("B2"),
  z.literal("B3"),
  z.literal("B4")
]);

export type EvaluationConfiguration = z.infer<typeof EvaluationConfigurationSchema>;

export const EvaluationGranularitySchema = DecompositionModeSchema;

export type EvaluationGranularity = z.infer<typeof EvaluationGranularitySchema>;

export const EvaluationModeSchema = z.union([
  z.literal("mock_structural"),
  z.literal("mock_execution"),
  z.literal("granularity_comparison")
]);

export type EvaluationMode = z.infer<typeof EvaluationModeSchema>;

export const EvaluationWarningCodeSchema = z.union([
  z.literal("mock_execution_only"),
  z.literal("no_real_agent_results"),
  z.literal("no_real_tests_executed"),
  z.literal("small_fixture_only"),
  z.literal("static_signals_are_heuristic"),
  z.literal("snapshot_schema_mismatch"),
  z.literal("missing_static_signals"),
  z.literal("missing_hashes"),
  z.literal("incompatible_feature_ids"),
  z.literal("duplicate_decomposition_mode"),
  z.literal("single_task_baseline_is_structural"),
  z.literal("benchmark_mock_only"),
  z.literal("human_gate_is_mock"),
  z.literal("controlled_conflict_fixture"),
  z.literal("blocking_risk_does_not_equal_real_merge_conflict"),
  z.literal("scope_violation_is_simulated")
]);

export type EvaluationWarningCode = z.infer<typeof EvaluationWarningCodeSchema>;

export const EvaluationWarningSchema = z.object({
  code: EvaluationWarningCodeSchema,
  severity: z.union([z.literal("warning"), z.literal("error")]),
  message: z.string().min(1),
  runId: z.string().min(1).optional()
});

export type EvaluationWarning = z.infer<typeof EvaluationWarningSchema>;

export const EvaluationRunDescriptorSchema = z.object({
  id: z.string().min(1),
  configuration: EvaluationConfigurationSchema,
  granularity: EvaluationGranularitySchema,
  planId: z.string().min(1),
  seed: z.string().min(1),
  modelVersion: z.string().min(1)
});

export type EvaluationRunDescriptor = z.infer<typeof EvaluationRunDescriptorSchema>;

export const GraphMetricsSchema = z.object({
  taskCount: z.number().int().nonnegative(),
  leafCount: z.number().int().nonnegative(),
  compositeCount: z.number().int().nonnegative(),
  dependencyCount: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  avgDependenciesPerLeaf: z.number().nonnegative()
});

export type GraphMetrics = z.infer<typeof GraphMetricsSchema>;

export const ContractMetricsSchema = z.object({
  contractCount: z.number().int().nonnegative(),
  avgAllowedPathsPerContract: z.number().nonnegative(),
  avgAcceptanceCriteriaPerContract: z.number().nonnegative(),
  avgValidationCommandsPerContract: z.number().nonnegative()
});

export type ContractMetrics = z.infer<typeof ContractMetricsSchema>;

export const ConflictRiskMetricsSchema = z.object({
  predictionCount: z.number().int().nonnegative(),
  lowCount: z.number().int().nonnegative(),
  mediumCount: z.number().int().nonnegative(),
  highCount: z.number().int().nonnegative(),
  blockingCount: z.number().int().nonnegative(),
  staticSignalCount: z.number().int().nonnegative(),
  staticHighOrBlockingCount: z.number().int().nonnegative()
});

export type ConflictRiskMetrics = z.infer<typeof ConflictRiskMetricsSchema>;

export const SchedulingMetricsSchema = z.object({
  batchCount: z.number().int().nonnegative(),
  avgBatchSize: z.number().nonnegative(),
  maxBatchSize: z.number().int().nonnegative(),
  blockedTaskCount: z.number().int().nonnegative(),
  estimatedParallelism: z.number().nonnegative()
});

export type SchedulingMetrics = z.infer<typeof SchedulingMetricsSchema>;

export const ExecutionMetricsSchema = z.object({
  executedTasks: z.number().int().nonnegative(),
  succeededTasks: z.number().int().nonnegative(),
  failedTasks: z.number().int().nonnegative(),
  scopeViolationCount: z.number().int().nonnegative(),
  simulatedDiffCount: z.number().int().nonnegative(),
  simulatedDurationMs: z.number().int().nonnegative(),
  estimatedWallClockMs: z.number().int().nonnegative(),
  simulatedCostUsd: z.number().nonnegative(),
  validationCommandCount: z.number().int().nonnegative()
});

export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export const TraceabilityMetricsSchema = z.object({
  traceEventCount: z.number().int().nonnegative(),
  traceEventsPerTask: z.number().nonnegative(),
  hasInputHash: z.boolean(),
  hasOutputHash: z.boolean()
});

export type TraceabilityMetrics = z.infer<typeof TraceabilityMetricsSchema>;

export const CoordinationMetricsSchema = z.object({
  coordinationOverheadUnits: z.number().int().nonnegative(),
  contractToLeafRatio: z.number().nonnegative()
});

export type CoordinationMetrics = z.infer<typeof CoordinationMetricsSchema>;

export const EmptyHumanGateMetrics = HumanGateMetricsSchema.parse({
  gateRequiredCount: 0,
  approvedParallelCount: 0,
  serializedByGateCount: 0,
  blockedByGateCount: 0,
  mockReviewCount: 0
});

export const RunMetricsSchema = z.object({
  featureId: z.string().min(1),
  runId: z.string().min(1),
  decompositionMode: DecompositionModeSchema,
  graph: GraphMetricsSchema,
  contracts: ContractMetricsSchema,
  conflictRisk: ConflictRiskMetricsSchema,
  scheduling: SchedulingMetricsSchema,
  execution: ExecutionMetricsSchema,
  traceability: TraceabilityMetricsSchema,
  coordination: CoordinationMetricsSchema,
  humanGate: HumanGateMetricsSchema
});

export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const EvaluatedRunSchema = z.object({
  runId: z.string().min(1),
  featureId: z.string().min(1),
  decompositionMode: DecompositionModeSchema,
  status: z.string().min(1),
  inputHash: z.string().min(1).optional(),
  outputHash: z.string().min(1).optional(),
  repositoryIndexHash: z.string().min(1).optional(),
  metrics: RunMetricsSchema,
  warnings: z.array(EvaluationWarningSchema)
});

export type EvaluatedRun = z.infer<typeof EvaluatedRunSchema>;

export const GranularityComparisonRowSchema = z.object({
  mode: DecompositionModeSchema,
  leafCount: z.number().int().nonnegative(),
  dependencyCount: z.number().int().nonnegative(),
  riskPredictionCount: z.number().int().nonnegative(),
  staticSignalCount: z.number().int().nonnegative(),
  highRiskCount: z.number().int().nonnegative(),
  blockingRiskCount: z.number().int().nonnegative(),
  batchCount: z.number().int().nonnegative(),
  avgBatchSize: z.number().nonnegative(),
  simulatedDurationMs: z.number().int().nonnegative(),
  estimatedWallClockMs: z.number().int().nonnegative(),
  scopeViolationCount: z.number().int().nonnegative(),
  traceEventCount: z.number().int().nonnegative(),
  coordinationOverheadUnits: z.number().int().nonnegative(),
  inputHash: z.string().min(1).optional(),
  outputHash: z.string().min(1).optional()
});

export type GranularityComparisonRow = z.infer<typeof GranularityComparisonRowSchema>;

export const GranularityObservationCodeSchema = z.union([
  z.literal("fine_increases_coordination_surface"),
  z.literal("coarse_reduces_batches"),
  z.literal("balanced_is_intermediate"),
  z.literal("mock_structural_only")
]);

export type GranularityObservationCode = z.infer<typeof GranularityObservationCodeSchema>;

export const GranularityObservationSchema = z.object({
  code: GranularityObservationCodeSchema,
  message: z.string().min(1)
});

export type GranularityObservation = z.infer<typeof GranularityObservationSchema>;

export const GranularityComparisonSchema = z.object({
  featureId: z.string().min(1),
  rows: z.array(GranularityComparisonRowSchema),
  observations: z.array(GranularityObservationSchema),
  warnings: z.array(EvaluationWarningSchema)
});

export type GranularityComparison = z.infer<typeof GranularityComparisonSchema>;

export const EvaluationReportMetadataSchema = z.object({
  schemaVersion: z.literal(EVALUATION_REPORT_SCHEMA_VERSION),
  evaluatorVersion: z.string().min(1),
  deterministic: z.boolean(),
  reportHash: z.string().min(1).optional()
});

export type EvaluationReportMetadata = z.infer<typeof EvaluationReportMetadataSchema>;

export const EvaluationReportSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoTimestampSchema,
  mode: EvaluationModeSchema,
  runs: z.array(EvaluatedRunSchema),
  comparison: GranularityComparisonSchema.optional(),
  warnings: z.array(EvaluationWarningSchema),
  metadata: EvaluationReportMetadataSchema
});

export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

export const BenchmarkDecompositionModeSchema = z.union([
  z.literal("single"),
  DecompositionModeSchema
]);

export type BenchmarkDecompositionMode = z.infer<typeof BenchmarkDecompositionModeSchema>;

export const BenchmarkFeatureSchema = FeatureRequestSchema.extend({
  tags: z.array(z.string().min(1)).default([]),
  expectedModules: z.array(z.string().min(1)).min(1),
  expectedRiskAreas: z.array(z.string().min(1)).default([]),
  expectedConflictNotes: z.array(z.string().min(1)).default([]),
  fixtureVersion: z.string().min(1),
  controlledScenarios: z.array(z.string().min(1)).default([]),
  mockRunOverrides: z.record(z.object({
    changedFiles: z.array(z.string().min(1)).optional(),
    reportedSymbols: z.array(z.string().min(1)).optional(),
    executedValidationCommands: z.array(z.string().min(1)).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    fail: z.boolean().optional(),
    reason: z.string().min(1).optional()
  })).default({}),
  expectedMockOutcomes: z.object({
    scopeViolations: z.number().int().nonnegative().optional(),
    failedTasks: z.number().int().nonnegative().optional(),
    gateRequired: z.number().int().nonnegative().optional()
  }).default({})
});

export type BenchmarkFeature = z.infer<typeof BenchmarkFeatureSchema>;

export const BenchmarkFeatureRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  fixtureVersion: z.string().min(1).optional()
});

export type BenchmarkFeatureRef = z.infer<typeof BenchmarkFeatureRefSchema>;

export const BenchmarkConfigurationSchema = z.object({
  id: EvaluationConfigurationSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  decompositionMode: BenchmarkDecompositionModeSchema,
  schedulerPolicy: SchedulingPolicySchema,
  staticSignals: z.boolean(),
  repositoryIndex: z.boolean(),
  humanGate: z.boolean()
});

export type BenchmarkConfiguration = z.infer<typeof BenchmarkConfigurationSchema>;

export const BenchmarkManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  repositoryFixture: z.string().min(1),
  features: z.array(BenchmarkFeatureRefSchema).min(1),
  configurations: z.array(BenchmarkConfigurationSchema).min(1),
  metadata: z.object({
    schemaVersion: z.literal(BENCHMARK_MANIFEST_SCHEMA_VERSION),
    deterministic: z.boolean(),
    createdFor: z.literal("mock_structural_evaluation")
  })
});

export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

export const BenchmarkEvaluatedRunSchema = z.object({
  configurationId: EvaluationConfigurationSchema,
  configurationName: z.string().min(1),
  featureId: z.string().min(1),
  runId: z.string().min(1),
  inputHash: z.string().min(1).optional(),
  outputHash: z.string().min(1).optional(),
  metrics: RunMetricsSchema,
  warnings: z.array(EvaluationWarningSchema)
});

export type BenchmarkEvaluatedRun = z.infer<typeof BenchmarkEvaluatedRunSchema>;

export const BenchmarkConfigurationMetricsSchema = z.object({
  configurationId: EvaluationConfigurationSchema,
  configurationName: z.string().min(1),
  runCount: z.number().int().nonnegative(),
  avgLeafCount: z.number().nonnegative(),
  avgDependencyCount: z.number().nonnegative(),
  avgStaticSignalCount: z.number().nonnegative(),
  avgHighRiskCount: z.number().nonnegative(),
  avgBlockingRiskCount: z.number().nonnegative(),
  avgBatchCount: z.number().nonnegative(),
  avgSimulatedDurationMs: z.number().nonnegative(),
  avgEstimatedWallClockMs: z.number().nonnegative(),
  avgTraceEventCount: z.number().nonnegative(),
  totalScopeViolations: z.number().int().nonnegative(),
  avgCoordinationOverheadUnits: z.number().nonnegative(),
  avgGateRequiredCount: z.number().nonnegative(),
  avgSerializedByGateCount: z.number().nonnegative(),
  avgBlockedByGateCount: z.number().nonnegative(),
  avgMockReviewCount: z.number().nonnegative(),
  warningCount: z.number().int().nonnegative()
});

export type BenchmarkConfigurationMetrics = z.infer<typeof BenchmarkConfigurationMetricsSchema>;

export const BenchmarkObservationCodeSchema = z.union([
  z.literal("b0_reduces_coordination_but_concentrates_scope"),
  z.literal("b1_sequential_control_without_parallelism"),
  z.literal("b2_parallelizes_without_risk_awareness"),
  z.literal("b3_adds_risk_analysis_overhead"),
  z.literal("b4_adds_mock_human_gate"),
  z.literal("benchmark_structural_mock_only")
]);

export type BenchmarkObservationCode = z.infer<typeof BenchmarkObservationCodeSchema>;

export const BenchmarkObservationSchema = z.object({
  code: BenchmarkObservationCodeSchema,
  message: z.string().min(1)
});

export type BenchmarkObservation = z.infer<typeof BenchmarkObservationSchema>;

export const BenchmarkReportMetadataSchema = z.object({
  schemaVersion: z.literal(BENCHMARK_REPORT_SCHEMA_VERSION),
  evaluatorVersion: z.string().min(1),
  deterministic: z.boolean(),
  reportHash: z.string().min(1).optional()
});

export type BenchmarkReportMetadata = z.infer<typeof BenchmarkReportMetadataSchema>;

export const BenchmarkReportSchema = z.object({
  id: z.string().min(1),
  benchmarkId: z.string().min(1),
  benchmarkVersion: z.string().min(1),
  createdAt: IsoTimestampSchema,
  featureIds: z.array(z.string().min(1)),
  configurationIds: z.array(EvaluationConfigurationSchema),
  runs: z.array(BenchmarkEvaluatedRunSchema),
  configurations: z.array(BenchmarkConfigurationMetricsSchema),
  warnings: z.array(EvaluationWarningSchema),
  observations: z.array(BenchmarkObservationSchema),
  metadata: BenchmarkReportMetadataSchema
});

export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>;

export interface BenchmarkRunSnapshotInput {
  configurationId: EvaluationConfiguration;
  snapshot: RunSnapshot;
}

export interface EvaluateBenchmarkRunsInput {
  manifest: BenchmarkManifest;
  runs: readonly BenchmarkRunSnapshotInput[];
  createdAt?: string;
}

export interface EvaluateRunSnapshotsOptions {
  mode?: EvaluationMode;
  createdAt?: string;
}

export function evaluateRunSnapshot(snapshotInput: RunSnapshot): EvaluatedRun {
  const snapshot = RunSnapshotSchema.parse(snapshotInput);
  const evaluated: EvaluatedRun = {
    runId: snapshot.runId,
    featureId: snapshot.featureId,
    decompositionMode: snapshot.decompositionMode,
    status: snapshot.status,
    metrics: buildRunMetrics(snapshot),
    warnings: runWarnings(snapshot)
  };

  if (snapshot.metadata.inputHash !== undefined) {
    evaluated.inputHash = snapshot.metadata.inputHash;
  }

  if (snapshot.metadata.outputHash !== undefined) {
    evaluated.outputHash = snapshot.metadata.outputHash;
  }

  if (snapshot.repositoryIndexHash !== undefined) {
    evaluated.repositoryIndexHash = snapshot.repositoryIndexHash;
  }

  return EvaluatedRunSchema.parse(evaluated);
}

export function evaluateRunSnapshots(
  snapshotsInput: readonly RunSnapshot[],
  options: EvaluateRunSnapshotsOptions = {}
): EvaluationReport {
  const snapshots = snapshotsInput.map((snapshot) => RunSnapshotSchema.parse(snapshot));
  const runs = snapshots.map(evaluateRunSnapshot);
  const mode = options.mode ?? (snapshots.length > 1 ? "granularity_comparison" : "mock_execution");
  const comparison = mode === "granularity_comparison"
    ? compareGranularitySnapshots(snapshots)
    : undefined;
  const warnings = aggregateReportWarnings([
    ...runs.flatMap((run) => run.warnings),
    ...compatibilityWarnings(snapshots),
    ...(comparison?.warnings ?? [])
  ]);
  const featureIds = uniqueValues(snapshots.map((snapshot) => snapshot.featureId));
  const featureId = featureIds.length === 1 ? featureIds[0] : "mixed-features";
  const reportInput: EvaluationReport = {
    id: `${featureId ?? "unknown"}:${mode}:mock-eval`,
    createdAt: options.createdAt ?? nowIso(),
    mode,
    runs,
    warnings,
    metadata: {
      schemaVersion: EVALUATION_REPORT_SCHEMA_VERSION,
      evaluatorVersion: EVALUATOR_VERSION,
      deterministic: true
    }
  };

  if (comparison !== undefined) {
    reportInput.comparison = comparison;
  }

  return withEvaluationReportHash(reportInput);
}

export function compareRunSnapshots(aInput: RunSnapshot, bInput: RunSnapshot): EvaluationWarning[] {
  const a = RunSnapshotSchema.parse(aInput);
  const b = RunSnapshotSchema.parse(bInput);
  return uniqueWarnings(pairCompatibilityWarnings(a, b));
}

export function compareGranularitySnapshots(snapshotsInput: readonly RunSnapshot[]): GranularityComparison {
  const snapshots = snapshotsInput.map((snapshot) => RunSnapshotSchema.parse(snapshot));
  const runs = snapshots.map(evaluateRunSnapshot);
  const rows = runs
    .map((run) => rowFromRun(run))
    .sort((left, right) => modeRank(left.mode) - modeRank(right.mode));
  const featureIds = uniqueValues(snapshots.map((snapshot) => snapshot.featureId));
  const comparisonInput: GranularityComparison = {
    featureId: featureIds.length === 1 ? featureIds[0] ?? "unknown" : "mixed-features",
    rows,
    observations: observationsForRows(rows),
    warnings: compatibilityWarnings(snapshots)
  };

  return GranularityComparisonSchema.parse(comparisonInput);
}

export function computeEvaluationReportHash(report: EvaluationReport): string {
  return computeStableHash(normalizeEvaluationReportForHash(report));
}

export function withEvaluationReportHash(report: EvaluationReport): EvaluationReport {
  const parsed = EvaluationReportSchema.parse(report);
  const reportHash = computeEvaluationReportHash(parsed);

  return EvaluationReportSchema.parse({
    ...parsed,
    metadata: {
      ...parsed.metadata,
      reportHash
    }
  });
}

export function parseEvaluationReport(input: unknown): EvaluationReport {
  return EvaluationReportSchema.parse(input);
}

export function parseBenchmarkManifest(input: unknown): BenchmarkManifest {
  return BenchmarkManifestSchema.parse(input);
}

export function parseBenchmarkFeature(input: unknown): BenchmarkFeature {
  return BenchmarkFeatureSchema.parse(input);
}

export function parseBenchmarkReport(input: unknown): BenchmarkReport {
  return BenchmarkReportSchema.parse(input);
}

export function evaluateBenchmarkRuns(input: EvaluateBenchmarkRunsInput): BenchmarkReport {
  const manifest = BenchmarkManifestSchema.parse(input.manifest);
  const configurationById = new Map(manifest.configurations.map((configuration) => [configuration.id, configuration]));
  const runs = input.runs.map((runInput) => {
    const configuration = configurationById.get(runInput.configurationId);

    if (!configuration) {
      throw new Error(`Unknown benchmark configuration ${runInput.configurationId}`);
    }

    const evaluated = evaluateRunSnapshot(runInput.snapshot);
    const benchmarkRun: BenchmarkEvaluatedRun = {
      configurationId: configuration.id,
      configurationName: configuration.name,
      featureId: evaluated.featureId,
      runId: evaluated.runId,
      metrics: evaluated.metrics,
      warnings: evaluated.warnings
    };

    if (evaluated.inputHash !== undefined) {
      benchmarkRun.inputHash = evaluated.inputHash;
    }

    if (evaluated.outputHash !== undefined) {
      benchmarkRun.outputHash = evaluated.outputHash;
    }

    return BenchmarkEvaluatedRunSchema.parse(benchmarkRun);
  });
  const usedConfigurationIds = uniqueValues(runs.map((run) => run.configurationId));
  const configurations = manifest.configurations
    .filter((configuration) => usedConfigurationIds.includes(configuration.id))
    .map((configuration) => aggregateConfigurationMetrics(
      configuration,
      runs.filter((run) => run.configurationId === configuration.id)
    ));
  const featureIds = uniqueValues(runs.map((run) => run.featureId)).sort();
  const warnings = aggregateReportWarnings([
    ...runs.flatMap((run) => run.warnings),
    warning("benchmark_mock_only", "warning", "This benchmark is deterministic and mock-only; it is not empirical evidence of code quality."),
    ...(usedConfigurationIds.includes("B0")
      ? [
          warning(
            "single_task_baseline_is_structural",
            "warning",
            "B0 is a structural single-task baseline, not a real single-agent execution."
          )
        ]
      : [])
  ]);
  const report: BenchmarkReport = {
    id: `${manifest.id}:benchmark-report`,
    benchmarkId: manifest.id,
    benchmarkVersion: manifest.version,
    createdAt: input.createdAt ?? nowIso(),
    featureIds,
    configurationIds: usedConfigurationIds,
    runs,
    configurations,
    warnings,
    observations: benchmarkObservations(usedConfigurationIds),
    metadata: {
      schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
      evaluatorVersion: EVALUATOR_VERSION,
      deterministic: true
    }
  };

  return withBenchmarkReportHash(report);
}

export function computeBenchmarkReportHash(report: BenchmarkReport): string {
  return computeStableHash(normalizeBenchmarkReportForHash(BenchmarkReportSchema.parse(report)));
}

export function withBenchmarkReportHash(report: BenchmarkReport): BenchmarkReport {
  const parsed = BenchmarkReportSchema.parse(report);
  const reportHash = computeBenchmarkReportHash(parsed);

  return BenchmarkReportSchema.parse({
    ...parsed,
    metadata: {
      ...parsed.metadata,
      reportHash
    }
  });
}

function buildRunMetrics(snapshot: RunSnapshot): RunMetrics {
  const nodes = Object.values(snapshot.graphSnapshot.nodes);
  const leaves = nodes.filter((node) => node.kind === "leaf");
  const composites = nodes.filter((node) => node.kind === "composite");
  const leafIds = new Set(leaves.map((node) => node.id));
  const dependencyCountForLeaves = snapshot.graphSnapshot.dependencies
    .filter((dependency) => leafIds.has(dependency.toTaskId))
    .length;
  const batchSizes = snapshot.scheduledBatches.map((batch) => batch.taskIds.length);
  const resultDurations = new Map(snapshot.agentRunResults.map((result) => [result.taskId, result.metrics.durationMs]));
  const estimatedWallClockMs = snapshot.scheduledBatches.reduce((total, batch) => {
    const batchDuration = Math.max(0, ...batch.taskIds.map((taskId) => resultDurations.get(taskId) ?? 0));
    return total + batchDuration;
  }, 0);
  const staticHighOrBlockingCount = snapshot.staticConflictSignals
    .filter((signal) => signal.severity === "high" || signal.severity === "blocking")
    .length;
  const scopeViolationCount = snapshot.scopeValidationResults.reduce(
    (total, result) => total + result.violations.length,
    0
  );
  const humanGate = humanGateMetricsFromTraceEvents(snapshot.traceEvents);
  const validationCommandCount = snapshot.agentRunResults.reduce(
    (total, result) => total + result.validation.checks.filter((check) => check.command !== undefined).length,
    0
  );
  const metrics: RunMetrics = {
    featureId: snapshot.featureId,
    runId: snapshot.runId,
    decompositionMode: snapshot.decompositionMode,
    graph: {
      taskCount: nodes.length,
      leafCount: leaves.length,
      compositeCount: composites.length,
      dependencyCount: snapshot.graphSnapshot.dependencies.length,
      maxDepth: Math.max(0, ...nodes.map((node) => node.depth)),
      avgDependenciesPerLeaf: average(dependencyCountForLeaves, leaves.length)
    },
    contracts: {
      contractCount: snapshot.contracts.length,
      avgAllowedPathsPerContract: average(
        snapshot.contracts.reduce((total, contract) => total + contract.allowed.paths.length, 0),
        snapshot.contracts.length
      ),
      avgAcceptanceCriteriaPerContract: average(
        snapshot.contracts.reduce((total, contract) => total + contract.acceptance.length, 0),
        snapshot.contracts.length
      ),
      avgValidationCommandsPerContract: average(
        snapshot.contracts.reduce((total, contract) => total + contract.validationCommands.length, 0),
        snapshot.contracts.length
      )
    },
    conflictRisk: {
      predictionCount: snapshot.riskPredictions.length,
      lowCount: snapshot.riskPredictions.filter((prediction) => prediction.level === "low").length,
      mediumCount: snapshot.riskPredictions.filter((prediction) => prediction.level === "medium").length,
      highCount: snapshot.riskPredictions.filter((prediction) => prediction.level === "high").length,
      blockingCount: snapshot.riskPredictions.filter((prediction) => prediction.level === "blocking").length,
      staticSignalCount: snapshot.staticConflictSignals.length,
      staticHighOrBlockingCount
    },
    scheduling: {
      batchCount: snapshot.scheduledBatches.length,
      avgBatchSize: average(sum(batchSizes), snapshot.scheduledBatches.length),
      maxBatchSize: Math.max(0, ...batchSizes),
      blockedTaskCount: snapshot.blockedTasks.length,
      estimatedParallelism: average(snapshot.agentRunResults.length || leaves.length, snapshot.scheduledBatches.length)
    },
    execution: {
      executedTasks: snapshot.agentRunResults.length,
      succeededTasks: snapshot.agentRunResults.filter((result) => result.success).length,
      failedTasks: snapshot.agentRunResults.filter((result) => !result.success).length,
      scopeViolationCount,
      simulatedDiffCount: snapshot.agentRunResults.filter((result) => result.diff.trim().length > 0).length,
      simulatedDurationMs: snapshot.agentRunResults.reduce((total, result) => total + result.metrics.durationMs, 0),
      estimatedWallClockMs,
      simulatedCostUsd: round(snapshot.agentRunResults.reduce((total, result) => total + result.metrics.costUsd, 0)),
      validationCommandCount
    },
    traceability: {
      traceEventCount: snapshot.traceEvents.length,
      traceEventsPerTask: average(snapshot.traceEvents.length, leaves.length),
      hasInputHash: snapshot.metadata.inputHash !== undefined,
      hasOutputHash: snapshot.metadata.outputHash !== undefined
    },
    coordination: {
      coordinationOverheadUnits:
        snapshot.contracts.length +
        snapshot.graphSnapshot.dependencies.length +
        snapshot.riskPredictions.length +
        snapshot.staticConflictSignals.length +
        snapshot.scheduledBatches.length +
        humanGate.gateRequiredCount +
        humanGate.serializedByGateCount +
        humanGate.mockReviewCount,
      contractToLeafRatio: average(snapshot.contracts.length, leaves.length)
    },
    humanGate
  };

  return RunMetricsSchema.parse(metrics);
}

function runWarnings(snapshot: RunSnapshot): EvaluationWarning[] {
  const scopeViolationCount = snapshot.scopeValidationResults.reduce(
    (total, result) => total + result.violations.length,
    0
  );
  const warnings: EvaluationWarning[] = [
    warning("mock_execution_only", "warning", "This evaluation uses deterministic mock execution only.", snapshot.runId),
    warning("no_real_agent_results", "warning", "No real LLM coding agent results are included.", snapshot.runId),
    warning("no_real_tests_executed", "warning", "Validation commands are simulated; no target repository tests were executed.", snapshot.runId),
    warning("small_fixture_only", "warning", "The run is based on a small controlled fixture, not a benchmark dataset.", snapshot.runId)
  ];

  if (snapshot.staticConflictSignals.length > 0) {
    warnings.push(warning(
      "static_signals_are_heuristic",
      "warning",
      "Static conflict signals are heuristic v0 signals, not complete semantic conflict detection.",
      snapshot.runId
    ));
  } else {
    warnings.push(warning(
      "missing_static_signals",
      "warning",
      "The snapshot does not include repository-informed static conflict signals.",
      snapshot.runId
    ));
  }

  if (snapshot.metadata.inputHash === undefined || snapshot.metadata.outputHash === undefined) {
    warnings.push(warning(
      "missing_hashes",
      "warning",
      "The snapshot is missing input or output hashes needed for reproducibility checks.",
      snapshot.runId
    ));
  }

  if (snapshot.traceEvents.some((event) => event.type.startsWith("human_gate_") || event.type.includes("_by_gate"))) {
    warnings.push(warning(
      "human_gate_is_mock",
      "warning",
      "Human gate decisions are deterministic mock decisions, not real human review.",
      snapshot.runId
    ));
  }

  if (snapshot.metadata.datasetVersion?.startsWith("conflict-v0") === true) {
    warnings.push(warning(
      "controlled_conflict_fixture",
      "warning",
      "This run uses a controlled conflict fixture designed to provoke conflict signals.",
      snapshot.runId
    ));
  }

  if (snapshot.riskPredictions.some((prediction) => prediction.level === "blocking")) {
    warnings.push(warning(
      "blocking_risk_does_not_equal_real_merge_conflict",
      "warning",
      "A blocking risk is a heuristic orchestration signal and does not prove a real merge conflict.",
      snapshot.runId
    ));
  }

  if (scopeViolationCount > 0) {
    warnings.push(warning(
      "scope_violation_is_simulated",
      "warning",
      "Scope violations in this benchmark are deterministic mock runner outcomes.",
      snapshot.runId
    ));
  }

  return uniqueWarnings(warnings);
}

function compatibilityWarnings(snapshots: readonly RunSnapshot[]): EvaluationWarning[] {
  const warnings: EvaluationWarning[] = [];

  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];

      if (left && right) {
        warnings.push(...pairCompatibilityWarnings(left, right));
      }
    }
  }

  const modes = snapshots.map((snapshot) => snapshot.decompositionMode);
  const duplicateModes = uniqueValues(modes)
    .filter((mode) => modes.filter((candidate) => candidate === mode).length > 1);

  for (const mode of duplicateModes) {
    warnings.push(warning(
      "duplicate_decomposition_mode",
      "warning",
      `Multiple snapshots use decomposition mode ${mode}.`
    ));
  }

  return uniqueWarnings(warnings);
}

function pairCompatibilityWarnings(a: RunSnapshot, b: RunSnapshot): EvaluationWarning[] {
  const warnings: EvaluationWarning[] = [];

  if (a.featureId !== b.featureId) {
    warnings.push(warning(
      "incompatible_feature_ids",
      "error",
      `Snapshots compare different feature ids: ${a.featureId} and ${b.featureId}.`
    ));
  }

  if (a.metadata.schemaVersion !== b.metadata.schemaVersion || a.metadata.schemaVersion !== RUN_SNAPSHOT_SCHEMA_VERSION) {
    warnings.push(warning(
      "snapshot_schema_mismatch",
      "error",
      `Snapshot schema versions differ or are unsupported: ${a.metadata.schemaVersion} and ${b.metadata.schemaVersion}.`
    ));
  }

  if (a.decompositionMode === b.decompositionMode) {
    warnings.push(warning(
      "duplicate_decomposition_mode",
      "warning",
      `Snapshots ${a.runId} and ${b.runId} share decomposition mode ${a.decompositionMode}.`
    ));
  }

  return warnings;
}

function rowFromRun(run: EvaluatedRun): GranularityComparisonRow {
  return GranularityComparisonRowSchema.parse({
    mode: run.decompositionMode,
    leafCount: run.metrics.graph.leafCount,
    dependencyCount: run.metrics.graph.dependencyCount,
    riskPredictionCount: run.metrics.conflictRisk.predictionCount,
    staticSignalCount: run.metrics.conflictRisk.staticSignalCount,
    highRiskCount: run.metrics.conflictRisk.highCount,
    blockingRiskCount: run.metrics.conflictRisk.blockingCount,
    batchCount: run.metrics.scheduling.batchCount,
    avgBatchSize: run.metrics.scheduling.avgBatchSize,
    simulatedDurationMs: run.metrics.execution.simulatedDurationMs,
    estimatedWallClockMs: run.metrics.execution.estimatedWallClockMs,
    scopeViolationCount: run.metrics.execution.scopeViolationCount,
    traceEventCount: run.metrics.traceability.traceEventCount,
    coordinationOverheadUnits: run.metrics.coordination.coordinationOverheadUnits,
    inputHash: run.inputHash,
    outputHash: run.outputHash
  });
}

function aggregateConfigurationMetrics(
  configuration: BenchmarkConfiguration,
  runs: readonly BenchmarkEvaluatedRun[]
): BenchmarkConfigurationMetrics {
  const metrics = runs.map((run) => run.metrics);
  const runCount = runs.length;

  return BenchmarkConfigurationMetricsSchema.parse({
    configurationId: configuration.id,
    configurationName: configuration.name,
    runCount,
    avgLeafCount: average(sum(metrics.map((metric) => metric.graph.leafCount)), runCount),
    avgDependencyCount: average(sum(metrics.map((metric) => metric.graph.dependencyCount)), runCount),
    avgStaticSignalCount: average(sum(metrics.map((metric) => metric.conflictRisk.staticSignalCount)), runCount),
    avgHighRiskCount: average(sum(metrics.map((metric) => metric.conflictRisk.highCount)), runCount),
    avgBlockingRiskCount: average(sum(metrics.map((metric) => metric.conflictRisk.blockingCount)), runCount),
    avgBatchCount: average(sum(metrics.map((metric) => metric.scheduling.batchCount)), runCount),
    avgSimulatedDurationMs: average(sum(metrics.map((metric) => metric.execution.simulatedDurationMs)), runCount),
    avgEstimatedWallClockMs: average(sum(metrics.map((metric) => metric.execution.estimatedWallClockMs)), runCount),
    avgTraceEventCount: average(sum(metrics.map((metric) => metric.traceability.traceEventCount)), runCount),
    totalScopeViolations: sum(metrics.map((metric) => metric.execution.scopeViolationCount)),
    avgCoordinationOverheadUnits: average(
      sum(metrics.map((metric) => metric.coordination.coordinationOverheadUnits)),
      runCount
    ),
    avgGateRequiredCount: average(sum(metrics.map((metric) => metric.humanGate.gateRequiredCount)), runCount),
    avgSerializedByGateCount: average(sum(metrics.map((metric) => metric.humanGate.serializedByGateCount)), runCount),
    avgBlockedByGateCount: average(sum(metrics.map((metric) => metric.humanGate.blockedByGateCount)), runCount),
    avgMockReviewCount: average(sum(metrics.map((metric) => metric.humanGate.mockReviewCount)), runCount),
    warningCount: sum(runs.map((run) => run.warnings.length))
  });
}

function humanGateMetricsFromTraceEvents(traceEvents: readonly RunSnapshot["traceEvents"][number][]): z.infer<typeof HumanGateMetricsSchema> {
  const decisions = traceEvents
    .filter((event) => event.type === "human_gate_decision_recorded")
    .map((event) => event.payload.decision)
    .filter((decision): decision is { kind: string } =>
      typeof decision === "object" && decision !== null && "kind" in decision && typeof decision.kind === "string"
    );

  return HumanGateMetricsSchema.parse({
    gateRequiredCount: traceEvents
      .filter((event) => event.type === "human_gate_required")
      .reduce((total, event) => total + numberPayloadValue(event.payload.metrics, "gateRequiredCount"), 0),
    approvedParallelCount: decisions.filter((decision) => decision.kind === "approved_parallel").length,
    serializedByGateCount: decisions.filter((decision) =>
      decision.kind === "serialized" || decision.kind === "serialized_after_mock_review"
    ).length,
    blockedByGateCount: decisions.filter((decision) => decision.kind === "blocked").length,
    mockReviewCount: decisions.filter((decision) => decision.kind === "requires_manual_review").length
  });
}

function numberPayloadValue(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return 0;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : 0;
}

function benchmarkObservations(configurationIds: readonly EvaluationConfiguration[]): BenchmarkObservation[] {
  const observations: BenchmarkObservation[] = [
    {
      code: "benchmark_structural_mock_only",
      message: "This benchmark compares deterministic structural/mock signals only, not real code quality."
    }
  ];

  if (configurationIds.includes("B0")) {
    observations.push({
      code: "b0_reduces_coordination_but_concentrates_scope",
      message: "B0 minimizes visible coordination overhead by concentrating work into one structural mock task."
    });
  }

  if (configurationIds.includes("B1")) {
    observations.push({
      code: "b1_sequential_control_without_parallelism",
      message: "B1 preserves decomposed control but deliberately gives up parallel scheduling."
    });
  }

  if (configurationIds.includes("B2")) {
    observations.push({
      code: "b2_parallelizes_without_risk_awareness",
      message: "B2 schedules by DAG readiness and ignores risk-aware batch separation."
    });
  }

  if (configurationIds.includes("B3")) {
    observations.push({
      code: "b3_adds_risk_analysis_overhead",
      message: "B3 adds repository-informed conflict analysis and risk-aware scheduling overhead."
    });
  }

  if (configurationIds.includes("B4")) {
    observations.push({
      code: "b4_adds_mock_human_gate",
      message: "B4 adds deterministic mock human gate decisions for high and blocking risk signals."
    });
  }

  return observations.map((observation) => BenchmarkObservationSchema.parse(observation));
}

function observationsForRows(rows: readonly GranularityComparisonRow[]): GranularityObservation[] {
  const observations: GranularityObservation[] = [
    {
      code: "mock_structural_only",
      message: "This comparison reports structural and mock execution metrics only; it is not final empirical evidence."
    }
  ];
  const coarse = rows.find((row) => row.mode === "coarse");
  const balanced = rows.find((row) => row.mode === "balanced");
  const fine = rows.find((row) => row.mode === "fine");

  if (coarse && balanced && fine) {
    if (
      fine.coordinationOverheadUnits > balanced.coordinationOverheadUnits &&
      balanced.coordinationOverheadUnits >= coarse.coordinationOverheadUnits
    ) {
      observations.push({
        code: "fine_increases_coordination_surface",
        message: "The fine decomposition increases the coordination surface in this deterministic fixture."
      });
    }

    if (coarse.batchCount <= balanced.batchCount && coarse.batchCount <= fine.batchCount) {
      observations.push({
        code: "coarse_reduces_batches",
        message: "The coarse decomposition uses the fewest or tied-fewest batches in this fixture."
      });
    }

    if (
      isBetween(balanced.leafCount, coarse.leafCount, fine.leafCount) &&
      isBetween(balanced.coordinationOverheadUnits, coarse.coordinationOverheadUnits, fine.coordinationOverheadUnits)
    ) {
      observations.push({
        code: "balanced_is_intermediate",
        message: "The balanced decomposition sits between coarse and fine for leaves and coordination overhead."
      });
    }
  }

  return observations.map((observation) => GranularityObservationSchema.parse(observation));
}

function normalizeEvaluationReportForHash(report: EvaluationReport): unknown {
  const normalized: Record<string, unknown> = {
    ...report,
    metadata: {
      ...report.metadata
    }
  };

  delete normalized.createdAt;
  delete (normalized.metadata as Record<string, unknown>).reportHash;
  return normalized;
}

function normalizeBenchmarkReportForHash(report: BenchmarkReport): unknown {
  const normalized: Record<string, unknown> = {
    ...report,
    metadata: {
      ...report.metadata
    }
  };

  delete normalized.createdAt;
  delete (normalized.metadata as Record<string, unknown>).reportHash;
  return normalized;
}

function warning(
  code: EvaluationWarningCode,
  severity: EvaluationWarning["severity"],
  message: string,
  runId?: string
): EvaluationWarning {
  const input: EvaluationWarning = {
    code,
    severity,
    message
  };

  if (runId !== undefined) {
    input.runId = runId;
  }

  return EvaluationWarningSchema.parse(input);
}

function uniqueWarnings(warnings: readonly EvaluationWarning[]): EvaluationWarning[] {
  const seen = new Set<string>();
  const result: EvaluationWarning[] = [];

  for (const item of warnings) {
    const key = `${item.code}:${item.runId ?? ""}:${item.message}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result.sort((left, right) =>
    `${left.code}:${left.runId ?? ""}:${left.message}`.localeCompare(`${right.code}:${right.runId ?? ""}:${right.message}`)
  );
}

function aggregateReportWarnings(warnings: readonly EvaluationWarning[]): EvaluationWarning[] {
  const seen = new Set<string>();
  const result: EvaluationWarning[] = [];

  for (const item of warnings) {
    const key = `${item.code}:${item.severity}:${item.message}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(EvaluationWarningSchema.parse({
        code: item.code,
        severity: item.severity,
        message: item.message
      }));
    }
  }

  return result.sort((left, right) =>
    `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`)
  );
}

function average(total: number, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return round(total / count);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function modeRank(mode: EvaluationGranularity): number {
  if (mode === "coarse") {
    return 0;
  }

  if (mode === "balanced") {
    return 1;
  }

  return 2;
}

function isBetween(value: number, edgeA: number, edgeB: number): boolean {
  return (
    (value >= edgeA && value <= edgeB) ||
    (value >= edgeB && value <= edgeA)
  );
}
