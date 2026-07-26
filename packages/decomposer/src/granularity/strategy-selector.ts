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
  type GranularityStrategyAssessment,
  type GranularityStrategyDecision,
  type GranularityStrategyFeatures,
  type UtilityPolicyConfig,
  validateUtilityPolicyConfig
} from "./utility-policy.js";

export type UtilityGranularityCondition = "A" | "B" | "C";

export interface SelectGranularityStrategyInput {
  condition: UtilityGranularityCondition;
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  config: UtilityPolicyConfig;
}

export interface GranularityStrategyResult {
  condition: UtilityGranularityCondition;
  policyVersion: string;
  candidateTreeHash: string;
  config: UtilityPolicyConfig;
  selectedBreakdown: WorkBreakdown;
  assessments: Record<string, GranularityStrategyAssessment>;
  requiresSemanticReplan: boolean;
}

export function candidateBreakdownHash(breakdown: WorkBreakdown): string {
  return stableHash(WorkBreakdownSchema.parse(breakdown));
}

interface SelectedUnit {
  unit: WorkUnit;
  decision: GranularityStrategyDecision;
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
  const config = validateUtilityPolicyConfig(input.config);
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
  const assessments: Record<string, GranularityStrategyAssessment> = {};
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
  const selectedRoot = propagateAncestorAcceptance(selected.unit);
  const remapped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: selectedRoot,
    candidateArtifacts: remapRelations(
      breakdown.candidateArtifacts,
      selectedKeys,
      parentByKey
    ),
    candidateSeams: remapRelations(
      breakdown.candidateSeams,
      selectedKeys,
      parentByKey
    )
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

/**
 * A required intent owned by a composite remains coverage for its executable
 * descendants. The selector can retain a planner-proposed split without
 * reshaping units, so it must preserve this invariant independently from the
 * adaptive reshaper.
 */
function propagateAncestorAcceptance(unit: WorkUnit, inherited: readonly string[] = []): WorkUnit {
  const acceptanceIntentIds = unique([...inherited, ...unit.acceptanceIntentIds]);
  if (unit.kind === "leaf") return { ...unit, acceptanceIntentIds };
  return {
    ...unit,
    acceptanceIntentIds,
    children: unit.children.map((child) => propagateAncestorAcceptance(child, acceptanceIntentIds))
  };
}

function selectUnit(input: {
  unit: WorkUnit;
  condition: UtilityGranularityCondition;
  isRoot: boolean;
  breakdown: WorkBreakdown;
  profiles: Record<string, RepositoryContextProfile>;
  config: UtilityPolicyConfig;
  candidateTreeHash: string;
  assessments: Record<string, GranularityStrategyAssessment>;
}): SelectedUnit {
  const profile = requireProfile(input.profiles, input.unit.key);
  const leafFeasible = isLeafFeasible(profile, input.config);
  const emptyFeatures = features({ uncertainty: profile.uncertainty });

  if (input.condition === "A" && input.isRoot) {
    input.assessments[input.unit.key] = assessment({
      unitKey: input.unit.key,
      candidateTreeHash: input.candidateTreeHash,
      selected: "leaf",
      leafFeasible,
      splitViable: input.unit.kind === "composite" && input.unit.children.length >= 2,
      features: emptyFeatures,
      minimumAdvantage: input.config.minimumAdvantage,
      evidenceRefs: profile.evidenceRefs,
      rationale: "Condition A keeps the complete goal as one leaf."
    });
    return { unit: collapseToLeaf(input.unit), decision: "leaf" };
  }

  if (input.unit.kind === "leaf") {
    const selected = input.condition === "C" && !leafFeasible
      ? "semantic_replan"
      : "leaf";
    input.assessments[input.unit.key] = assessment({
      unitKey: input.unit.key,
      candidateTreeHash: input.candidateTreeHash,
      selected,
      leafFeasible,
      splitViable: false,
      features: emptyFeatures,
      minimumAdvantage: input.config.minimumAdvantage,
      evidenceRefs: profile.evidenceRefs,
      rationale: selected === "semantic_replan"
        ? "Leaf exceeds the effective execution budget and has no semantic cut."
        : "Semantic leaf remains one executable unit."
    });
    return { unit: input.unit, decision: selected };
  }

  const children = input.unit.children.map((child) => selectUnit({
    ...input,
    unit: child,
    isRoot: false
  }));
  const splitFeatures = cutFeatures(
    input.unit,
    input.breakdown,
    input.profiles
  );
  const benefit = mean([
    splitFeatures.contextRelief,
    splitFeatures.parallelism,
    splitFeatures.faultIsolation
  ]);
  const cost = mean([
    splitFeatures.coordination,
    splitFeatures.pathOverlap,
    splitFeatures.validationDuplication,
    splitFeatures.uncertainty
  ]);
  const splitAdvantage = round4(benefit - cost);
  const splitViable = input.unit.children.length >= 2 &&
    children.every((child) => child.decision !== "semantic_replan");

  let selected: GranularityStrategyDecision;
  if (input.condition === "B") {
    selected = splitViable ? "split" : "leaf";
  } else if (!leafFeasible) {
    selected = splitViable ? "split" : "semantic_replan";
  } else {
    selected = splitViable && splitAdvantage >= input.config.minimumAdvantage
      ? "split"
      : "leaf";
  }

  input.assessments[input.unit.key] = assessment({
    unitKey: input.unit.key,
    candidateTreeHash: input.candidateTreeHash,
    selected,
    leafFeasible,
    splitViable,
    features: splitFeatures,
    benefit,
    cost,
    splitAdvantage,
    minimumAdvantage: input.config.minimumAdvantage,
    evidenceRefs: profile.evidenceRefs,
    rationale: rationaleFor(input.condition, selected, leafFeasible, splitViable, splitAdvantage, input.config)
  });

  if (selected === "leaf") return { unit: collapseToLeaf(input.unit), decision: selected };
  if (selected === "semantic_replan") return { unit: input.unit, decision: selected };
  return {
    unit: { ...input.unit, children: children.map((child) => child.unit) },
    decision: selected
  };
}

function cutFeatures(
  unit: Extract<WorkUnit, { kind: "composite" }>,
  breakdown: WorkBreakdown,
  profiles: Record<string, RepositoryContextProfile>
): GranularityStrategyFeatures {
  const parent = requireProfile(profiles, unit.key);
  const childProfiles = unit.children.map((child) => requireProfile(profiles, child.key));
  const maxChildTokens = Math.max(0, ...childProfiles.map((profile) => profile.measuredExistingTokens));
  const contextRelief = parent.measuredExistingTokens === 0
    ? 0
    : clamp01(1 - maxChildTokens / parent.measuredExistingTokens);
  const childKeys = unit.children.map((child) => child.key);
  const parallelism = concurrency(
    childKeys,
    crossChildEdges(unit.children, breakdown.candidateArtifacts)
  );
  const coordination = coupling(
    childKeys,
    crossChildEdges(unit.children, [
      ...breakdown.candidateArtifacts,
      ...breakdown.candidateSeams
    ])
  );
  const pathOverlap = averagePairwise(
    childProfiles.map((profile) => new Set(profile.scopePaths)),
    jaccard
  );
  const intentSets = unit.children.map((child) => new Set(child.acceptanceIntentIds));
  const faultIsolation = averagePairwise(intentSets, (left, right) => 1 - jaccard(left, right));
  const allAssignments = unit.children.flatMap((child) => child.acceptanceIntentIds);
  const validationDuplication = allAssignments.length === 0
    ? 0
    : (allAssignments.length - new Set(allAssignments).size) / allAssignments.length;

  return features({
    contextRelief,
    parallelism,
    faultIsolation,
    coordination,
    pathOverlap,
    validationDuplication,
    uncertainty: mean(childProfiles.map((profile) => profile.uncertainty))
  });
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
 * How much of a cut can proceed at the same time.
 *
 * Concurrency is a property of the DEPTH of the production order, not of the
 * number of dependencies. Layering the children by longest path gives the number
 * of rounds the cut needs; `n` units in `L` rounds is normalized so that fully
 * independent children score 1 and a strict chain scores 0.
 *
 * Counting edges instead — `1 - edges / (children - 1)` — divided by the edge
 * count of a spanning tree, which is the fewest edges a connected cut can have.
 * Every connected cut therefore scored zero, and a fan-out, where every consumer
 * proceeds at once behind one producer, was indistinguishable from a chain,
 * where nothing does. Layered software is connected by construction, so the term
 * contributed nothing to any decomposition it was meant to judge.
 *
 * Only artifacts order the work. A seam is an interface both sides agree on
 * before either is written: it constrains WHAT they build, not WHEN.
 */
function concurrency(childKeys: readonly string[], edges: readonly ChildEdge[]): number {
  if (childKeys.length < 2) return 0;
  const levels = criticalPathLength(childKeys, edges);
  // A cut its own dependencies cannot order offers no concurrency to schedule.
  if (levels === undefined) return 0;
  return clamp01((childKeys.length - levels) / (childKeys.length - 1));
}

/**
 * How coupled a cut leaves its children, as the share of child pairs that must
 * coordinate directly.
 *
 * Two corrections over counting edges per child. A dependency that another
 * already implies is not a second handoff, so the count is taken on the
 * transitive reduction. And it is expressed as a share of the pairs that COULD
 * be coupled, so a clean decomposition does not become more expensive merely by
 * being larger: under `edges / children`, an eight-way chain cost 0.875 and a
 * four-way chain 0.75, which is backwards, and any connected cut was already
 * charged at least `(n-1)/n`.
 */
function coupling(childKeys: readonly string[], edges: readonly ChildEdge[]): number {
  if (childKeys.length < 2) return 0;
  const reduced = independentDependencyCount(childKeys, edges);
  // Children that depend on each other in a cycle are coupled to every other.
  if (reduced === undefined) return 1;
  return clamp01((2 * reduced) / (childKeys.length * (childKeys.length - 1)));
}

/** Rounds the cut needs when every unit starts as soon as its inputs exist, or `undefined` if cyclic. */
function criticalPathLength(
  nodes: readonly string[],
  edges: readonly ChildEdge[]
): number | undefined {
  const remaining = new Map(nodes.map((key) => [key, 0]));
  const outgoing = outgoingMap(nodes, edges);
  for (const edge of edges) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);

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

/** Dependencies no other path already implies, or `undefined` if the graph is cyclic. */
function independentDependencyCount(
  nodes: readonly string[],
  edges: readonly ChildEdge[]
): number | undefined {
  if (criticalPathLength(nodes, edges) === undefined) return undefined;
  const outgoing = outgoingMap(nodes, edges);
  const reachable = new Map<string, Set<string>>();
  // Safe to memoize before filling: the graph is known acyclic, so no node is
  // re-entered from its own descendants.
  const reach = (key: string): Set<string> => {
    const cached = reachable.get(key);
    if (cached !== undefined) return cached;
    const output = new Set<string>();
    reachable.set(key, output);
    for (const next of outgoing.get(key) ?? []) {
      output.add(next);
      for (const far of reach(next)) output.add(far);
    }
    return output;
  };
  return edges.filter((edge) => !(outgoing.get(edge.from) ?? []).some((next) =>
    next !== edge.to && reach(next).has(edge.to)
  )).length;
}

function outgoingMap(
  nodes: readonly string[],
  edges: readonly ChildEdge[]
): Map<string, string[]> {
  const outgoing = new Map(nodes.map((key) => [key, [] as string[]]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  return outgoing;
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

function assessment(input: {
  unitKey: string;
  candidateTreeHash: string;
  selected: GranularityStrategyDecision;
  leafFeasible: boolean;
  splitViable: boolean;
  features: GranularityStrategyFeatures;
  minimumAdvantage: number;
  evidenceRefs: string[];
  rationale: string;
  benefit?: number;
  cost?: number;
  splitAdvantage?: number;
}): GranularityStrategyAssessment {
  const benefit = round4(input.benefit ?? mean([
    input.features.contextRelief,
    input.features.parallelism,
    input.features.faultIsolation
  ]));
  const cost = round4(input.cost ?? mean([
    input.features.coordination,
    input.features.pathOverlap,
    input.features.validationDuplication,
    input.features.uncertainty
  ]));
  return {
    unitKey: input.unitKey,
    candidateTreeHash: input.candidateTreeHash,
    selected: input.selected,
    leafFeasible: input.leafFeasible,
    splitViable: input.splitViable,
    features: input.features,
    benefit,
    cost,
    splitAdvantage: round4(input.splitAdvantage ?? benefit - cost),
    minimumAdvantage: input.minimumAdvantage,
    evidenceRefs: [...input.evidenceRefs],
    rationale: input.rationale
  };
}

function features(input: Partial<GranularityStrategyFeatures>): GranularityStrategyFeatures {
  return {
    contextRelief: round4(clamp01(input.contextRelief ?? 0)),
    parallelism: round4(clamp01(input.parallelism ?? 0)),
    faultIsolation: round4(clamp01(input.faultIsolation ?? 0)),
    coordination: round4(clamp01(input.coordination ?? 0)),
    pathOverlap: round4(clamp01(input.pathOverlap ?? 0)),
    validationDuplication: round4(clamp01(input.validationDuplication ?? 0)),
    uncertainty: round4(clamp01(input.uncertainty ?? 0))
  };
}

function rationaleFor(
  condition: UtilityGranularityCondition,
  selected: GranularityStrategyDecision,
  leafFeasible: boolean,
  splitViable: boolean,
  splitAdvantage: number,
  config: UtilityPolicyConfig
): string {
  if (condition === "B") {
    return selected === "split"
      ? "Condition B expands the finest valid semantic frontier."
      : "Condition B found no valid multi-child semantic cut."
  }
  if (selected === "semantic_replan") {
    return "Leaf is infeasible and the candidate contains no viable semantic split."
  }
  if (selected === "split" && !leafFeasible) {
    return "Leaf is infeasible; C selected the available semantic split."
  }
  if (selected === "split") {
    return `Split advantage ${splitAdvantage.toFixed(4)} meets minimum ${config.minimumAdvantage.toFixed(4)}.`;
  }
  return splitViable
    ? `Split advantage ${splitAdvantage.toFixed(4)} is below minimum ${config.minimumAdvantage.toFixed(4)}.`
    : "No valid multi-child semantic split is available; leaf remains cohesive.";
}

/**
 * A leaf is one unit an agent completes inside one budgeted attempt.
 *
 * Reading and producing are separate limits. The first two bounds cover what a
 * unit must hold in context; `maxLeafPlannedPaths` covers what it must bring
 * into existence. Warehouse pilot W2 showed why the third is not optional: after
 * W1 the repository was tiny, so the root read almost nothing and passed both
 * context bounds, yet it had to create a whole Vite/React application. It was
 * judged feasible, the Architect's three-way cut was collapsed, and the merged
 * leaf spent a thirty-minute budget without delivering.
 */
function isLeafFeasible(profile: RepositoryContextProfile, config: UtilityPolicyConfig): boolean {
  return profile.measuredExistingTokens <= config.maxLeafContextTokens &&
    profile.scopePaths.length <= config.maxLeafScopePaths &&
    profile.plannedPathCount <= config.maxLeafPlannedPaths;
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

function averagePairwise<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number
): number {
  if (values.length < 2) return 0;
  const comparisons: number[] = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      comparisons.push(compare(values[left]!, values[right]!));
    }
  }
  return mean(comparisons);
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
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

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
