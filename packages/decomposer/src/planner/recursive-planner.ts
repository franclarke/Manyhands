import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

import { parseJsonObjectCandidates } from "../llm/recursive/json.js";
import type { GoalCriterion } from "./semantic-plan.js";
import type { RepositoryEvidence } from "./schema.js";

/**
 * Recursive decomposition (redesign stage 2).
 *
 * One model call per unit that needs a cut, parent-first. The contract per
 * child is five fields; everything relational is derived later, never asked
 * for. A one-shot whole-tree contract is what made six of six SP2 candidates
 * die on a single nested field the prompt never defined, and what made a
 * failure at depth 3 discard depths 0-2.
 *
 * The model never decides leaf vs composite. That is the policy's job — here
 * P4 alone (scope against the executor budget); stage 3 adds P1-P3.
 */

export const UnitProposalSchema = z.object({
  key: EntityIdSchema,
  objective: NonEmptyStringSchema,
  criterionIds: z.array(EntityIdSchema).min(1),
  existingPaths: z.array(RepoRelativePathSchema).default([]),
  plannedPaths: z.array(RepoRelativePathSchema).default([])
}).strict();

export type UnitProposal = z.infer<typeof UnitProposalSchema>;

/**
 * `rationale` is one string and it is what makes depth defensible: every level
 * of the tree can say which boundary justified it.
 */
export const CutProposalSchema = z.object({
  rationale: NonEmptyStringSchema,
  children: z.array(UnitProposalSchema).min(2)
}).strict();

export type CutProposal = z.infer<typeof CutProposalSchema>;

export interface CutRequest {
  unit: UnitProposal;
  criteria: readonly GoalCriterion[];
  evidence: readonly RepositoryEvidence[];
  /** Distance from the root; the root is 0. */
  depth: number;
  /** 1-based, within this unit only. */
  attempt: number;
  /** Exact validator diagnostics from this unit's previous attempt. */
  repairIssues: readonly string[];
  system: string;
  user: string;
}

export interface CutModel {
  proposeCut(request: CutRequest): Promise<unknown>;
}

export interface PlannedLeaf {
  kind: "leaf";
  unit: UnitProposal;
  depth: number;
}

export interface PlannedComposite {
  kind: "composite";
  unit: UnitProposal;
  rationale: string;
  children: PlannedUnit[];
  depth: number;
}

/**
 * A unit the planner could not cut. It stays in the tree in place of the
 * subtree it would have produced, so one failure never discards the units that
 * already resolved above or beside it.
 */
export interface UnresolvedUnit {
  kind: "unresolved";
  unit: UnitProposal;
  depth: number;
  diagnostics: string[];
}

export type PlannedUnit = PlannedLeaf | PlannedComposite | UnresolvedUnit;

export interface RecursivePlanObserver {
  onUnitResolved?(event: { unit: UnitProposal; kind: "leaf" | "composite"; depth: number }): void | Promise<void>;
  onCutProposed?(event: { unit: UnitProposal; rationale: string; childKeys: string[]; depth: number }): void | Promise<void>;
  onRepairAttempted?(event: { unit: UnitProposal; attempt: number; diagnostics: string[]; depth: number }): void | Promise<void>;
  onUnitUnresolved?(event: { unit: UnitProposal; diagnostics: string[]; depth: number }): void | Promise<void>;
}

export interface ExecutionBudget {
  /** Existing plus planned paths a single unit may own. */
  maxScopePaths: number;
}

export interface RecursivePlannerOptions {
  model: CutModel;
  budget: ExecutionBudget;
  /** Attempts per unit, including the first. Repairs are the attempts after it. */
  maxAttemptsPerUnit?: number;
  /** Hard stop against a model that keeps proposing cuts that never shrink. */
  maxDepth?: number;
}

export interface RecursivePlanInput {
  root: UnitProposal;
  criteria: readonly GoalCriterion[];
  evidence: readonly RepositoryEvidence[];
  observer?: RecursivePlanObserver;
}

export interface RecursivePlanResult {
  root: PlannedUnit;
  unresolved: UnresolvedUnit[];
}

export class RecursivePlanner {
  private readonly model: CutModel;
  private readonly budget: ExecutionBudget;
  private readonly maxAttempts: number;
  private readonly maxDepth: number;

