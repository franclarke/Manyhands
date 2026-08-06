import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

import { parseJsonObjectCandidates } from "../llm/recursive/json.js";
import { GoalCriterionSchema, type GoalCriterion } from "./semantic-plan.js";
import type { RepositoryEvidence } from "./schema.js";

/**
 * Recursive decomposition to a fixpoint (redesign stages 2-3A).
 *
 * One model call per unit that needs a cut, parent-first. The contract per
 * child is five fields; everything relational is derived later, never asked
 * for. A one-shot whole-tree contract is what made six of six SP2 candidates
 * die on a single nested field the prompt never defined, and what made a
 * failure at depth 3 discard depths 0-2.
 *
 * The model never decides leaf vs composite. P4 — scope against the executor
 * budget — governs recursion, and P1-P3 are invariants of a cut repaired
 * through the same diagnostics channel.
 */

export const UnitProposalSchema = z.object({
  key: EntityIdSchema,
  objective: NonEmptyStringSchema,
  /** What this unit claims. A composite proves its own by integrating children. */
  criteria: z.array(GoalCriterionSchema).min(1),
  /** Files the unit reads and does not change. */
  reads: z.array(RepoRelativePathSchema).default([]),
  /** Files the unit creates or modifies. Creating and modifying are one promise. */
  writes: z.array(RepoRelativePathSchema).default([])
}).strict();

export type UnitProposal = z.infer<typeof UnitProposalSchema>;

/**
 * What the model actually answers, per child. Decomposing the work and
 * decomposing the acceptance are the same operation, so a child states its own
 * claim in one sentence; its id is derived from its key and can never collide.
 */
export const ChildProposalSchema = z.object({
  key: EntityIdSchema,
  objective: NonEmptyStringSchema,
  criterion: NonEmptyStringSchema,
  reads: z.array(RepoRelativePathSchema).default([]),
  writes: z.array(RepoRelativePathSchema).default([])
}).strict();

export type ChildProposal = z.infer<typeof ChildProposalSchema>;

export function criterionIdFor(unitKey: string): string {
  return `criterion:${unitKey}`;
}

function asUnit(child: ChildProposal): UnitProposal {
  return {
    key: child.key,
    objective: child.objective,
    criteria: [{ id: criterionIdFor(child.key), description: child.criterion, required: true }],
    reads: child.reads,
    writes: child.writes
  };
}

/**
 * `rationale` is one string and it is what makes depth defensible: every level
 * of the tree can say which boundary justified it.
 */
