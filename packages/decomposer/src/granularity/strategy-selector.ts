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

export type UtilityGranularityCondition = "A" | "B" | "C2";

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
  const remapped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: selected.unit,
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
    const selected = input.condition === "C2" && !leafFeasible
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
  const artifactPairs = crossChildPairs(unit.children, breakdown.candidateArtifacts);
  const relationPairs = crossChildPairs(unit.children, [
    ...breakdown.candidateArtifacts,
    ...breakdown.candidateSeams
  ]);
  const parallelism = clamp01(1 - artifactPairs.size / Math.max(1, unit.children.length - 1));
  const coordination = clamp01(relationPairs.size / Math.max(1, unit.children.length));
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

function crossChildPairs(children: WorkUnit[], relations: readonly RelationLike[]): Set<string> {
  const owner = new Map<string, string>();
  for (const child of children) {
    for (const descendant of flattenUnits(child)) owner.set(descendant.key, child.key);
  }
  const pairs = new Set<string>();
  for (const relation of relations) {
    const producer = owner.get(relation.producerUnitKey);
    if (producer === undefined) continue;
    for (const consumerKey of relation.consumerUnitKeys) {
      const consumer = owner.get(consumerKey);
      if (consumer !== undefined && consumer !== producer) pairs.add(`${producer}->${consumer}`);
    }
  }
  return pairs;
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
    return "Leaf is infeasible; C2 selected the available semantic split."
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
