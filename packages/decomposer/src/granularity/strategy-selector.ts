import { createHash } from "node:crypto";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "../planner/schema.js";
import {
  buildRepositoryContextProfiles,
  type RepositoryContextProfile
} from "./repository-context-profile.js";
import {
  anyReasonHolds,
  describeDecision,
  NO_SPLIT_REASONS,
  validateGranularityPolicyConfig,
  type GranularityAssessment,
  type GranularityDecision,
  type GranularityPolicyConfig,
  type GranularitySplitReasons
} from "./granularity-policy.js";

/** `A` collapses the goal by instruction; `C` applies the policy. */
export type GranularityCondition = "A" | "C";

export const GRANULARITY_CONDITIONS: readonly GranularityCondition[] = ["A", "C"];

export interface SelectGranularityStrategyInput {
  condition: GranularityCondition;
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  config: GranularityPolicyConfig;
}

export interface GranularityStrategyResult {
  condition: GranularityCondition;
  policyVersion: string;
  candidateTreeHash: string;
  config: GranularityPolicyConfig;
  selectedBreakdown: WorkBreakdown;
  assessments: Record<string, GranularityAssessment>;
  requiresSemanticReplan: boolean;
}

export function resolveGranularityCondition(condition: string | undefined): GranularityCondition {
  if (condition === undefined || condition === "C") return "C";
  if (condition === "A") return "A";
  throw new Error(`Unknown granularity condition "${condition}"; expected A or C.`);
}

export function candidateBreakdownHash(breakdown: WorkBreakdown): string {
  return stableHash(WorkBreakdownSchema.parse(breakdown));
}

interface SelectedUnit {
  unit: WorkUnit;
  decision: GranularityDecision;
}

interface RelationLike {
  producerUnitKey: string;
  consumerUnitKeys: string[];
}

interface ChildEdge {
  from: string;
  to: string;
}

export function selectGranularityStrategy(
  input: SelectGranularityStrategyInput
): GranularityStrategyResult {
  const config = validateGranularityPolicyConfig(input.config);
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  const candidateTreeHash = stableHash({
    root: breakdown.root,
    candidateArtifacts: breakdown.candidateArtifacts,
    candidateSeams: breakdown.candidateSeams
  });
  const profiles = buildRepositoryContextProfiles({
    breakdown,
    repositorySnapshot: input.repositorySnapshot
  });
  const assessments: Record<string, GranularityAssessment> = {};
  const selected = selectUnit({
    unit: breakdown.root,
    condition: input.condition,
    isRoot: true,
    breakdown,
    profiles,
    config,
    candidateTreeHash,
    assessments
  });
  const selectedKeys = new Set(flattenUnits(selected.unit).map((unit) => unit.key));
  const parentByKey = parentMap(breakdown.root);
  const remapped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: selected.unit,
    candidateArtifacts: remapRelations(breakdown.candidateArtifacts, selectedKeys, parentByKey),
    candidateSeams: remapRelations(breakdown.candidateSeams, selectedKeys, parentByKey)
  });

  return {
    condition: input.condition,
    policyVersion: config.policyVersion,
    candidateTreeHash,
    config,
    selectedBreakdown: remapped,
    assessments,
    requiresSemanticReplan: selected.decision === "semantic_replan"
  };
}

