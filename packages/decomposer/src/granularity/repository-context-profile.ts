import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "../planner/schema.js";
import { repositorySnapshotIdsMatch } from "../planner/repository-snapshot-id.js";

export const CONTEXT_ESTIMATOR_VERSION = "utf8-bytes-div-4/1.0.0";

export interface RepositoryContextProfile {
  unitKey: string;
  estimatorVersion: typeof CONTEXT_ESTIMATOR_VERSION;
  repositorySnapshotId: string;
  snapshotDisposition: RepositorySnapshot["inspectionDisposition"];
  scopePaths: string[];
  measuredExistingBytes: number;
  measuredExistingTokens: number;
  measuredExistingLines: number;
  measuredExistingPathCount: number;
  unmeasuredExistingPathCount: number;
  plannedPathCount: number;
  unmeasuredPlannedPathCount: number;
  evidenceConfidence: number;
  uncertainty: number;
  evidenceRefs: string[];
}

export interface BuildRepositoryContextProfilesInput {
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
}

interface UnitSurface {
  paths: Set<string>;
  plannedPaths: Set<string>;
  pathEvidenceIds: Set<string>;
}

/**
 * Builds one deterministic pre-execution context profile per semantic unit.
 * Missing measurements remain explicit uncertainty; this function never reads
 * the filesystem and never treats a future file as measured zero context.
 */
export function buildRepositoryContextProfiles(
  input: BuildRepositoryContextProfilesInput
): Record<string, RepositoryContextProfile> {
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  if (!repositorySnapshotIdsMatch(breakdown.repositorySnapshotId, input.repositorySnapshot.snapshotId)) {
    throw new Error(
      `WorkBreakdown references repository snapshot ${breakdown.repositorySnapshotId}, received ${input.repositorySnapshot.snapshotId}.`
    );
  }

  const pathEvidence = new Map(
    breakdown.repositoryEvidence
      .filter((item) => item.kind === "path")
      .map((item) => [item.id, item] as const)
  );
  const indexedFiles = new Map(
    (input.repositorySnapshot.index?.files ?? []).map((file) => [normalizePath(file.path), file] as const)
  );
  const surfaces = new Map<string, UnitSurface>();
  collectSurface(breakdown.root, pathEvidence, surfaces);

  return Object.fromEntries(
    flattenUnits(breakdown.root).map((unit) => {
      const surface = surfaces.get(unit.key) ?? emptySurface();
      const scopePaths = [...surface.paths].sort();
      let measuredExistingBytes = 0;
      let measuredExistingLines = 0;
      let measuredExistingPathCount = 0;
      let unmeasuredExistingPathCount = 0;
      let plannedPathCount = 0;

      for (const path of scopePaths) {
        const indexed = indexedFiles.get(path);
        if (indexed !== undefined) {
          if (indexed.byteSize === undefined) {
            unmeasuredExistingPathCount += 1;
          } else {
            measuredExistingBytes += indexed.byteSize;
            measuredExistingLines += indexed.lineCount ?? 0;
            measuredExistingPathCount += 1;
          }
          continue;
        }
        if (surface.plannedPaths.has(path)) {
          plannedPathCount += 1;
        } else {
          unmeasuredExistingPathCount += 1;
        }
      }

      const evidence = [...surface.pathEvidenceIds]
        .map((id) => pathEvidence.get(id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined);
      const evidenceConfidence = evidence.length === 0
        ? (scopePaths.length === 0 ? 1 : 0)
        : mean(evidence.map((item) => item.confidence));
      const unmeasuredPlannedPathCount = plannedPathCount;
      const structuralUncertainty = scopePaths.length === 0
        ? 0
        : (unmeasuredExistingPathCount + unmeasuredPlannedPathCount) / scopePaths.length;
      const confidenceUncertainty = evidence.length === 0 && plannedPathCount > 0
        ? structuralUncertainty
        : 1 - evidenceConfidence;
      const dispositionUncertainty = input.repositorySnapshot.inspectionDisposition === "unavailable"
        ? 1
        : input.repositorySnapshot.inspectionDisposition === "partial"
          ? 0.25
          : 0;
      const uncertainty = round4(Math.max(
        structuralUncertainty,
        confidenceUncertainty,
        dispositionUncertainty
      ));
      const profile: RepositoryContextProfile = {
        unitKey: unit.key,
        estimatorVersion: CONTEXT_ESTIMATOR_VERSION,
        repositorySnapshotId: input.repositorySnapshot.snapshotId,
        snapshotDisposition: input.repositorySnapshot.inspectionDisposition,
        scopePaths,
        measuredExistingBytes,
        measuredExistingTokens: Math.ceil(measuredExistingBytes / 4),
        measuredExistingLines,
        measuredExistingPathCount,
        unmeasuredExistingPathCount,
        plannedPathCount,
        unmeasuredPlannedPathCount,
        evidenceConfidence: round4(evidenceConfidence),
        uncertainty,
        evidenceRefs: [...surface.pathEvidenceIds, input.repositorySnapshot.snapshotId]
      };
      return [unit.key, profile];
    })
  );
}

function collectSurface(
  unit: WorkUnit,
  pathEvidence: ReadonlyMap<string, WorkBreakdown["repositoryEvidence"][number]>,
  output: Map<string, UnitSurface>
): UnitSurface {
  const surface = emptySurface();
  for (const path of unit.plannedPaths ?? []) {
    const normalized = normalizePath(path);
    surface.paths.add(normalized);
    surface.plannedPaths.add(normalized);
  }
  for (const id of unit.evidenceIds) {
    const evidence = pathEvidence.get(id);
    if (evidence === undefined) continue;
    surface.paths.add(normalizePath(evidence.reference));
    surface.pathEvidenceIds.add(id);
  }
  if (unit.kind === "composite") {
    for (const child of unit.children) mergeSurface(surface, collectSurface(child, pathEvidence, output));
  }
  output.set(unit.key, surface);
  return surface;
}

function emptySurface(): UnitSurface {
  return { paths: new Set(), plannedPaths: new Set(), pathEvidenceIds: new Set() };
}

function mergeSurface(target: UnitSurface, source: UnitSurface): void {
  for (const path of source.paths) target.paths.add(path);
  for (const path of source.plannedPaths) target.plannedPaths.add(path);
  for (const id of source.pathEvidenceIds) target.pathEvidenceIds.add(id);
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
