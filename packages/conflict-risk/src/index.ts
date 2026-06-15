import type { AgentTaskContract } from "@manyhands/contracts";
import { RepositoryIndexSchema, type RepositoryFileIndex, type RepositoryIndex } from "@manyhands/repository-index";
import { clamp01, intersectValues, pairKey, uniqueValues } from "@manyhands/shared";
import { z } from "zod";

export const ConflictRiskLevelSchema = z.union([
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("blocking")
]);

export type ConflictRiskLevel = z.infer<typeof ConflictRiskLevelSchema>;

export const ConflictEvidenceSignalSchema = z.union([
  z.literal("file_overlap"),
  z.literal("path_overlap"),
  z.literal("symbol_overlap"),
  z.literal("producer_consumer"),
  z.literal("critical_path"),
  z.literal("shared_test_fixture"),
  z.literal("shared_type_change"),
  z.literal("explicit_dependency"),
  z.literal("static_same_declared_symbol_file"),
  z.literal("static_producer_consumer_symbol"),
  z.literal("static_shared_import_dependency"),
  z.literal("static_shared_schema_dependency"),
  z.literal("static_test_fixture_overlap"),
  z.literal("static_critical_file_overlap"),
  z.literal("static_missing_expected_file"),
  z.literal("static_missing_expected_symbol"),
  z.literal("static_public_api_surface_overlap")
]);

export type ConflictEvidenceSignal = z.infer<typeof ConflictEvidenceSignalSchema>;

export const ConflictEvidenceSchema = z.object({
  signal: ConflictEvidenceSignalSchema,
  detail: z.string().min(1),
  weight: z.number().nonnegative()
});

export type ConflictEvidence = z.infer<typeof ConflictEvidenceSchema>;

export const ConflictRiskScoreSchema = z.object({
  taskAId: z.string().min(1),
  taskBId: z.string().min(1),
  score: z.number().min(0).max(1),
  level: ConflictRiskLevelSchema,
  evidence: z.array(ConflictEvidenceSchema)
});

export type ConflictRiskScore = z.infer<typeof ConflictRiskScoreSchema>;

export const ConflictRecommendationSchema = z.union([
  z.literal("run_parallel"),
  z.literal("serialize"),
  z.literal("add_dependency"),
  z.literal("requires_human_review")
]);

export const ConflictPredictionSchema = z.object({
  taskAId: z.string().min(1),
  taskBId: z.string().min(1),
  level: ConflictRiskLevelSchema,
  score: z.number().min(0).max(1),
  evidence: z.array(ConflictEvidenceSchema),
  sharedFiles: z.array(z.string().min(1)),
  sharedSymbols: z.array(z.string().min(1)),
  predictedConflictTypes: z.array(z.string().min(1)),
  recommendation: ConflictRecommendationSchema,
  explanation: z.string().min(1),
  suggestedDependency: z.object({
    fromTaskId: z.string().min(1),
    toTaskId: z.string().min(1),
    reason: z.string().min(1)
  }).optional()
});

export type ConflictPrediction = z.infer<typeof ConflictPredictionSchema>;

export type TaskPairRiskMatrix = ConflictPrediction[];

export const TaskPairRiskMatrixSchema = z.array(ConflictPredictionSchema);

export const StaticConflictSignalTypeSchema = z.union([
  z.literal("same_declared_symbol_file"),
  z.literal("producer_consumer_symbol"),
  z.literal("shared_import_dependency"),
  z.literal("shared_schema_dependency"),
  z.literal("test_fixture_overlap"),
  z.literal("critical_file_overlap"),
  z.literal("missing_expected_file"),
  z.literal("missing_expected_symbol"),
  z.literal("public_api_surface_overlap")
]);

export type StaticConflictSignalType = z.infer<typeof StaticConflictSignalTypeSchema>;

export const StaticConflictEvidenceSchema = z.object({
  detail: z.string().min(1),
  filePath: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  moduleSpecifier: z.string().min(1).optional()
});

export type StaticConflictEvidence = z.infer<typeof StaticConflictEvidenceSchema>;