  constructor(options: RecursivePlannerOptions) {
    this.model = options.model;
    this.budget = options.budget;
    this.maxAttempts = positive(options.maxAttemptsPerUnit ?? 2, "maxAttemptsPerUnit");
    this.maxDepth = positive(options.maxDepth ?? 8, "maxDepth");
  }

  async plan(input: RecursivePlanInput): Promise<RecursivePlanResult> {
    const unresolved: UnresolvedUnit[] = [];
    const root = await this.resolve(UnitProposalSchema.parse(input.root), 0, input, unresolved);
    return { root, unresolved };
  }

  private async resolve(
    unit: UnitProposal,
    depth: number,
    input: RecursivePlanInput,
    unresolved: UnresolvedUnit[]
  ): Promise<PlannedUnit> {
    if (!this.needsCut(unit) || depth >= this.maxDepth) {
      await input.observer?.onUnitResolved?.({ unit, kind: "leaf", depth });
      return { kind: "leaf", unit, depth };
    }

    const cut = await this.requestCut(unit, depth, input);
    if (cut.kind === "failed") {
      const node: UnresolvedUnit = { kind: "unresolved", unit, depth, diagnostics: cut.diagnostics };
      unresolved.push(node);
      await input.observer?.onUnitUnresolved?.({ unit, diagnostics: cut.diagnostics, depth });
      return node;
    }

    await input.observer?.onCutProposed?.({
      unit,
      rationale: cut.proposal.rationale,
      childKeys: cut.proposal.children.map((child) => child.key),
      depth
    });
    const children: PlannedUnit[] = [];
    for (const child of cut.proposal.children) {
      children.push(await this.resolve(child, depth + 1, input, unresolved));
    }
    await input.observer?.onUnitResolved?.({ unit, kind: "composite", depth });
    return { kind: "composite", unit, rationale: cut.proposal.rationale, children, depth };
  }

  /** P4 only in this stage: a unit that fits the executor budget is a leaf. */
  private needsCut(unit: UnitProposal): boolean {
    return unit.existingPaths.length + unit.plannedPaths.length > this.budget.maxScopePaths;
  }

  private async requestCut(
    unit: UnitProposal,
    depth: number,
    input: RecursivePlanInput
  ): Promise<{ kind: "ok"; proposal: CutProposal } | { kind: "failed"; diagnostics: string[] }> {
    let repairIssues: string[] = [];
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await input.observer?.onRepairAttempted?.({ unit, attempt, diagnostics: repairIssues, depth });
      }
      const prompt = buildCutPrompt({ unit, criteria: input.criteria, evidence: input.evidence, repairIssues });
      let raw: unknown;
      try {
        raw = await this.model.proposeCut({
          unit,
          criteria: input.criteria,
          evidence: input.evidence,
          depth,
          attempt,
          repairIssues,
          ...prompt
        });
      } catch (error) {
        repairIssues = [error instanceof Error ? error.message : String(error)];
        continue;
      }
      const parsed = this.validate(raw, unit, input.evidence);
      if (parsed.kind === "ok") return parsed;
      repairIssues = parsed.diagnostics;
    }
    return { kind: "failed", diagnostics: repairIssues };
  }

  /**
   * Schema first, then the two facts only the parent knows: a cut partitions
   * its parent's criteria, and an existing path must exist in the snapshot.
   */
  private validate(
    raw: unknown,
    parent: UnitProposal,
    evidence: readonly RepositoryEvidence[]
  ): { kind: "ok"; proposal: CutProposal } | { kind: "failed"; diagnostics: string[] } {
    const candidates = objectCandidates(raw);
    if (candidates.kind === "failed") return candidates;

    const failures: string[] = [];
    for (const candidate of candidates.values) {
      const parsed = CutProposalSchema.safeParse(candidate);
      if (!parsed.success) {
        failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
        continue;
      }
      const semantic = semanticIssues(parsed.data, parent, evidence);
      if (semantic.length > 0) {
        failures.push(...semantic);
        continue;
      }
      return { kind: "ok", proposal: parsed.data };
    }
    return { kind: "failed", diagnostics: unique(failures) };
  }
}

function objectCandidates(raw: unknown): { kind: "ok"; values: unknown[] } | { kind: "failed"; diagnostics: string[] } {
  if (typeof raw !== "string") return { kind: "ok", values: [raw] };
  const parsed = parseJsonObjectCandidates(raw);
  if (!parsed.ok) return { kind: "failed", diagnostics: [parsed.message] };
  return { kind: "ok", values: parsed.candidates.map((candidate) => candidate.value) };
}