export const CutProposalSchema = z.object({
  rationale: NonEmptyStringSchema,
  children: z.array(ChildProposalSchema).min(2)
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

/** Where a unit sits, which is exactly what a durable planning event records. */
export interface UnitPosition {
  parentKey: string | null;
  siblingIndex: number;
  siblingCount: number;
}

export interface RecursivePlanObserver {
  onUnitResolved?(event: { unit: UnitProposal; kind: "leaf" | "composite"; depth: number; position: UnitPosition }): void | Promise<void>;
  onCutProposed?(event: { unit: UnitProposal; rationale: string; childKeys: string[]; depth: number }): void | Promise<void>;
  onRepairAttempted?(event: { unit: UnitProposal; attempt: number; diagnostics: string[]; depth: number }): void | Promise<void>;
  onUnitUnresolved?(event: { unit: UnitProposal; diagnostics: string[]; depth: number; position: UnitPosition }): void | Promise<void>;
}

export interface ExecutionBudget {
  /** Read plus written paths a single unit may own. */
  maxScopePaths: number;
}

export interface RecursivePlannerOptions {
  model: CutModel;
  budget: ExecutionBudget;
  /** Attempts per unit, including the first. Repairs are the attempts after it. */
  maxAttemptsPerUnit?: number;
  /** Hard stop against a model that keeps proposing cuts that never shrink. */
  maxDepth?: number;
  /** Recognizes a path that proves behaviour. Defaults to the usual conventions. */
  isTestPath?(path: string): boolean;
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

/** `test/x.test.js`, `src/x.spec.tsx`, anything under `test/` or `tests/`. */
export function isConventionalTestPath(candidate: string): boolean {
  const normalized = candidate.replaceAll("\\", "/").toLowerCase();
  return /\.(?:test|spec)\.[cm]?[tj]sx?$/u.test(normalized) ||
    /(?:^|\/)tests?\//u.test(normalized);
}

const ROOT_POSITION: UnitPosition = { parentKey: null, siblingIndex: 0, siblingCount: 1 };

export class RecursivePlanner {
  private readonly model: CutModel;
  private readonly budget: ExecutionBudget;
  private readonly maxAttempts: number;
  private readonly maxDepth: number;
  private readonly isTestPath: (path: string) => boolean;

  constructor(options: RecursivePlannerOptions) {
    this.model = options.model;
    this.budget = options.budget;
    this.maxAttempts = positive(options.maxAttemptsPerUnit ?? 2, "maxAttemptsPerUnit");
    this.maxDepth = positive(options.maxDepth ?? 8, "maxDepth");
    this.isTestPath = options.isTestPath ?? isConventionalTestPath;
  }

  async plan(input: RecursivePlanInput): Promise<RecursivePlanResult> {
    const unresolved: UnresolvedUnit[] = [];
    const snapshotPaths = snapshotPathSet(input.evidence);
    const root = await this.resolve(UnitProposalSchema.parse(input.root), 0, ROOT_POSITION, input, snapshotPaths, unresolved);
    return { root, unresolved };
  }

  private async resolve(
    unit: UnitProposal,
    depth: number,
    position: UnitPosition,
    input: RecursivePlanInput,
    snapshotPaths: ReadonlySet<string>,
    unresolved: UnresolvedUnit[]
  ): Promise<PlannedUnit> {
    if (this.fitsBudget(unit) || depth >= this.maxDepth) {
      await input.observer?.onUnitResolved?.({ unit, kind: "leaf", depth, position });
      return { kind: "leaf", unit, depth };
    }

    const cut = await this.requestCut(unit, depth, input, snapshotPaths);
    if (cut.kind === "failed") return this.giveUp(unit, depth, position, input, unresolved, cut.diagnostics);

    await input.observer?.onCutProposed?.({
      unit,
      rationale: cut.proposal.rationale,
      childKeys: cut.proposal.children.map((child) => child.key),
      depth
    });
    await input.observer?.onUnitResolved?.({ unit, kind: "composite", depth, position });
    const children: PlannedUnit[] = [];
    const siblingCount = cut.proposal.children.length;
    for (const [siblingIndex, child] of cut.proposal.children.entries()) {
      children.push(await this.resolve(
        asUnit(child),
        depth + 1,
        { parentKey: unit.key, siblingIndex, siblingCount },
        input,
        snapshotPaths,
        unresolved
      ));
    }
    return { kind: "composite", unit, rationale: cut.proposal.rationale, children, depth };
  }

  private async giveUp(
    unit: UnitProposal,
    depth: number,
    position: UnitPosition,
    input: RecursivePlanInput,
    unresolved: UnresolvedUnit[],
    diagnostics: string[]
  ): Promise<UnresolvedUnit> {
    const node: UnresolvedUnit = { kind: "unresolved", unit, depth, diagnostics };
    unresolved.push(node);
    await input.observer?.onUnitUnresolved?.({ unit, diagnostics, depth, position });
    return node;
  }

  /** P4. Reads and writes both cost the executor context, so both count. */
  private fitsBudget(unit: PathScope): boolean {
    return scopeSize(unit) <= this.budget.maxScopePaths;
  }

  private async requestCut(
    unit: UnitProposal,
    depth: number,
    input: RecursivePlanInput,
    snapshotPaths: ReadonlySet<string>
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
      const parsed = this.validate(raw, unit, snapshotPaths);
      if (parsed.kind === "ok") return parsed;
      repairIssues = parsed.diagnostics;
    }
    return { kind: "failed", diagnostics: repairIssues };
  }

  private validate(
    raw: unknown,
    parent: UnitProposal,
    snapshotPaths: ReadonlySet<string>
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
      const violations = this.cutViolations(parsed.data, parent, snapshotPaths);
      if (violations.length > 0) {
        failures.push(...violations);
        continue;
      }
      return { kind: "ok", proposal: parsed.data };
    }
    return { kind: "failed", diagnostics: unique(failures) };
  }

  /**
   * Every property a cut must satisfy, reported together. One round trip per
   * violated property would burn the repair budget on the first one found.
   */
  private cutViolations(
    proposal: CutProposal,
    parent: UnitProposal,
    snapshotPaths: ReadonlySet<string>
  ): string[] {
    const issues: string[] = [];
    const children = proposal.children;
    const inherited = new Set(parent.reads.map(normalize));
    const producedBySibling = new Map<string, string[]>();
    const keys = new Set<string>();

    for (const child of children) {
      for (const written of child.writes) {
        const path = normalize(written);
        producedBySibling.set(path, [...(producedBySibling.get(path) ?? []), child.key]);
      }
    }

    for (const child of children) {
      if (keys.has(child.key)) issues.push(`children: duplicate unit key ${child.key}`);
      keys.add(child.key);
      if (child.key === parent.key) issues.push(`children: ${child.key} repeats its parent's key`);

      // P1 — a child that already fits the budget will be a leaf, and a leaf
      // proves itself. A composite proves by integration over the merged tree.
      if (this.fitsBudget(child) && !child.writes.some((path) => this.isTestPath(path))) {
        issues.push(`P1 ${child.key}: a leaf must write at least one test file that proves its criteria; none of ${format(child.writes)} is a test path.`);
      }

      // P3 — a read must be satisfiable where the child runs.
      for (const read of child.reads) {
        const path = normalize(read);
        if (snapshotPaths.has(path) || producedBySibling.has(path) || inherited.has(path)) continue;
        issues.push(`P3 ${child.key}.reads: ${read} is not in the repository snapshot, is not written by a sibling, and is not inherited from ${parent.key}.`);
      }

      // Termination: without this a cut can hand a child everything the parent
      // had and recurse forever. It is also what "cut" means.
      if (scopeSize(child) >= scopeSize(parent)) {
        issues.push(`scope ${child.key}: a cut must shrink its children; ${child.key} carries ${scopeSize(child)} paths and ${parent.key} carries ${scopeSize(parent)}.`);
      }
    }

    // P2 — siblings never write the same file.
    for (const [path, writers] of producedBySibling) {
      if (writers.length > 1) {
        issues.push(`P2 ${writers.join(" and ")}: both write ${path}. Give the file one owner and let the others read it.`);
      }
    }

    // Coverage — a cut cannot drop what the parent promised to produce.
    for (const promised of parent.writes) {
      if (!producedBySibling.has(normalize(promised))) {
        issues.push(`writes: the parent ${parent.key} promised ${promised} and no child produces it.`);
      }
    }

    return unique(issues);
  }
}

interface PathScope { reads: readonly string[]; writes: readonly string[] }

function scopeSize(unit: PathScope): number {
  return unit.reads.length + unit.writes.length;
}

function snapshotPathSet(evidence: readonly RepositoryEvidence[]): ReadonlySet<string> {
  return new Set(evidence.filter((item) => item.kind === "path").map((item) => normalize(item.reference)));
}

function normalize(candidate: string): string {
  return candidate.replaceAll("\\", "/").toLowerCase();
}

function format(paths: readonly string[]): string {
  return paths.length === 0 ? "an empty write set" : paths.join(", ");
}

function objectCandidates(raw: unknown): { kind: "ok"; values: unknown[] } | { kind: "failed"; diagnostics: string[] } {
  if (typeof raw !== "string") return { kind: "ok", values: [raw] };
  const parsed = parseJsonObjectCandidates(raw);
  if (!parsed.ok) return { kind: "failed", diagnostics: [parsed.message] };
  return { kind: "ok", values: parsed.candidates.map((candidate) => candidate.value) };
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
  const criteria = input.unit.criteria
    .map((criterion) => `- ${criterion.description}`)
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
      "- `writes` are the files a child creates or modifies. `reads` are files it needs to read and will not change.",
      "- No two children may write the same path. If they both need it, one owns it and the others read it.",
      "- A child small enough to implement in one step must write at least one test file that proves its criteria.",
      "- Every `read` must already exist in the repository evidence below, be written by a sibling, or be one the parent already reads.",
      "- Together the children must write every path the parent promised to write.",
      "- Every child must carry strictly fewer paths than this unit; a cut that does not shrink is not a cut.",
      "- `criterion` is what that child alone claims, in one sentence. Do not repeat this unit's claim: this unit proves it by integrating its children.",
      "- `rationale` states the boundary that justifies this cut in one sentence.",
      "- Do not describe interfaces, dependencies, ordering or tests between children. Those are derived, not declared."
    ].join("\n"),
    user: [
      `Unit: ${input.unit.key}`,
      `Objective: ${input.unit.objective}`,
      `Criteria this unit owns:\n${criteria || "- none"}`,
      `Files this unit writes:\n${bullets(input.unit.writes)}`,
      `Files this unit reads:\n${bullets(input.unit.reads)}`,
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
      "criterion": "the single claim this child proves on its own",
      "reads": ["src/domain/orders.js"],
      "writes": ["src/domain/backorders.js", "test/backorders.test.js"]
    }
  ]
}`;

function bullets(paths: readonly string[]): string {
  return paths.length === 0 ? "- none" : paths.map((item) => `- ${item}`).join("\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}