export const StaticConflictSignalSchema = z.object({
  id: z.string().min(1),
  taskAId: z.string().min(1),
  taskBId: z.string().min(1).optional(),
  type: StaticConflictSignalTypeSchema,
  severity: ConflictRiskLevelSchema,
  evidence: z.array(StaticConflictEvidenceSchema).min(1)
});

export type StaticConflictSignal = z.infer<typeof StaticConflictSignalSchema>;

export const StaticConflictSignalsSchema = z.array(StaticConflictSignalSchema);

export interface BuildRiskMatrixInput {
  contracts: Record<string, AgentTaskContract>;
  staticSignals?: readonly StaticConflictSignal[];
}

export interface BuildStaticConflictSignalsInput {
  contracts: Record<string, AgentTaskContract>;
  repositoryIndex: RepositoryIndex;
}

export function buildTaskPairRiskMatrix(input: BuildRiskMatrixInput): TaskPairRiskMatrix {
  const contracts = Object.values(input.contracts).sort((left, right) =>
    left.taskId.localeCompare(right.taskId)
  );
  const predictions: ConflictPrediction[] = [];

  for (let leftIndex = 0; leftIndex < contracts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contracts.length; rightIndex += 1) {
      const left = contracts[leftIndex];
      const right = contracts[rightIndex];

      if (left && right) {
        predictions.push(predictConflict(left, right, input.staticSignals ?? []));
      }
    }
  }

  return predictions;
}

export function predictConflict(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  staticSignals: readonly StaticConflictSignal[] = []
): ConflictPrediction {
  const evidence: ConflictEvidence[] = [];
  const pairStaticSignals = staticSignalsForPair(staticSignals, taskA.taskId, taskB.taskId);
  const pathsA = contractPaths(taskA);
  const pathsB = contractPaths(taskB);
  const exactSharedFiles = intersectValues(taskA.expectedOutput.changedFiles, taskB.expectedOutput.changedFiles);
  const overlappingPaths = findOverlappingPathPatterns(pathsA, pathsB);
  const symbolsA = contractSymbols(taskA);
  const symbolsB = contractSymbols(taskB);
  const sharedSymbols = intersectValues(symbolsA, symbolsB);
  const producerConsumer = findProducerConsumer(taskA, taskB);
  const sharedCriticalPaths = findSharedCriticalPaths(pathsA, pathsB);
  const sharedTestFixtures = findSharedTestFixtures(pathsA, pathsB);

  if (exactSharedFiles.length > 0) {
    evidence.push({
      signal: "file_overlap",
      detail: `both tasks expect to change ${exactSharedFiles.join(", ")}`,
      weight: 0.45
    });
  } else if (overlappingPaths.length > 0) {
    evidence.push({
      signal: "path_overlap",
      detail: `allowed or expected paths overlap: ${overlappingPaths.join(", ")}`,
      weight: 0.3
    });
  }

  if (sharedSymbols.length > 0) {
    evidence.push({
      signal: "symbol_overlap",
      detail: `both tasks mention symbols ${sharedSymbols.join(", ")}`,
      weight: 0.35
    });
  }

  if (producerConsumer) {
    evidence.push({
      signal: "producer_consumer",
      detail: producerConsumer.reason,
      weight: 0.5
    });
  }

  if (sharedCriticalPaths.length > 0) {
    evidence.push({
      signal: "critical_path",
      detail: `both tasks touch critical paths ${sharedCriticalPaths.join(", ")}`,
      weight: 0.5
    });
  }

  if (sharedTestFixtures.length > 0) {
    evidence.push({
      signal: "shared_test_fixture",
      detail: `both tasks touch shared test fixtures ${sharedTestFixtures.join(", ")}`,
      weight: 0.2
    });
  }

  evidence.push(...pairStaticSignals.map(staticSignalToEvidence));

  const score = clamp01(evidence.reduce((total, item) => total + item.weight, 0));
  const level = riskLevelFromScore(score, evidence, pairStaticSignals.some((signal) => signal.severity === "blocking"));
  const recommendation = recommendationFor(level, producerConsumer !== null);
  const predictedConflictTypes = conflictTypesFromEvidence(evidence);
  const explanation =
    evidence.length === 0
      ? "No declared file, path, symbol or artifact overlap was detected."
      : evidence.map((item) => item.detail).join(" ");

  const prediction: ConflictPrediction = {
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    level,
    score,
    evidence,
    sharedFiles: exactSharedFiles,
    sharedSymbols,
    predictedConflictTypes,
    recommendation,
    explanation
  };

  if (producerConsumer) {
    prediction.suggestedDependency = producerConsumer;
  }

  return prediction;
}