function semanticIssues(
  proposal: CutProposal,
  parent: UnitProposal,
  evidence: readonly RepositoryEvidence[]
): string[] {
  const issues: string[] = [];
  const owned = new Set(parent.criterionIds);
  const claimed = new Map<string, number>();
  const keys = new Set<string>();

  for (const child of proposal.children) {
    if (keys.has(child.key)) issues.push(`children: duplicate unit key ${child.key}`);
    keys.add(child.key);
    if (child.key === parent.key) issues.push(`children: ${child.key} repeats its parent's key`);
    for (const criterionId of child.criterionIds) {
      if (!owned.has(criterionId)) {
        issues.push(`children.${child.key}.criterionIds: ${criterionId} is not owned by ${parent.key}`);
      }
      claimed.set(criterionId, (claimed.get(criterionId) ?? 0) + 1);
    }
    for (const existing of child.existingPaths) {
      if (!referenced(evidence, existing)) {
        issues.push(`children.${child.key}.existingPaths: ${existing} is not in the repository snapshot`);
      }
    }
  }

  for (const criterionId of owned) {
    const count = claimed.get(criterionId) ?? 0;
    if (count === 0) issues.push(`children: criterion ${criterionId} lost its owner in this cut`);
    if (count > 1) issues.push(`children: criterion ${criterionId} is claimed by ${count} children`);
  }
  return unique(issues);
}

function referenced(evidence: readonly RepositoryEvidence[], candidate: string): boolean {
  const normalized = candidate.replaceAll("\\", "/").toLowerCase();
  return evidence.some((item) => item.reference.replaceAll("\\", "/").toLowerCase() === normalized);
}

export interface CutPromptInput {
  unit: UnitProposal;
  criteria: readonly GoalCriterion[];
  evidence: readonly RepositoryEvidence[];
  repairIssues: readonly string[];
}

/**
 * The whole contract is shown literally. SP2 died on `interface`, a field the
 * prompt named and never shaped, so every field the validator enforces appears
 * here as an example value.
 */
export function buildCutPrompt(input: CutPromptInput): { system: string; user: string } {
  const criteria = input.criteria
    .filter((criterion) => input.unit.criterionIds.includes(criterion.id))
    .map((criterion) => `- ${criterion.id}: ${criterion.description}`)
    .join("\n");
  const evidence = input.evidence
    .map((item) => `- ${item.reference} [${item.kind}] ${item.observation}`)
    .join("\n");
  return {
    system: [
      "You cut one unit of software work into the smallest independently verifiable children.",
      "Return exactly one JSON object and nothing else. No prose before or after it.",
      "",
      "Shape:",
      CUT_OUTPUT_SHAPE,
      "",
      "Rules:",
      "- Propose at least two children. If the unit cannot be cut, return the same shape with the two most cohesive halves you can defend.",
      "- The children partition the parent's criteria: every criterion belongs to exactly one child, and none may be dropped or invented.",
      "- `existingPaths` may only contain paths listed in the repository evidence below.",
      "- `plannedPaths` are files that do not exist yet and that this child will create.",
      "- No two children may write the same path.",
      "- `rationale` states the boundary that justifies this cut in one sentence.",
      "- Do not describe interfaces, dependencies, ordering or tests between children. Those are derived, not declared."
    ].join("\n"),
    user: [
      `Unit: ${input.unit.key}`,
      `Objective: ${input.unit.objective}`,
      `Criteria this unit owns:\n${criteria || "- none"}`,
      `Paths this unit owns:\n${[...input.unit.existingPaths, ...input.unit.plannedPaths].map((item) => `- ${item}`).join("\n") || "- none"}`,
      `Repository evidence:\n${evidence || "- none"}`,
      ...(input.repairIssues.length === 0
        ? []
        : [`Your previous answer was rejected. Fix every issue and return the complete object again:\n${input.repairIssues.map((issue) => `- ${issue}`).join("\n")}`])
    ].join("\n\n")
  };
}

const CUT_OUTPUT_SHAPE = `{
  "rationale": "one sentence naming the boundary this cut follows",
  "children": [
    {
      "key": "kebab-case-unit-key",
      "objective": "the observable outcome this child owns",
      "criterionIds": ["criterion-1"],
      "existingPaths": ["src/domain/orders.js"],
      "plannedPaths": ["test/orders.test.js"]
    }
  ]
}`;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}
