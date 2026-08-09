import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

import { parseJsonObjectCandidates } from "../llm/recursive/json.js";
import { CutFeasibilityCritic, type CutFeasibilityCriticPort } from "./cut-feasibility-critic.js";
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
  /** Parent criterion ids are the acceptance lineage for this child. */
  criterionIds: z.array(EntityIdSchema).min(1).optional(),
  /** Legacy v1 field. New cuts must use criterionIds. */
  criterion: NonEmptyStringSchema.optional(),
  reads: z.array(RepoRelativePathSchema).default([]),
  writes: z.array(RepoRelativePathSchema).default([])
}).strict().superRefine((child, context) => {
  if (child.criterionIds === undefined && child.criterion === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["criterionIds"], message: "Child must declare criterionIds for parent acceptance lineage." });
  }
  if (child.criterionIds !== undefined && child.criterion !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["criterionIds"], message: "Declare criterionIds or legacy criterion, not both." });
  }
});

export type ChildProposal = z.infer<typeof ChildProposalSchema>;

export function criterionIdFor(unitKey: string): string {
  return `criterion:${unitKey}`;
}

function asUnit(child: ChildProposal, parentCriteria: readonly GoalCriterion[]): UnitProposal {
  const criteria = child.criterionIds === undefined
    ? [parentCriteria.find((criterion) => criterion.description === child.criterion!) ?? {
      id: criterionIdFor(child.key),
      description: child.criterion!,
      required: true
    }]
    : child.criterionIds.flatMap((criterionId) => {
      const criterion = parentCriteria.find((candidate) => candidate.id === criterionId);
      return criterion === undefined ? [] : [criterion];
    });
  return {
    key: child.key,
    objective: child.objective,
    criteria,
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
  // The root may be a semantic wrapper around one executable leaf when the
  // request is cohesive. Non-root cuts still reject one-child "splits" below.
  children: z.array(ChildProposalSchema).min(1)
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
  /** Optional read-only semantic check after deterministic cut validation. */
  feasibilityCritic?: CutFeasibilityCriticPort;
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
  private readonly feasibilityCritic: CutFeasibilityCriticPort;

  constructor(options: RecursivePlannerOptions) {
    this.model = options.model;
    this.budget = options.budget;
    this.maxAttempts = positive(options.maxAttemptsPerUnit ?? 2, "maxAttemptsPerUnit");
    this.maxDepth = positive(options.maxDepth ?? 8, "maxDepth");
    this.isTestPath = options.isTestPath ?? isConventionalTestPath;
    this.feasibilityCritic = options.feasibilityCritic ?? new CutFeasibilityCritic();
  }

  async plan(input: RecursivePlanInput): Promise<RecursivePlanResult> {
    const unresolved: UnresolvedUnit[] = [];
    const snapshotPaths = snapshotPathSet(input.evidence);
    const root = UnitProposalSchema.parse(input.root);
    // Keys identify nodes and derive criterion ids, so two units sharing one
    // key collapse into a single node and silently merge their scopes. A cut
    // only sees its own siblings, so uniqueness has to be tracked for the tree.
    const claimedKeys = new Set<string>([root.key]);
    // P2 has to hold for the tree, not for one cut. A cut sees only its own
    // siblings, and coverage lets a subtree write more than its parent
    // promised, so cousins were free to claim the same file — and the compiler
    // had to rediscover collisions the scheduler should have been able to
    // assume away (D9). Ownership is tracked the same way keys are.
    const claimedWrites = new Map<string, string>();
    const resolved = await this.resolve(root, 0, ROOT_POSITION, input, snapshotPaths, unresolved, claimedKeys, claimedWrites);
    return { root: resolved, unresolved };
  }

  private async resolve(
    unit: UnitProposal,
    depth: number,
    position: UnitPosition,
    input: RecursivePlanInput,
    snapshotPaths: ReadonlySet<string>,
    unresolved: UnresolvedUnit[],
    claimedKeys: Set<string>,
    claimedWrites: Map<string, string>
  ): Promise<PlannedUnit> {
    // A leaf is a unit that can prove something. Fitting the budget is not
    // enough: the root arrives with reads and no writes, and accepting it would
    // produce a plan whose only unit promises no output at all.
    if (this.isExecutableLeaf(unit)) {
      // The backstop that makes tree-wide P2 total. A leaf is never cut, so the
      // cut-time check below cannot see it: a composite sibling resolved
      // earlier may already have claimed one of these paths deeper down.
      const contested = unit.writes
        .map((written) => ({ written, owner: claimedWrites.get(normalize(written)) }))
        .filter((item) => item.owner !== undefined && item.owner !== unit.key);
      if (contested.length > 0) {
        return this.giveUp(unit, depth, position, input, unresolved, contested.map((item) =>
          `P2 ${unit.key}: ${item.written} is already written by ${item.owner}. Two units that write one file cannot run concurrently; give the file one owner.`));
      }
      for (const written of unit.writes) claimedWrites.set(normalize(written), unit.key);
      await input.observer?.onUnitResolved?.({ unit, kind: "leaf", depth, position });
      return { kind: "leaf", unit, depth };
    }
    if (depth >= this.maxDepth) {
      return this.giveUp(unit, depth, position, input, unresolved, [
        `depth ${unit.key}: the depth limit of ${this.maxDepth} stopped this unit before it could be cut, so nothing checked that it is implementable or provable.`
      ]);
    }

    const cut = await this.requestCut(unit, depth, input, snapshotPaths, claimedKeys, claimedWrites);
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
    for (const child of cut.proposal.children) claimedKeys.add(child.key);
    for (const [siblingIndex, child] of cut.proposal.children.entries()) {
      children.push(await this.resolve(
        asUnit(child, unit.criteria),
        depth + 1,
        { parentKey: unit.key, siblingIndex, siblingCount },
        input,
        snapshotPaths,
        unresolved,
        claimedKeys,
        claimedWrites
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

  /** P4 and P1 together: small enough to implement, and able to prove itself. */
  private isExecutableLeaf(unit: UnitProposal): boolean {
    return this.fitsBudget(unit) && unit.writes.some((item) => this.isTestPath(item));
  }

  private async requestCut(
    unit: UnitProposal,
    depth: number,
    input: RecursivePlanInput,
    snapshotPaths: ReadonlySet<string>,
    claimedKeys: ReadonlySet<string>,
    claimedWrites: ReadonlyMap<string, string>
  ): Promise<{ kind: "ok"; proposal: CutProposal } | { kind: "failed"; diagnostics: string[] }> {
    let repairIssues: string[] = [];
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await input.observer?.onRepairAttempted?.({ unit, attempt, diagnostics: repairIssues, depth });
      }
      const prompt = buildCutPrompt({ unit, criteria: input.criteria, evidence: input.evidence, repairIssues, depth });
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
      const parsed = await this.validate(raw, unit, input.evidence, snapshotPaths, claimedKeys, claimedWrites);
      if (parsed.kind === "ok") return parsed;
      repairIssues = parsed.diagnostics;
    }
    return { kind: "failed", diagnostics: repairIssues };
  }

  private async validate(
    raw: unknown,
    parent: UnitProposal,
    evidence: readonly RepositoryEvidence[],
    snapshotPaths: ReadonlySet<string>,
    claimedKeys: ReadonlySet<string>,
    claimedWrites: ReadonlyMap<string, string>
  ): Promise<{ kind: "ok"; proposal: CutProposal } | { kind: "failed"; diagnostics: string[] }> {
    const candidates = objectCandidates(raw);
    if (candidates.kind === "failed") return candidates;

    const failures: string[] = [];
    for (const candidate of candidates.values) {
      const parsed = CutProposalSchema.safeParse(candidate);
      if (!parsed.success) {
        failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
        continue;
      }
      const violations = this.cutViolations(parsed.data, parent, snapshotPaths, claimedKeys, claimedWrites);
      if (violations.length > 0) {
        failures.push(...violations);
        continue;
      }
      let feasibility: Awaited<ReturnType<CutFeasibilityCriticPort["review"]>>;
      try {
        feasibility = await this.feasibilityCritic.review({ parent, proposal: parsed.data, evidence });
      } catch (error) {
        failures.push(`scope_feasibility: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!feasibility.ok) {
        failures.push(...feasibility.issues);
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
    snapshotPaths: ReadonlySet<string>,
    claimedKeys: ReadonlySet<string>,
    claimedWrites: ReadonlyMap<string, string>
  ): string[] {
    const issues: string[] = [];
    const children = proposal.children;
    if (children.length === 1 && parent.key !== "root") {
      issues.push(`children: a non-root cut must contain at least two children; only the root may wrap one cohesive executable leaf.`);
    }
    const inherited = new Set(parent.reads.map(normalize));
    const producedBySibling = new Map<string, string[]>();
    const keys = new Set<string>();
    const parentCriterionIds = new Set(parent.criteria.map((criterion) => criterion.id));
    // A v2 cut carries parent criterion ids. Legacy v1 responses carry only a
    // prose criterion and are accepted on the compatibility path; they cannot
    // establish lineage and therefore remain unproven until projected again.
    const hasLineage = children.some((child) => child.criterionIds !== undefined);
    const assignedCriterionCounts = new Map<string, number>();

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
      else if (claimedKeys.has(child.key)) {
        issues.push(`children: the key ${child.key} is already used by another unit in this plan; every unit needs its own key.`);
      }

      if (hasLineage) {
        if (child.criterionIds === undefined) {
          issues.push(`lineage ${child.key}: missing criterionIds; every child must inherit at least one criterion from ${parent.key}.`);
        } else {
          const childIds = new Set<string>();
          for (const criterionId of child.criterionIds) {
            if (childIds.has(criterionId)) issues.push(`lineage ${child.key}: duplicate criterion ${criterionId} within one child.`);
            childIds.add(criterionId);
            if (!parentCriterionIds.has(criterionId)) {
              issues.push(`lineage ${child.key}: unknown parent criterion ${criterionId}.`);
              continue;
            }
            assignedCriterionCounts.set(criterionId, (assignedCriterionCounts.get(criterionId) ?? 0) + 1);
          }
        }
      }

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

      // Termination for a cut driven by P4: without this a cut can hand a child
      // everything the parent had and recurse forever. A cut driven by P1
      // instead — the unit fits but proves nothing — is bounded by P1 itself,
      // because every child that fits must bring a test and becomes a leaf.
      // Demanding shrinkage there would make the cut unsatisfiable: a leaf that
      // reads one file and writes its test already costs what the parent cost.
      if (!this.fitsBudget(parent) && scopeSize(child) >= scopeSize(parent)) {
        issues.push(`scope ${child.key}: a cut must shrink its children; ${child.key} carries ${scopeSize(child)} paths and ${parent.key} carries ${scopeSize(parent)}.`);
      }
    }

    if (hasLineage) {
      for (const criterionId of parentCriterionIds) {
        const count = assignedCriterionCounts.get(criterionId) ?? 0;
        if (count === 0) issues.push(`lineage ${parent.key}: missing child assignment for parent criterion ${criterionId}.`);
        else if (count > 1) issues.push(`lineage ${parent.key}: duplicate child assignment for parent criterion ${criterionId}; assigned ${count} times.`);
      }
    }

    // P2 — siblings never write the same file...
    for (const [path, writers] of producedBySibling) {
      if (writers.length > 1) {
        issues.push(`P2 ${writers.join(" and ")}: both write ${path}. Give the file one owner and let the others read it.`);
      }
    }

    const cycle = siblingDependencyCycle(children, producedBySibling);
    if (cycle !== undefined) {
      issues.push(`P5 ${cycle.join(" -> ")}: sibling reads create a dependency cycle. Keep the layered work together or make each child read only its upstream producer's output.`);
    }

    // ...and neither does a unit in any other branch. The parent's own promised
    // writes are excluded: coverage *requires* a child to reproduce them, so
    // re-claiming what this branch already owns is the contract, not a clash.
    const inheritedWrites = new Set(parent.writes.map(normalize));
    for (const [path, writers] of producedBySibling) {
      const owner = claimedWrites.get(path);
      if (owner === undefined || inheritedWrites.has(path) || writers.includes(owner)) continue;
      issues.push(`P2 ${writers.join(" and ")}: ${path} is already written by ${owner} in another branch. Two units that write one file cannot run concurrently; give the file one owner and let the others read it.`);
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
  depth: number;
}

/**
 * The whole contract is shown literally. SP2 died on `interface`, a field the
 * prompt named and never shaped, so every field the validator enforces appears
 * here as an example value.
 */
export function buildCutPrompt(input: CutPromptInput): { system: string; user: string } {
  const criteria = input.unit.criteria
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
      "- `writes` are the files a child creates or modifies. `reads` are files it needs to read and will not change.",
      "- No two children may write the same path. If they both need it, one owns it and the others read it.",
      "- Sibling reads and writes must form one acyclic direction. List only the files a child needs; do not list a higher layer merely for context.",
      "- A child small enough to implement in one step must write at least one test file that proves its criteria.",
      "- Every `read` must already exist in the repository evidence below, be written by a sibling, or be one the parent already reads.",
      "- Together the children must write every path the parent promised to write.",
      "- Every child must carry strictly fewer paths than this unit; a cut that does not shrink is not a cut.",
      ...(input.depth === 0
        ? ["- This is the root: if the whole request is one cohesive executable unit, return exactly one child for the root wrapper; otherwise return at least two children."]
        : ["- This is not the root: return at least two children; a one-child wrapper is not a valid non-root cut."]),
      "- `criterionIds` assigns each parent criterion to exactly one child. Reuse the parent's ids; do not invent child criterion ids. The legacy `criterion` string is accepted only for v1 compatibility.",
      "- `rationale` states the boundary that justifies this cut in one sentence.",
      "- Do not declare abstract interfaces or ordering between children. Relations are derived only from the exact file reads and writes."
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
      "criterionIds": ["criterion-id"],
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

function siblingDependencyCycle(
  children: readonly ChildProposal[],
  producersByPath: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  const edges = new Map(children.map((child) => [child.key, new Set<string>()] as const));
  for (const child of children) {
    for (const read of child.reads) {
      for (const producer of producersByPath.get(normalize(read)) ?? []) {
        if (producer !== child.key) edges.get(producer)?.add(child.key);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (key: string): string[] | undefined => {
    if (visiting.has(key)) return [...path.slice(path.indexOf(key)), key];
    if (visited.has(key)) return undefined;
    visiting.add(key);
    path.push(key);
    for (const consumer of edges.get(key) ?? []) {
      const cycle = visit(consumer);
      if (cycle !== undefined) return cycle;
    }
    path.pop();
    visiting.delete(key);
    visited.add(key);
    return undefined;
  };

  for (const child of children) {
    const cycle = visit(child.key);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}