export function buildStaticConflictSignals(input: BuildStaticConflictSignalsInput): StaticConflictSignal[] {
  const index = RepositoryIndexSchema.parse(input.repositoryIndex);
  const contracts = Object.values(input.contracts).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const signals: StaticConflictSignal[] = [];

  for (const contract of contracts) {
    signals.push(...missingExpectedFileSignals(contract, index));
    signals.push(...missingExpectedSymbolSignals(contract, index));
  }

  for (let leftIndex = 0; leftIndex < contracts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contracts.length; rightIndex += 1) {
      const left = contracts[leftIndex];
      const right = contracts[rightIndex];

      if (!left || !right) {
        continue;
      }

      signals.push(...sameDeclaredSymbolFileSignals(left, right, index));
      signals.push(...producerConsumerSymbolSignals(left, right, index));
      signals.push(...sharedImportDependencySignals(left, right, index));
      signals.push(...sharedSchemaDependencySignals(left, right, index));
      signals.push(...testFixtureOverlapSignals(left, right, index));
      signals.push(...criticalFileOverlapSignals(left, right, index));
      signals.push(...publicApiSurfaceOverlapSignals(left, right, index));
    }
  }

  return signals
    .map((signal) => StaticConflictSignalSchema.parse(signal))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function findRiskPrediction(
  matrix: TaskPairRiskMatrix,
  taskAId: string,
  taskBId: string
): ConflictPrediction | undefined {
  const key = pairKey(taskAId, taskBId);
  return matrix.find((prediction) => pairKey(prediction.taskAId, prediction.taskBId) === key);
}

function riskLevelFromScore(
  score: number,
  evidence: readonly ConflictEvidence[],
  hasBlockingStaticSignal = false
): ConflictRiskLevel {
  if (hasBlockingStaticSignal) {
    return "blocking";
  }

  if (evidence.some((item) => item.signal === "explicit_dependency")) {
    return "blocking";
  }

  if (score >= 0.75) {
    return "high";
  }

  if (score >= 0.3) {
    return "medium";
  }

  return "low";
}

function recommendationFor(
  level: ConflictRiskLevel,
  hasProducerConsumerEvidence: boolean
): ConflictPrediction["recommendation"] {
  if (level === "blocking") {
    return "requires_human_review";
  }

  if (hasProducerConsumerEvidence) {
    return "add_dependency";
  }

  if (level === "high" || level === "medium") {
    return "serialize";
  }

  return "run_parallel";
}

function contractPaths(contract: AgentTaskContract): string[] {
  return uniqueValues([
    ...contract.allowed.paths,
    ...contract.expectedOutput.changedFiles
  ].map(normalizePath));
}

function contractSymbols(contract: AgentTaskContract): string[] {
  return uniqueValues([
    ...contract.relevantSymbols,
    ...contract.expectedOutput.producedSymbols,
    ...contract.expectedOutput.consumedSymbols
  ]);
}

function findOverlappingPathPatterns(left: readonly string[], right: readonly string[]): string[] {
  const overlaps: string[] = [];

  for (const leftPath of left) {
    for (const rightPath of right) {
      if (pathPatternsOverlap(leftPath, rightPath)) {
        overlaps.push(`${leftPath} <-> ${rightPath}`);
      }
    }
  }

  return uniqueValues(overlaps);
}

function findSharedCriticalPaths(left: readonly string[], right: readonly string[]): string[] {
  return findOverlappingPathPatterns(left.filter(isCriticalPath), right.filter(isCriticalPath));
}

function findSharedTestFixtures(left: readonly string[], right: readonly string[]): string[] {
  return findOverlappingPathPatterns(left.filter(isSharedTestFixture), right.filter(isSharedTestFixture));
}

