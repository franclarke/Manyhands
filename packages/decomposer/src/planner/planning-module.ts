import { parseJsonObjectCandidates } from "../llm/recursive/json.js";
import type { GranularityPlanningBrief } from "../granularity/planning-brief.js";
import {
  SemanticPlanDraftSchema,
  createSemanticPlan,
  flattenSemanticWorkUnits,
  buildSemanticPlanPrompt,
  semanticPlanHash,
  type GoalCriterion,
  type RepositoryEvidence,
  type SemanticPlan
} from "./semantic-plan.js";

export interface SemanticPlanningProgressUnit {
  key: string;
  parentKey: string | null;
  kind: "composite" | "leaf";
  title: string;
  objective: string;
  siblingIndex: number;
  siblingCount: number;
}

export interface SemanticPlanningObserver {
  onAttemptStarted?(event: { attempt: number }): void | Promise<void>;
  onUnitDiscovered?(event: { attempt: number; unit: SemanticPlanningProgressUnit }): void | Promise<void>;
  onAttemptFailed?(event: { attempt: number; reason: string }): void | Promise<void>;
}

export interface SemanticPlanningModelRequest {
  system: string;
  user: string;
  attempt: number;
  repairIssues: string[];
  onProgress(unit: SemanticPlanningProgressUnit): Promise<void>;
}

export interface SemanticPlanningModel {
  generate(request: SemanticPlanningModelRequest): Promise<unknown>;
}

export interface PlanningModuleRequest {
  goal: string;
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  repositorySnapshot: {
    snapshotId: string;
    inspectionDisposition: "complete" | "partial" | "unavailable";
    evidence: readonly RepositoryEvidence[];
  };
  granularityBrief: GranularityPlanningBrief;
  candidateCount?: number;
  questionAnswers?: Readonly<Record<string, string>>;
}

export interface PlanningContinuation {
  request: PlanningModuleRequest;
}

export interface PlanningModuleError {
  code: "repository_unavailable" | "model_unavailable" | "draft_invalid" | "no_safe_candidate";
  phase: "repository" | "generation" | "compilation" | "selection";
  retryable: boolean;
  message: string;
  evidenceRefs: string[];
  suggestedAction: string;
}

export type PlanningOutcome =
  | {
      kind: "ready";
      plan: SemanticPlan;
      comparison: { kind: "complete"; safePlans: number } | { kind: "degraded"; safePlans: 1; reason: "single_safe_plan" };
      candidates: readonly SemanticPlan[];
    }
  | {
      kind: "needs_input";
      plan: SemanticPlan;
      continuation: PlanningContinuation;
      questions: readonly { id: string; question: string; options: string[]; evidenceIds: string[] }[];
      candidates: readonly SemanticPlan[];
    }
  | {
      kind: "rejected";
      error: PlanningModuleError;
    };

export interface PlanningModuleOptions {
  model: SemanticPlanningModel;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Deep planning module. Callers provide a goal and an inspected repository;
 * this module owns candidate generation, canonicalization, validation and
 * deterministic selection. No caller assembles scopes, artifacts, seams or
 * acceptance ownership from parallel structures.
 */
export class PlanningModule {
  private readonly model: SemanticPlanningModel;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(options: PlanningModuleOptions) {
    this.model = options.model;
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.retryDelayMs = nonNegativeInteger(options.retryDelayMs ?? 250, "retryDelayMs");
  }