function selectUnit(input: {
  unit: WorkUnit;
  condition: GranularityCondition;
  isRoot: boolean;
  breakdown: WorkBreakdown;
  profiles: Record<string, RepositoryContextProfile>;
  config: GranularityPolicyConfig;
  candidateTreeHash: string;
  assessments: Record<string, GranularityAssessment>;
}): SelectedUnit {
  const profile = requireProfile(input.profiles, input.unit.key);
  const leafFeasible = isLeafFeasible(profile, input.config);

  const record = (
    selected: GranularityDecision,
    splitViable: boolean,
    reasons: GranularitySplitReasons,
    rationale?: string
  ): void => {
    input.assessments[input.unit.key] = {
      unitKey: input.unit.key,
      candidateTreeHash: input.candidateTreeHash,
      selected,
      leafFeasible,
      splitViable,
      reasons,
      evidenceRefs: [...profile.evidenceRefs],
      rationale: rationale ?? describeDecision(selected, reasons, splitViable)
    };
  };

  if (input.condition === "A" && input.isRoot) {
    record("leaf", input.unit.kind === "composite" && input.unit.children.length >= 2, NO_SPLIT_REASONS,
      "Condition A keeps the complete goal as one unit, by instruction rather than by judgement.");
    return { unit: collapseToLeaf(input.unit), decision: "leaf" };
  }

  if (input.unit.kind === "leaf") {
    const selected: GranularityDecision = leafFeasible ? "leaf" : "semantic_replan";
    record(selected, false, { ...NO_SPLIT_REASONS, doesNotFit: !leafFeasible });
    return { unit: input.unit, decision: selected };
  }

  const children = input.unit.children.map((child) => selectUnit({ ...input, unit: child, isRoot: false }));
  const splitViable = input.unit.children.length >= 2 &&
    children.every((child) => child.decision !== "semantic_replan");
  const reasons: GranularitySplitReasons = {
    doesNotFit: !leafFeasible,
    runsInParallel: splitViable && runsInParallel(input.unit, input.breakdown),
    verifiableApart: splitViable && verifiableApart(input.unit)
  };

  const selected: GranularityDecision = splitViable
    ? (anyReasonHolds(reasons) ? "split" : "leaf")
    : (leafFeasible ? "leaf" : "semantic_replan");

  record(selected, splitViable, reasons);

  if (selected === "leaf") return { unit: collapseToLeaf(input.unit), decision: selected };
  if (selected === "semantic_replan") return { unit: input.unit, decision: selected };
  return { unit: { ...input.unit, children: children.map((child) => child.unit) }, decision: selected };
}

/**
 * Whether two children can start at the same time.
 *
 * Only a materialized artifact orders the work: `compileGraphRevision` creates
 * an execution-blocking `ArtifactRequirement` for every candidate artifact whose
 * materialization is not `logical`, and `explainReadiness` holds a consumer
 * until that artifact exists. A seam compiles to no requirement — it is an
 * interface both sides agree on before either is written, so it constrains WHAT
 * they build, not WHEN.
 *
 * The cut offers concurrency when its production order is shallower than its
 * child count: `n` units needing fewer than `n` rounds means at least two share
 * a round. A strict chain needs exactly `n`, which is why layered work buys
 * isolation rather than speed.
 */
function runsInParallel(
  unit: Extract<WorkUnit, { kind: "composite" }>,
  breakdown: WorkBreakdown
): boolean {
  const childKeys = unit.children.map((child) => child.key);
  if (childKeys.length < 2) return false;
  const edges = crossChildEdges(
    unit.children,
    breakdown.candidateArtifacts.filter((artifact) => artifact.materializationHint !== "logical")
  );
  const rounds = productionRounds(childKeys, edges);
  // A cut its own dependencies cannot schedule offers no concurrency.
  return rounds !== undefined && rounds < childKeys.length;
}

/**
 * Whether every child owns an acceptance criterion no sibling owns.
 *
 * A child with no criterion of its own cannot be shown to have succeeded
 * independently of its siblings, so separating it buys no evidence — its
 * failure and their failure are the same observation.
 */
function verifiableApart(unit: Extract<WorkUnit, { kind: "composite" }>): boolean {
  if (unit.children.length < 2) return false;
  const owners = new Map<string, number>();
  for (const child of unit.children) {
    for (const intentId of new Set(child.acceptanceIntentIds)) {
      owners.set(intentId, (owners.get(intentId) ?? 0) + 1);
    }
  }
  return unit.children.every((child) =>
    child.acceptanceIntentIds.some((intentId) => owners.get(intentId) === 1)
  );
}