function findProducerConsumer(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract
): ConflictPrediction["suggestedDependency"] | null {
  const aProduces = taskA.expectedOutput.producedSymbols;
  const bProduces = taskB.expectedOutput.producedSymbols;
  const aConsumes = taskA.expectedOutput.consumedSymbols;
  const bConsumes = taskB.expectedOutput.consumedSymbols;
  const aToB = intersectValues(aProduces, bConsumes);

  if (aToB.length > 0) {
    return {
      fromTaskId: taskA.taskId,
      toTaskId: taskB.taskId,
      reason: `${taskB.taskId} consumes ${aToB.join(", ")} produced by ${taskA.taskId}`
    };
  }

  const bToA = intersectValues(bProduces, aConsumes);

  if (bToA.length > 0) {
    return {
      fromTaskId: taskB.taskId,
      toTaskId: taskA.taskId,
      reason: `${taskA.taskId} consumes ${bToA.join(", ")} produced by ${taskB.taskId}`
    };
  }

  return null;
}

function conflictTypesFromEvidence(evidence: readonly ConflictEvidence[]): string[] {
  const types: string[] = [];

  for (const item of evidence) {
    if (item.signal === "file_overlap" || item.signal === "path_overlap") {
      types.push("textual");
    }

    if (item.signal === "symbol_overlap" || item.signal === "shared_type_change") {
      types.push("structural");
    }

    if (item.signal === "producer_consumer") {
      types.push("missing_dependency");
    }

    if (item.signal === "critical_path") {
      types.push("critical_path");
    }

    if (item.signal === "shared_test_fixture") {
      types.push("shared_test_fixture");
    }

    if (item.signal.startsWith("static_")) {
      types.push(item.signal.replace("static_", ""));
    }
  }

  return uniqueValues(types);
}

function staticSignalsForPair(
  staticSignals: readonly StaticConflictSignal[],
  taskAId: string,
  taskBId: string
): StaticConflictSignal[] {
  const key = pairKey(taskAId, taskBId);
  return staticSignals.filter((signal) => signal.taskBId !== undefined && pairKey(signal.taskAId, signal.taskBId) === key);
}

function staticSignalToEvidence(signal: StaticConflictSignal): ConflictEvidence {
  return {
    signal: `static_${signal.type}`,
    detail: signal.evidence.map((item) => item.detail).join(" "),
    weight: staticSignalWeight(signal.severity)
  };
}

function staticSignalWeight(severity: ConflictRiskLevel): number {
  if (severity === "blocking") {
    return 1;
  }

  if (severity === "high") {
    return 0.45;
  }

  if (severity === "medium") {
    return 0.25;
  }

  return 0.1;
}

function missingExpectedFileSignals(contract: AgentTaskContract, index: RepositoryIndex): StaticConflictSignal[] {
  const files = new Set(index.files.map((file) => file.path));

  return contract.expectedOutput.changedFiles
    .map(normalizePath)
    .filter((filePath) => !files.has(filePath))
    .map((filePath) => staticSignal({
      taskAId: contract.taskId,
      type: "missing_expected_file",
      severity: "medium",
      evidence: [{
        detail: `${contract.taskId} expects ${filePath}, but it is absent from the repository index`,
        filePath
      }]
    }));
}

function missingExpectedSymbolSignals(contract: AgentTaskContract, index: RepositoryIndex): StaticConflictSignal[] {
  const symbols = new Set(index.symbols.map((symbol) => symbol.name));

  return contractSymbols(contract)
    .filter((symbol) => !symbols.has(symbol))
    .map((symbol) => staticSignal({
      taskAId: contract.taskId,
      type: "missing_expected_symbol",
      severity: "medium",
      evidence: [{
        detail: `${contract.taskId} references ${symbol}, but it is absent from the repository index`,
        symbol
      }]
    }));
}

function sameDeclaredSymbolFileSignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const sharedFiles = intersectValues(symbolFilesForContract(taskA, index), symbolFilesForContract(taskB, index));

  return sharedFiles.map((filePath) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "same_declared_symbol_file",
    severity: "high",
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} reference symbols declared in ${filePath}`,
      filePath
    }]
  }));
}

function producerConsumerSymbolSignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const aToB = intersectValues(taskA.expectedOutput.producedSymbols, taskB.expectedOutput.consumedSymbols);
  const bToA = intersectValues(taskB.expectedOutput.producedSymbols, taskA.expectedOutput.consumedSymbols);

  return [
    ...aToB.map((symbol) => producerConsumerSignal(taskA.taskId, taskB.taskId, symbol, index)),
    ...bToA.map((symbol) => producerConsumerSignal(taskB.taskId, taskA.taskId, symbol, index))
  ];
}

function producerConsumerSignal(
  producerTaskId: string,
  consumerTaskId: string,
  symbol: string,
  index: RepositoryIndex
): StaticConflictSignal {
  const filePath = symbolFiles(symbol, index)[0];
  return staticSignal({
    taskAId: producerTaskId,
    taskBId: consumerTaskId,
    type: "producer_consumer_symbol",
    severity: "high",
    evidence: [{
      detail: `${consumerTaskId} consumes ${symbol} produced by ${producerTaskId}${filePath ? ` in ${filePath}` : ""}`,
      symbol,
      ...(filePath ? { filePath } : {})
    }]
  });
}

function sharedImportDependencySignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const sharedModules = intersectValues(importDependenciesForContract(taskA, index), importDependenciesForContract(taskB, index))
    .filter((moduleSpecifier) => !moduleSpecifier.startsWith("type:"));

  return sharedModules.map((moduleSpecifier) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "shared_import_dependency",
    severity: "medium",
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} import or depend on ${moduleSpecifier}`,
      moduleSpecifier
    }]
  }));
}

function sharedSchemaDependencySignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const sharedSchemas = intersectValues(schemaDependenciesForContract(taskA, index), schemaDependenciesForContract(taskB, index));

  return sharedSchemas.map((filePath) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "shared_schema_dependency",
    severity: "high",
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} depend on schema file ${filePath}`,
      filePath
    }]
  }));
}

function testFixtureOverlapSignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const sharedTests = intersectValues(indexedFilesForContract(taskA, index), indexedFilesForContract(taskB, index))
    .filter((file) => file.kind === "test");

  return sharedTests.map((file) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "test_fixture_overlap",
    severity: "medium",
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} touch test fixture ${file.path}`,
      filePath: file.path
    }]
  }));
}

function criticalFileOverlapSignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const sharedCritical = intersectValues(indexedFilesForContract(taskA, index), indexedFilesForContract(taskB, index))
    .filter((file) => file.kind === "config" || file.kind === "schema" || file.kind === "migration");

  return sharedCritical.map((file) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "critical_file_overlap",
    severity: criticalOverlapSeverity(taskA, taskB, file),
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} touch critical file ${file.path}`,
      filePath: file.path
    }]
  }));
}

function criticalOverlapSeverity(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  file: RepositoryFileIndex
): StaticConflictSignal["severity"] {
  const aExpectedFiles = new Set(taskA.expectedOutput.changedFiles.map(normalizePath));
  const bExpectedFiles = new Set(taskB.expectedOutput.changedFiles.map(normalizePath));
  const exactSharedCriticalChange =
    aExpectedFiles.has(file.path) &&
    bExpectedFiles.has(file.path) &&
    (file.kind === "schema" || file.kind === "config" || file.kind === "migration");

  return exactSharedCriticalChange ? "blocking" : "high";
}

function publicApiSurfaceOverlapSignals(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  index: RepositoryIndex
): StaticConflictSignal[] {
  const aPublicFiles = exportedSymbolFilesForContract(taskA, index);
  const bPublicFiles = exportedSymbolFilesForContract(taskB, index);
  const sharedFiles = intersectValues(aPublicFiles, bPublicFiles);

  return sharedFiles.map((filePath) => staticSignal({
    taskAId: taskA.taskId,
    taskBId: taskB.taskId,
    type: "public_api_surface_overlap",
    severity: "high",
    evidence: [{
      detail: `${taskA.taskId} and ${taskB.taskId} both reference public API surface in ${filePath}`,
      filePath
    }]
  }));
}

function staticSignal(input: Omit<StaticConflictSignal, "id">): StaticConflictSignal {
  const idParts = [
    "static",
    input.type,
    input.taskAId,
    input.taskBId ?? "task",
    ...input.evidence.map((item) => item.filePath ?? item.symbol ?? item.moduleSpecifier ?? item.detail)
  ];

  return StaticConflictSignalSchema.parse({
    id: idParts.map((part) => part.replace(/[^A-Za-z0-9._:-]/gu, "_")).join(":"),
    ...input
  });
}

function contractFilePaths(contract: AgentTaskContract): string[] {
  return uniqueValues(contract.expectedOutput.changedFiles.map(normalizePath));
}

function indexedFilesForContract(contract: AgentTaskContract, index: RepositoryIndex): RepositoryFileIndex[] {
  const filePaths = new Set(contractFilePaths(contract));
  return index.files.filter((file) => filePaths.has(file.path));
}

function symbolFilesForContract(contract: AgentTaskContract, index: RepositoryIndex): string[] {
  const symbols = new Set(contractSymbols(contract));
  return uniqueValues(index.symbols.filter((symbol) => symbols.has(symbol.name)).map((symbol) => symbol.filePath)).sort();
}

function exportedSymbolFilesForContract(contract: AgentTaskContract, index: RepositoryIndex): string[] {
  const symbols = new Set(contractSymbols(contract));
  return uniqueValues(
    index.symbols
      .filter((symbol) => symbol.exported && symbols.has(symbol.name))
      .map((symbol) => symbol.filePath)
  ).sort();
}

function symbolFiles(symbolName: string, index: RepositoryIndex): string[] {
  return uniqueValues(index.symbols.filter((symbol) => symbol.name === symbolName).map((symbol) => symbol.filePath)).sort();
}

function importDependenciesForContract(contract: AgentTaskContract, index: RepositoryIndex): string[] {
  const contractFiles = new Set(contractFilePaths(contract));
  return uniqueValues(
    index.imports
      .filter((item) => contractFiles.has(item.filePath))
      .map((item) => resolveModuleSpecifier(item.filePath, item.moduleSpecifier, index))
  ).sort();
}

function schemaDependenciesForContract(contract: AgentTaskContract, index: RepositoryIndex): string[] {
  const contractFiles = indexedFilesForContract(contract, index)
    .filter((file) => file.kind === "schema")
    .map((file) => file.path);
  const importedSchemas = importDependenciesForContract(contract, index)
    .filter((dependency) => index.files.some((file) => file.path === dependency && file.kind === "schema"));

  return uniqueValues([...contractFiles, ...importedSchemas]).sort();
}

function resolveModuleSpecifier(filePath: string, moduleSpecifier: string, index: RepositoryIndex): string {
  if (!moduleSpecifier.startsWith(".")) {
    return moduleSpecifier;
  }

  const candidateBase = normalizePath(`${dirnamePath(filePath)}/${moduleSpecifier}`);
  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.js`,
    `${candidateBase}.jsx`,
    `${candidateBase}/index.ts`,
    `${candidateBase}/index.tsx`
  ];
  const match = candidates.find((candidate) => index.files.some((file) => file.path === candidate));

  return match ?? candidateBase;
}

function dirnamePath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.replaceAll("\\", "/").replace(/^\.\//, "").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}

function patternBase(pattern: string): string {
  return normalizePath(pattern).replace(/\*\*?\/?$/u, "").replace(/\/$/u, "");
}

function pathPatternsOverlap(left: string, right: string): boolean {
  const leftBase = patternBase(left);
  const rightBase = patternBase(right);

  return (
    leftBase === rightBase ||
    leftBase.startsWith(`${rightBase}/`) ||
    rightBase.startsWith(`${leftBase}/`)
  );
}

function isCriticalPath(path: string): boolean {
  const normalized = normalizePath(path);

  return (
    normalized === "package.json" ||
    normalized === "pnpm-workspace.yaml" ||
    normalized.includes("tsconfig") ||
    normalized.includes("eslint") ||
    normalized.endsWith("schema.prisma") ||
    normalized.includes("migrations/") ||
    normalized.includes(".config.") ||
    normalized.includes("/types/") ||
    normalized.startsWith("packages/shared/")
  );
}

function isSharedTestFixture(path: string): boolean {
  const normalized = normalizePath(path);

  return (
    normalized.includes("tests/setup") ||
    normalized.includes("__fixtures__/") ||
    normalized.includes("fixtures/") ||
    normalized.endsWith(".fixture.ts") ||
    normalized.endsWith(".fixtures.ts")
  );
}