  async plan(request: PlanningModuleRequest, observer: SemanticPlanningObserver = {}): Promise<PlanningOutcome> {
    if (request.repositorySnapshot.inspectionDisposition === "unavailable") {
      return rejected("repository_unavailable", "repository", "The repository snapshot is unavailable for semantic planning.", [], "Restore repository inspection before requesting a plan.");
    }
    const count = request.candidateCount ?? request.granularityBrief.candidateCount;
    if (!Number.isSafeInteger(count) || count < 1 || count > 3) {
      return rejected("draft_invalid", "selection", "candidateCount must be an integer between 1 and 3.", [], "Choose a bounded candidate count before planning.");
    }
    const criteria = canonicalCriteria(request.goal, request.acceptanceCriteria ?? []);
    const candidates = new Map<string, SemanticPlan>();
    const failures: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      const candidate = await this.planCandidate(request, criteria, index, count, [...candidates.keys()], offsetObserver(observer, (index - 1) * this.maxAttempts));
      if (candidate.kind === "error") {
        failures.push(candidate.message);
        continue;
      }
      candidates.set(semanticPlanHash(candidate.plan), candidate.plan);
    }
    const plans = [...candidates.values()];
    if (plans.length === 0) {
      return rejected(
        "no_safe_candidate",
        "selection",
        failures.length === 0 ? "The planner did not produce a safe semantic plan." : failures.join("; "),
        [],
        "Correct the reported draft errors and request a new bounded semantic plan."
      );
    }
    const selected = plans.slice().sort(comparePlans)[0]!;
    const questions = selected.questions.length > 0
      ? selected.questions.map((question) => ({ id: question.id, question: question.question, options: question.options, evidenceIds: question.evidenceIds }))
      : selected.uncertainties
          .filter((uncertainty) => uncertainty.requiresHumanDecision)
          .map((uncertainty) => ({ id: uncertainty.id, question: uncertainty.description, options: ["Provide direction", "Stop this run"], evidenceIds: uncertainty.evidenceIds }));
    if (questions.length > 0) {
      return { kind: "needs_input", plan: selected, continuation: { request }, questions, candidates: plans };
    }
    return {
      kind: "ready",
      plan: selected,
      comparison: plans.length === 1 ? { kind: "degraded", safePlans: 1, reason: "single_safe_plan" } : { kind: "complete", safePlans: plans.length },
      candidates: plans
    };
  }

  async resume(continuation: PlanningContinuation, answers: Readonly<Record<string, string>>, observer: SemanticPlanningObserver = {}): Promise<PlanningOutcome> {
    return await this.plan({ ...continuation.request, questionAnswers: answers }, observer);
  }

  private async planCandidate(
    request: PlanningModuleRequest,
    criteria: readonly GoalCriterion[],
    index: number,
    total: number,
    priorPlanHashes: readonly string[],
    observer: SemanticPlanningObserver
  ): Promise<{ kind: "success"; plan: SemanticPlan } | { kind: "error"; message: string }> {
    const prompt = buildSemanticPlanPrompt({
      goal: request.goal,
      criteria,
      constraints: request.constraints ?? [],
      repositorySnapshot: request.repositorySnapshot,
      granularityBrief: request.granularityBrief,
      candidate: { index, total, priorPlanHashes },
      ...(request.questionAnswers === undefined ? {} : { questionAnswers: request.questionAnswers })
    });
    let repairIssues: string[] = [];
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await observer.onAttemptStarted?.({ attempt });
      const discovered = new Set<string>();
      try {
        const outputs = normalizeModelOutputs(await this.model.generate({
          ...prompt,
          attempt,
          repairIssues,
          onProgress: async (unit) => {
            if (discovered.has(unit.key)) return;
            discovered.add(unit.key);
            await observer.onUnitDiscovered?.({ attempt, unit });
          }
        }));
        const failures: string[] = [];
        for (const output of outputs) {
          const parsed = SemanticPlanDraftSchema.safeParse(restoreCanonicalEvidence(output, request.repositorySnapshot.evidence));
          if (!parsed.success) {
            failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
            continue;
          }
          try {
            const plan = createSemanticPlan({
              goal: request.goal,
              repositorySnapshotId: request.repositorySnapshot.snapshotId,
              criteria: [...criteria],
              draft: parsed.data
            });
            for (const unit of progressUnits(plan.root)) {
              if (discovered.has(unit.key)) continue;
              discovered.add(unit.key);
              await observer.onUnitDiscovered?.({ attempt, unit });
            }
            return { kind: "success", plan };
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
          }
        }
        repairIssues = failures.length === 0 ? ["No complete SemanticPlan draft was found in the response."] : failures;
      } catch (error) {
        repairIssues = [error instanceof Error ? error.message : String(error)];
      }
      await observer.onAttemptFailed?.({ attempt, reason: repairIssues.join("; ") });
      if (attempt < this.maxAttempts && this.retryDelayMs > 0) await delay(this.retryDelayMs);
    }
    return { kind: "error", message: repairIssues.join("; ") || "Semantic plan generation failed." };
  }
}