/** Rounds the cut needs when every unit starts as soon as its inputs exist, or `undefined` if cyclic. */
function productionRounds(
  nodes: readonly string[],
  edges: readonly ChildEdge[]
): number | undefined {
  const remaining = new Map(nodes.map((key) => [key, 0]));
  const outgoing = new Map(nodes.map((key) => [key, [] as string[]]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);
  }

  const level = new Map(nodes.map((key) => [key, 1]));
  const ready = nodes.filter((key) => remaining.get(key) === 0);
  let ordered = 0;
  while (ready.length > 0) {
    const key = ready.shift()!;
    ordered += 1;
    for (const next of outgoing.get(key) ?? []) {
      level.set(next, Math.max(level.get(next)!, level.get(key)! + 1));
      const pending = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, pending);
      if (pending === 0) ready.push(next);
    }
  }
  return ordered === nodes.length ? Math.max(...level.values()) : undefined;
}

/** Distinct producer→consumer dependencies between two different children. */
function crossChildEdges(children: WorkUnit[], relations: readonly RelationLike[]): ChildEdge[] {
  const owner = new Map<string, string>();
  for (const child of children) {
    for (const descendant of flattenUnits(child)) owner.set(descendant.key, child.key);
  }
  const seen = new Set<string>();
  const edges: ChildEdge[] = [];
  for (const relation of relations) {
    const from = owner.get(relation.producerUnitKey);
    if (from === undefined) continue;
    for (const consumerKey of relation.consumerUnitKeys) {
      const to = owner.get(consumerKey);
      if (to === undefined || to === from) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }
  return edges;
}

/**
 * A leaf is one unit an agent completes inside one budgeted attempt.
 *
 * Reading and producing are separate limits: the first two bounds cover what a
 * unit must hold in context, `maxLeafPlannedPaths` covers what it must bring
 * into existence.
 */
function isLeafFeasible(profile: RepositoryContextProfile, config: GranularityPolicyConfig): boolean {
  return profile.measuredExistingTokens <= config.maxLeafContextTokens &&
    profile.scopePaths.length <= config.maxLeafScopePaths &&
    profile.plannedPathCount <= config.maxLeafPlannedPaths;
}

function collapseToLeaf(unit: WorkUnit): WorkUnit {
  const units = flattenUnits(unit);
  const plannedPaths = unique(units.flatMap((candidate) => candidate.plannedPaths ?? []));
  return {
    key: unit.key,
    kind: "leaf",
    title: unit.title,
    objective: unit.objective,
    concerns: unique(units.flatMap((candidate) => candidate.concerns)),
    expectedOutcomes: unique(units.flatMap((candidate) => candidate.expectedOutcomes)),
    acceptanceIntentIds: unique(units.flatMap((candidate) => candidate.acceptanceIntentIds)),
    evidenceIds: unique(units.flatMap((candidate) => candidate.evidenceIds)),
    ...(plannedPaths.length === 0 ? {} : { plannedPaths })
  };
}

function remapRelations<T extends RelationLike>(
  relations: readonly T[],
  selectedKeys: ReadonlySet<string>,
  parentByKey: ReadonlyMap<string, string>
): T[] {
  return relations.flatMap((relation) => {
    const producer = nearestSelected(relation.producerUnitKey, selectedKeys, parentByKey);
    const consumers = unique(relation.consumerUnitKeys.map((key) =>
      nearestSelected(key, selectedKeys, parentByKey)
    )).filter((key) => key !== producer);
    return consumers.length === 0
      ? []
      : [{ ...relation, producerUnitKey: producer, consumerUnitKeys: consumers }];
  });
}

function nearestSelected(
  key: string,
  selectedKeys: ReadonlySet<string>,
  parentByKey: ReadonlyMap<string, string>
): string {
  let candidate: string | undefined = key;
  while (candidate !== undefined) {
    if (selectedKeys.has(candidate)) return candidate;
    candidate = parentByKey.get(candidate);
  }
  throw new Error(`No selected ancestor exists for semantic unit ${key}.`);
}

function parentMap(root: WorkUnit): Map<string, string> {
  const output = new Map<string, string>();
  const visit = (unit: WorkUnit): void => {
    if (unit.kind === "leaf") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}

function requireProfile(
  profiles: Record<string, RepositoryContextProfile>,
  unitKey: string
): RepositoryContextProfile {
  const profile = profiles[unitKey];
  if (profile === undefined) throw new Error(`Missing repository context profile for ${unitKey}.`);
  return profile;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function stableHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