function canonicalCriteria(goal: string, criteria: readonly string[]): GoalCriterion[] {
  const normalized = criteria.map((description) => description.trim()).filter((description) => description.length > 0);
  const source = normalized.length > 0 ? normalized : [goal];
  return source.map((description, index) => ({ id: `criterion-${index + 1}`, description, required: true }));
}

function comparePlans(left: SemanticPlan, right: SemanticPlan): number {
  const score = (plan: SemanticPlan): number => {
    const units = flattenSemanticWorkUnits(plan.root);
    const leaves = units.filter((unit) => unit.kind === "leaf").length;
    const materializedSeams = plan.seams.filter((seam) => seam.interface.materialization !== "logical").length;
    const questions = plan.questions.length + plan.uncertainties.filter((uncertainty) => uncertainty.requiresHumanDecision).length;
    return questions * 100 + materializedSeams * 4 + leaves - units.length * 0.25;
  };
  return score(left) - score(right) || left.planId.localeCompare(right.planId);
}

function progressUnits(root: SemanticPlan["root"]): SemanticPlanningProgressUnit[] {
  const output: SemanticPlanningProgressUnit[] = [];
  const visit = (unit: SemanticPlan["root"], parentKey: string | null, siblingIndex: number, siblingCount: number): void => {
    output.push({ key: unit.key, parentKey, kind: unit.kind, title: unit.title, objective: unit.objective, siblingIndex, siblingCount });
    if (unit.kind === "composite") unit.children.forEach((child, index) => visit(child, unit.key, index, unit.children.length));
  };
  visit(root, null, 0, 1);
  return output;
}

function offsetObserver(observer: SemanticPlanningObserver, offset: number): SemanticPlanningObserver {
  return {
    onAttemptStarted: observer.onAttemptStarted === undefined ? undefined : ({ attempt }) => observer.onAttemptStarted!({ attempt: offset + attempt }),
    onUnitDiscovered: observer.onUnitDiscovered === undefined ? undefined : ({ attempt, unit }) => observer.onUnitDiscovered!({ attempt: offset + attempt, unit }),
    onAttemptFailed: observer.onAttemptFailed === undefined ? undefined : ({ attempt, reason }) => observer.onAttemptFailed!({ attempt: offset + attempt, reason })
  };
}

function normalizeModelOutputs(output: unknown): unknown[] {
  if (typeof output === "string") return parseJsonObjectCandidates(output);
  if (Array.isArray(output)) return output.flatMap(normalizeModelOutputs);
  return [output];
}

function restoreCanonicalEvidence(output: unknown, evidence: readonly RepositoryEvidence[]): unknown {
  if (!isRecord(output)) return output;
  const canonicalById = new Map(evidence.map((item) => [item.id, item]));
  const declared = Array.isArray(output.repositoryEvidence) ? output.repositoryEvidence : [];
  const declaredIds = new Set(declared.filter(isRecord).map((item) => item.id).filter((id): id is string => typeof id === "string"));
  const referenced = new Set<string>();
  collectEvidenceIds(output, referenced);
  const additions = [...referenced].filter((id) => !declaredIds.has(id)).map((id) => canonicalById.get(id)).filter((item): item is RepositoryEvidence => item !== undefined);
  return additions.length === 0 ? output : { ...output, repositoryEvidence: [...declared, ...additions] };
}

function collectEvidenceIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceIds(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "evidenceIds" && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") output.add(id);
      continue;
    }
    collectEvidenceIds(child, output);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejected(code: PlanningModuleError["code"], phase: PlanningModuleError["phase"], message: string, evidenceRefs: string[], suggestedAction: string): PlanningOutcome {
  return { kind: "rejected", error: { code, phase, retryable: code === "model_unavailable", message, evidenceRefs, suggestedAction } };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer.`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
