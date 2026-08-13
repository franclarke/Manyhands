import {
  DecisionDraftSchema,
  PlanningAlternativeRefSchema,
  PlanningBudgetSchema,
  buildPlanningRevision,
  buildSemanticPlan,
  computeCanonicalDigest,
  verifyCanonicalDigest,
  type DecisionDraft,
  type DigestHasher,
  type GoalContract,
  type PlanningAlternativeRef,
  type PlanningBudget,
  type PlanningBudgetUsage,
  type PlanningFinding,
  type PlanningContinuation,
  type PlanningResult,
  type PlanningRevision,
  type PlanningTrace,
  type ProofStrategy,
  type SemanticPlan,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import type { RepositoryView } from "@manyhands/repository-index";
import { verifyPlan } from "../compiler/plan-verifier.js";

export interface PlanningRequest {
  goal: GoalContract;
  repositoryView: RepositoryView;
  proofStrategies: readonly ProofStrategy[];
  budget: PlanningBudget;
}

export interface ExpansionRequest extends PlanningRequest {
  basePlan: SemanticPlan;
  unitId: string;
}

export interface AmendmentDecision {
  id: string;
  selectedOptionId: string;
}

export interface AmendmentPlanningRequest extends PlanningRequest {
  basePlan: SemanticPlan;
  decisions: readonly AmendmentDecision[];
  continuation: PlanningContinuation;
  continuationContext: PlanningContinuationContext;
  decisionDrafts: readonly DecisionDraft[];
  priorTrace: PlanningTrace;
}

export interface ContinuationPlanningRequest extends PlanningRequest {
  basePlan?: SemanticPlan;
  unitId?: string;
  decisions: readonly AmendmentDecision[];
  continuation: PlanningContinuation;
  continuationContext: PlanningContinuationContext;
  decisionDrafts: readonly DecisionDraft[];
  priorTrace: PlanningTrace;
}

export interface PlanningContinuationContext {
  operation: PlanningOperation;
  basePlanDigest?: string;
  unitId?: string;
  decisions: readonly AmendmentDecision[];
  proofStrategyDigests: readonly string[];
}

export type PlanningOperation = "plan" | "expand" | "amend";

export interface PlanningModelInput {
  operation: PlanningOperation;
  goal: GoalContract;
  repositoryView: SemanticPlan["repositoryView"];
  basePlan?: SemanticPlan;
  unitId?: string;
  decisions: readonly AmendmentDecision[];
  evidenceRefs: readonly string[];
  previousFindings: readonly PlanningFinding[];
  signal: AbortSignal;
}

export type PlanningModelProposal =
  | { kind: "candidate"; material: SemanticPlanMaterial }
  | { kind: "needs_input"; decisions: readonly DecisionDraft[] }
  | { kind: "ambiguous"; decisions: readonly DecisionDraft[]; alternatives: readonly PlanningAlternativeRef[] };

export interface PlanningModel {
  propose(input: PlanningModelInput): Promise<PlanningModelProposal>;
}

export interface RepositoryInspection {
  queryReceipts: readonly string[];
  evidenceRefs: readonly string[];
  repositoryQueries: number;
  queryBytes: number;
  missingCapabilities: readonly string[];
}

export interface RepositoryInspectionAllowance {
  repositoryQueries: number;
  queryBytes: number;
}

export interface PlanningRepositoryReader {
  inspect(input: {
    operation: PlanningOperation;
    goal: GoalContract;
    repositoryView: RepositoryView;
    basePlan?: SemanticPlan;
    unitId?: string;
    allowance: Readonly<RepositoryInspectionAllowance>;
    signal: AbortSignal;
  }): Promise<RepositoryInspection>;
}

export interface ModelCriticFinding {
  code: string;
  message: string;
  evidenceRefs: readonly string[];
  resolution: "deterministic_check" | "repository_query" | "human_decision";
}

export interface ModelPlanCritic {
  review(input: { plan: SemanticPlan; goal: GoalContract; repositoryView: RepositoryView; signal: AbortSignal }): Promise<readonly ModelCriticFinding[]>;
}

export interface PlanningEngineOptions {
  model: PlanningModel;
  repository: PlanningRepositoryReader;
  hasher: DigestHasher;
  critic?: ModelPlanCritic;
}

interface InternalRequest extends PlanningRequest {
  basePlan?: SemanticPlan;
  unitId?: string;
  decisions: readonly AmendmentDecision[];
  continuation?: PlanningContinuation;
  continuationContext?: PlanningContinuationContext;
  decisionDrafts?: readonly DecisionDraft[];
  priorTrace?: PlanningTrace;
}

export class PlanningEngine {
  private readonly model: PlanningModel;
  private readonly repository: PlanningRepositoryReader;
  private readonly hasher: DigestHasher;
  private readonly critic: ModelPlanCritic | undefined;

  constructor(options: PlanningEngineOptions) {
    this.model = options.model;
    this.repository = options.repository;
    this.hasher = options.hasher;
    this.critic = options.critic;
  }

  plan(input: PlanningRequest, signal: AbortSignal): Promise<PlanningResult> {
    return this.execute("plan", { ...input, decisions: [] }, signal);
  }

  expand(input: ExpansionRequest, signal: AbortSignal): Promise<PlanningResult> {
    return this.execute("expand", { ...input, decisions: [] }, signal);
  }

  amend(input: AmendmentPlanningRequest, signal: AbortSignal): Promise<PlanningResult> {
    return this.execute("amend", input, signal);
  }

  continue(input: ContinuationPlanningRequest, signal: AbortSignal): Promise<PlanningResult> {
    return this.execute(input.continuationContext.operation, input, signal);
  }

  private async execute(operation: PlanningOperation, request: InternalRequest, signal: AbortSignal): Promise<PlanningResult> {
    throwIfAborted(signal);
    const budget = PlanningBudgetSchema.parse(request.budget);
    const consumed = request.priorTrace === undefined ? emptyUsage() : { ...request.priorTrace.consumed };
    const revisions: PlanningRevision[] = request.priorTrace === undefined ? [] : [...request.priorTrace.revisions];
    const advisoryFindings: PlanningFinding[] = request.priorTrace === undefined
      ? []
      : [...request.priorTrace.advisoryFindings];
    const requestDigest = request.continuation?.requestDigest ?? planningRequestDigest(operation, request, this.hasher);

    if (operation === "expand" && request.continuation === undefined) consumed.expansions = 1;
    if (exceeds(consumed, budget)) return rejected([budgetFinding("expansions")], trace(budget, consumed, revisions, advisoryFindings));

    const inputFinding = validateOperationInput(operation, request, this.hasher);
    if (inputFinding !== undefined) {
      return rejected([inputFinding], trace(budget, consumed, revisions, advisoryFindings));
    }

    const allowance = Object.freeze({
      repositoryQueries: budget.repositoryQueries - consumed.repositoryQueries,
      queryBytes: budget.queryBytes - consumed.queryBytes
    });
    if (allowance.repositoryQueries === 0 || allowance.queryBytes === 0) {
      return rejected([
        budgetFinding(allowance.repositoryQueries === 0 ? "repositoryQueries" : "queryBytes")
      ], trace(budget, consumed, revisions, advisoryFindings));
    }

    const inspection = await this.repository.inspect({
      operation,
      goal: request.goal,
      repositoryView: request.repositoryView,
      ...(request.basePlan === undefined ? {} : { basePlan: request.basePlan }),
      ...(request.unitId === undefined ? {} : { unitId: request.unitId }),
      allowance,
      signal
    });
    if (
      inspection.repositoryQueries > allowance.repositoryQueries ||
      inspection.queryBytes > allowance.queryBytes
    ) {
      return rejected([budgetFinding(
        inspection.repositoryQueries > allowance.repositoryQueries ? "repositoryQueries" : "queryBytes"
      )], trace(budget, consumed, revisions, advisoryFindings));
    }
    consumed.repositoryQueries += inspection.repositoryQueries;
    consumed.queryBytes += inspection.queryBytes;
    if (exceeds(consumed, budget)) {
      return rejected([budgetFinding(exceededKey(consumed, budget) ?? "repository")], trace(budget, consumed, revisions, advisoryFindings));
    }
    if (inspection.missingCapabilities.length > 0) {
      return {
        kind: "unsupported",
        findings: inspection.missingCapabilities.map((capability) => terminalFinding(
          "missing_capability",
          `Repository inspection requires ${capability}.`,
          inspection.evidenceRefs
        )),
        missingCapabilities: [...inspection.missingCapabilities],
        trace: trace(budget, consumed, revisions, advisoryFindings)
      };
    }

    const seenCausalStates = new Set(revisions.flatMap(({ causalStateDigest }) =>
      causalStateDigest === undefined ? [] : [causalStateDigest]
    ));
    let previousFindings: PlanningFinding[] = [];
    let parentDigest = revisions.at(-1)?.digest ?? request.basePlan?.digest;
    for (;;) {
      throwIfAborted(signal);
      const blockedKey = nextStepBudgetBlock(consumed, budget);
      if (blockedKey !== undefined) {
        return rejected([budgetFinding(blockedKey)], trace(budget, consumed, revisions, advisoryFindings));
      }
      const proposal = await this.model.propose({
        operation,
        goal: request.goal,
        repositoryView: {
          digest: request.repositoryView.digest,
          treeSha: request.repositoryView.treeSha,
          resourceCatalogDigest: request.repositoryView.catalog.digest
        },
        ...(request.basePlan === undefined ? {} : { basePlan: request.basePlan }),
        ...(request.unitId === undefined ? {} : { unitId: request.unitId }),
        decisions: request.decisions,
        evidenceRefs: inspection.evidenceRefs,
        previousFindings,
        signal
      });
      consumed.modelCalls += 1;

      if (!isPlanningModelProposal(proposal)) {
        return rejected([terminalFinding(
          "model_protocol_invalid",
          "Planning model returned an unsupported result kind.",
          []
        )], trace(budget, consumed, revisions, advisoryFindings));
      }

      if (proposal.kind !== "candidate") {
        consumed.revisions += 1;
        const revision = buildPlanningRevision({
          index: revisions.length + 1,
          ...(parentDigest === undefined ? {} : { parentDigest }),
          cause: revisionCause(operation, revisions.length, request.decisions),
          budget,
          consumed: { ...consumed },
          queryReceipts: [...inspection.queryReceipts],
          evidenceRefs: [...inspection.evidenceRefs],
          changedDecisionIds: proposal.kind === "needs_input" || proposal.kind === "ambiguous"
            ? proposal.decisions.map(({ id }) => id)
            : [],
          changedFindingCodes: []
        }, this.hasher);
        revisions.push(revision);
        return terminalResult(proposal, requestDigest, revision.digest, trace(budget, consumed, revisions, advisoryFindings), this.hasher);
      }

      let plan: SemanticPlan;
      let proposalDigest: string;
      try {
        plan = buildSemanticPlan(proposal.material, this.hasher);
        proposalDigest = plan.digest;
      } catch (error) {
        proposalDigest = computeCanonicalDigest(proposal.material, this.hasher);
        previousFindings = [terminalFinding("schema_invalid", error instanceof Error ? error.message : String(error), [])];
        const causalDigest = planningCausalStateDigest(proposalDigest, request, inspection, previousFindings, this.hasher);
        if (seenCausalStates.has(causalDigest)) return rejected([noProgressFinding()], trace(budget, consumed, revisions, advisoryFindings));
        seenCausalStates.add(causalDigest);
        consumed.revisions += 1;
        const revision = buildRevision(operation, request.decisions, budget, consumed, revisions, parentDigest, inspection, proposalDigest, causalDigest, previousFindings, this.hasher);
        revisions.push(revision);
        parentDigest = revision.digest;
        if (!canRepair(consumed, budget)) return rejected(previousFindings, trace(budget, consumed, revisions, advisoryFindings));
        consumed.repairs += 1;
        continue;
      }

      if (request.basePlan?.digest === proposalDigest) {
        return rejected([noProgressFinding()], trace(budget, consumed, revisions, advisoryFindings));
      }
      const transitionFinding = validateProposalTransition(operation, request, plan);
      if (transitionFinding !== undefined) {
        return rejected([transitionFinding], trace(budget, consumed, revisions, advisoryFindings));
      }
      const verification = verifyPlan({
        plan,
        goal: request.goal,
        proofStrategies: request.proofStrategies,
        repositoryView: request.repositoryView,
        hasher: this.hasher
      });
      const causalDigest = planningCausalStateDigest(proposalDigest, request, inspection, verification.findings, this.hasher);
      if (seenCausalStates.has(causalDigest)) {
        return rejected([noProgressFinding()], trace(budget, consumed, revisions, advisoryFindings));
      }
      seenCausalStates.add(causalDigest);
      consumed.revisions += 1;
      const revision = buildRevision(operation, request.decisions, budget, consumed, revisions, parentDigest, inspection, proposalDigest, causalDigest, verification.findings, this.hasher);
      revisions.push(revision);
      parentDigest = revision.digest;
      if (verification.ok) {
        advisoryFindings.push(...verification.findings.filter(({ severity }) => severity !== "error"));
        if (operation === "expand" && request.basePlan !== undefined && request.unitId !== undefined &&
          !insideExpansionEnvelope(request.basePlan, plan, request.unitId, this.hasher)) {
          return needsInput(
            [expansionAmendmentDecision()],
            requestDigest,
            revision.digest,
            trace(budget, consumed, revisions, advisoryFindings),
            this.hasher
          );
        }
        if (this.critic !== undefined && consumed.modelCalls < budget.modelCalls) {
          consumed.modelCalls += 1;
          try {
            const reviewed = await this.critic.review({ plan, goal: request.goal, repositoryView: request.repositoryView, signal });
            advisoryFindings.push(...reviewed.map((item) => ({
              code: item.code,
              severity: "advisory" as const,
              authority: "model_advisory" as const,
              message: item.message,
              evidenceRefs: [...new Set(item.evidenceRefs)].sort(),
              resolution: item.resolution
            })));
          } catch (error) {
            if (signal.aborted) throw error;
            advisoryFindings.push({
              code: "critic_unavailable",
              severity: "advisory",
              authority: "model_advisory",
              message: "The optional model critic was unavailable; deterministic verification remains authoritative.",
              evidenceRefs: [],
              resolution: "human_decision"
            });
          }
        }
        return { kind: "ready", plan, trace: trace(budget, consumed, revisions, advisoryFindings) };
      }
      previousFindings = verification.findings;
      if (verification.findings.length > 0 && verification.findings.every(({ code }) => proofAuthorityFindingCodes.has(code))) {
        return needsInput(
          [proofAuthorityDecision(verification.findings)],
          requestDigest,
          revision.digest,
          trace(budget, consumed, revisions, advisoryFindings),
          this.hasher
        );
      }
      if (!canRepair(consumed, budget)) {
        return rejected(previousFindings, trace(budget, consumed, revisions, advisoryFindings));
      }
      consumed.repairs += 1;
    }
  }
}

function terminalResult(
  proposal: Exclude<PlanningModelProposal, { kind: "candidate" }>,
  requestDigest: string,
  revisionDigest: string,
  planningTrace: PlanningTrace,
  hasher: DigestHasher
): PlanningResult {
  if (proposal.kind === "needs_input") {
    return {
      kind: "needs_input",
      decisions: [...proposal.decisions],
      continuation: continuation(requestDigest, revisionDigest, proposal.decisions, hasher),
      trace: planningTrace
    };
  }
  return { kind: "ambiguous", decisions: [...proposal.decisions], alternatives: [...proposal.alternatives], trace: planningTrace };
}

function buildRevision(
  operation: PlanningOperation,
  decisions: readonly AmendmentDecision[],
  budget: PlanningBudget,
  consumed: PlanningBudgetUsage,
  revisions: readonly PlanningRevision[],
  parentDigest: string | undefined,
  inspection: RepositoryInspection,
  proposalDigest: string,
  causalStateDigest: string,
  findings: readonly PlanningFinding[],
  hasher: DigestHasher
): PlanningRevision {
  return buildPlanningRevision({
    index: revisions.length + 1,
    ...(parentDigest === undefined ? {} : { parentDigest }),
    cause: revisionCause(operation, revisions.length, decisions),
    budget,
    consumed: { ...consumed },
    queryReceipts: [...inspection.queryReceipts],
    evidenceRefs: [...inspection.evidenceRefs],
    changedDecisionIds: decisions.map(({ id }) => id),
    changedFindingCodes: findings.map(({ code }) => code),
    proposalDigest,
    causalStateDigest
  }, hasher);
}

function canRepair(consumed: PlanningBudgetUsage, budget: PlanningBudget): boolean {
  return consumed.repairs < budget.repairs && consumed.modelCalls < budget.modelCalls && consumed.revisions < budget.revisions;
}

function nextStepBudgetBlock(consumed: PlanningBudgetUsage, budget: PlanningBudget): keyof PlanningBudget | undefined {
  if (consumed.modelCalls >= budget.modelCalls) return "modelCalls";
  if (consumed.revisions >= budget.revisions) return "revisions";
  return undefined;
}

function exceeds(consumed: PlanningBudgetUsage, budget: PlanningBudget): boolean {
  return exceededKey(consumed, budget) !== undefined;
}

function exceededKey(consumed: PlanningBudgetUsage, budget: PlanningBudget): keyof PlanningBudget | undefined {
  return (Object.keys(consumed) as Array<keyof PlanningBudgetUsage>).find((key) => consumed[key] > budget[key]);
}

function emptyUsage(): PlanningBudgetUsage {
  return { modelCalls: 0, repositoryQueries: 0, queryBytes: 0, revisions: 0, repairs: 0, expansions: 0 };
}

function trace(
  budget: PlanningBudget,
  consumed: PlanningBudgetUsage,
  revisions: readonly PlanningRevision[],
  advisoryFindings: readonly PlanningFinding[]
): PlanningTrace {
  return {
    budget: { ...budget },
    consumed: { ...consumed },
    revisions: [...revisions],
    advisoryFindings: [...advisoryFindings].sort((left, right) => left.code.localeCompare(right.code))
  };
}

function rejected(findings: readonly PlanningFinding[], planningTrace: PlanningTrace): PlanningResult {
  return { kind: "rejected", findings: [...findings], trace: planningTrace };
}

function terminalFinding(code: string, message: string, evidenceRefs: readonly string[]): PlanningFinding {
  return {
    code,
    severity: "error",
    authority: "deterministic",
    message,
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    resolution: "none"
  };
}

function budgetFinding(key: string): PlanningFinding {
  return terminalFinding("budget_exhausted", `Planning budget exhausted at ${key}.`, []);
}

function noProgressFinding(): PlanningFinding {
  return terminalFinding("no_progress", "Planning repeated an equivalent proposal without a causal change.", []);
}

function revisionCause(
  operation: PlanningOperation,
  revisionCount: number,
  decisions: readonly AmendmentDecision[]
): PlanningRevision["cause"] {
  if (decisions.length > 0) return "human_decision";
  if (operation === "expand") return "expansion";
  if (operation === "amend") return "amendment";
  return revisionCount === 0 ? "initial" : "deterministic_repair";
}

function isPlanningModelProposal(value: unknown): value is PlanningModelProposal {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "candidate") {
    const material = (value as { material?: unknown }).material;
    return typeof material === "object" && material !== null;
  }
  if (kind === "needs_input") {
    const decisions = (value as { decisions?: unknown }).decisions;
    return validDecisions(decisions);
  }
  if (kind === "ambiguous") {
    const decisions = (value as { decisions?: unknown }).decisions;
    const alternatives = (value as { alternatives?: unknown }).alternatives;
    return validDecisions(decisions) && Array.isArray(alternatives) && alternatives.length >= 2 &&
      alternatives.every((item) => PlanningAlternativeRefSchema.safeParse(item).success) &&
      uniqueBy(alternatives, (item) => (item as PlanningAlternativeRef).id) &&
      uniqueBy(alternatives, (item) => (item as PlanningAlternativeRef).proposalDigest);
  }
  return false;
}

function validDecisions(value: unknown): value is DecisionDraft[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((item) => DecisionDraftSchema.safeParse(item).success) &&
    uniqueBy(value, (item) => (item as DecisionDraft).id) &&
    value.every((item) => uniqueBy((item as DecisionDraft).options, ({ id }) => id));
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

function validateOperationInput(
  operation: PlanningOperation,
  request: InternalRequest,
  hasher: DigestHasher
): PlanningFinding | undefined {
  if (operation === "plan") {
    return request.continuation === undefined ? undefined : validateContinuation(request, hasher);
  }
  const basePlan = request.basePlan;
  if (basePlan === undefined) {
    return terminalFinding("base_plan_missing", `${operation} requires an exact base SemanticPlan.`, []);
  }
  if (!verifyCanonicalDigest(basePlan, "digest", hasher)) {
    return terminalFinding("base_plan_digest_mismatch", "Base SemanticPlan digest does not identify its canonical content.", []);
  }
  if (
    basePlan.goalContract.id !== request.goal.id ||
    basePlan.goalContract.revision !== request.goal.revision ||
    basePlan.goalContract.digest !== request.goal.digest ||
    basePlan.repositoryView.digest !== request.repositoryView.digest ||
    basePlan.repositoryView.treeSha !== request.repositoryView.treeSha ||
    basePlan.repositoryView.resourceCatalogDigest !== request.repositoryView.catalog.digest
  ) {
    return terminalFinding("base_plan_binding_mismatch", "Base SemanticPlan is not bound to the exact goal and RepositoryView.", []);
  }
  if (operation === "expand") {
    const target = request.unitId === undefined ? undefined : basePlan.units[request.unitId];
    if (target === undefined) {
      return terminalFinding("expansion_target_missing", `Expansion target ${request.unitId ?? "<missing>"} does not exist.`, []);
    }
    if (target.expansion !== "frontier" || target.granularity.disposition !== "frontier") {
      return terminalFinding("expansion_target_not_frontier", `Expansion target ${target.id} is not a planning frontier.`, []);
    }
  }
  if (operation === "amend" && request.decisions.length === 0) {
    return terminalFinding("amendment_decision_missing", "Amendment requires at least one selected decision.", []);
  }
  return request.continuation === undefined ? undefined : validateContinuation(request, hasher);
}

function validateContinuation(request: InternalRequest, hasher: DigestHasher): PlanningFinding | undefined {
  const continuationValue = request.continuation;
  const context = request.continuationContext;
  const drafts = request.decisionDrafts;
  const priorTrace = request.priorTrace;
  const basePlan = request.basePlan;
  if (
    continuationValue === undefined || context === undefined || drafts === undefined ||
    priorTrace === undefined
  ) {
    return terminalFinding("continuation_missing", "Amendment requires the exact prior continuation, decision drafts, and planning trace.", []);
  }
  if (!validDecisions(drafts)) {
    return terminalFinding("continuation_decisions_invalid", "Continuation decision drafts are invalid or ambiguous.", []);
  }
  if (decisionSetDigest(drafts, hasher) !== continuationValue.decisionSetDigest) {
    return terminalFinding("continuation_decisions_mismatch", "Decision drafts do not match the continuation decision set.", []);
  }
  if (!validAmendmentSelections(request.decisions, drafts)) {
    return terminalFinding("amendment_selection_invalid", "Each amendment selection must name one exact decision option from the continuation.", []);
  }
  if (context.basePlanDigest !== basePlan?.digest) {
    return terminalFinding("continuation_base_plan_mismatch", "Continuation is not bound to the supplied base SemanticPlan.", []);
  }
  const originalRequest = {
    ...request,
    decisions: context.decisions,
    ...(basePlan === undefined ? {} : { basePlan }),
    ...(context.unitId === undefined ? {} : { unitId: context.unitId })
  };
  if (planningRequestDigest(context.operation, originalRequest, hasher, context.proofStrategyDigests) !== continuationValue.requestDigest) {
    return terminalFinding("continuation_request_mismatch", "Continuation does not match the exact original planning request.", []);
  }
  if (!validPriorTrace(priorTrace, continuationValue, context, request.budget, hasher)) {
    return terminalFinding("continuation_trace_invalid", "Continuation revision is not the canonical tip of the supplied prior trace.", []);
  }
  return undefined;
}

function validAmendmentSelections(
  selections: readonly AmendmentDecision[],
  drafts: readonly DecisionDraft[]
): boolean {
  if (selections.length === 0 || !uniqueBy(selections, ({ id }) => id)) return false;
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  return selections.every(({ id, selectedOptionId }) =>
    draftsById.get(id)?.options.some((option) => option.id === selectedOptionId) === true
  );
}

function validPriorTrace(
  priorTrace: PlanningTrace,
  continuationValue: PlanningContinuation,
  context: PlanningContinuationContext,
  budget: PlanningBudget,
  hasher: DigestHasher
): boolean {
  if (priorTrace.revisions.length === 0) return false;
  const budgetDigest = computeCanonicalDigest(budget, hasher);
  if (computeCanonicalDigest(priorTrace.budget, hasher) !== budgetDigest) return false;
  for (const [index, revision] of priorTrace.revisions.entries()) {
    if (
      !verifyCanonicalDigest(revision, "digest", hasher) || revision.index !== index + 1 ||
      computeCanonicalDigest(revision.budget, hasher) !== budgetDigest
    ) return false;
    const expectedParent = index === 0 ? context.basePlanDigest : priorTrace.revisions[index - 1]!.digest;
    if (revision.parentDigest !== expectedParent) return false;
  }
  const tip = priorTrace.revisions.at(-1);
  return tip?.digest === continuationValue.revisionDigest &&
    computeCanonicalDigest(tip.consumed, hasher) === computeCanonicalDigest(priorTrace.consumed, hasher);
}

function planningRequestDigest(
  operation: PlanningOperation,
  request: Pick<InternalRequest, "goal" | "repositoryView" | "proofStrategies" | "basePlan" | "unitId" | "decisions">,
  hasher: DigestHasher,
  proofStrategyDigests: readonly string[] = request.proofStrategies.map(({ digest }) => digest)
): string {
  return computeCanonicalDigest({
    operation,
    goalDigest: request.goal.digest,
    repositoryViewDigest: request.repositoryView.digest,
    basePlanDigest: request.basePlan?.digest,
    unitId: request.unitId,
    decisions: request.decisions,
    proofStrategyDigests: [...new Set(proofStrategyDigests)].sort()
  }, hasher);
}

function planningCausalStateDigest(
  proposalDigest: string,
  request: InternalRequest,
  inspection: RepositoryInspection,
  findings: readonly PlanningFinding[],
  hasher: DigestHasher
): string {
  return computeCanonicalDigest({
    proposalDigest,
    proofStrategyDigests: request.proofStrategies.map(({ digest }) => digest).sort(),
    decisions: [...request.decisions].sort((left, right) => left.id.localeCompare(right.id)),
    evidenceRefs: [...new Set(inspection.evidenceRefs)].sort(),
    queryReceipts: [...new Set(inspection.queryReceipts)].sort(),
    findings: findings.map(({ code, authority, resolution, subjectId }) => ({ code, authority, resolution, subjectId }))
      .sort((left, right) => `${left.code}\0${left.subjectId ?? ""}`.localeCompare(`${right.code}\0${right.subjectId ?? ""}`))
  }, hasher);
}

function validateProposalTransition(
  operation: PlanningOperation,
  request: InternalRequest,
  plan: SemanticPlan
): PlanningFinding | undefined {
  if (operation === "plan") return undefined;
  const basePlan = request.basePlan!;
  if (plan.id !== basePlan.id || plan.revision !== basePlan.revision + 1) {
    return terminalFinding(
      "invalid_plan_transition",
      `${operation} must preserve the plan id and produce revision ${basePlan.revision + 1}.`,
      []
    );
  }
  if (operation === "expand" && request.unitId !== undefined) {
    const target = plan.units[request.unitId];
    const hasNewDescendant = Object.keys(plan.units).some((unitId) =>
      basePlan.units[unitId] === undefined && descendsFrom(plan, unitId, request.unitId!)
    );
    if (target === undefined || target.expansion === "frontier" || target.granularity.disposition === "frontier" || !hasNewDescendant) {
      return terminalFinding(
        "expansion_not_materialized",
        `Expansion target ${request.unitId} must become an expanded composite with at least one new descendant.`,
        []
      );
    }
  }
  return undefined;
}

function insideExpansionEnvelope(
  basePlan: SemanticPlan,
  plan: SemanticPlan,
  targetId: string,
  hasher: DigestHasher
): boolean {
  const baseTarget = basePlan.units[targetId];
  const nextTarget = plan.units[targetId];
  if (baseTarget === undefined || nextTarget === undefined) return false;
  for (const field of ["id", "parentId", "role", "title", "objective", "criteria", "boundary", "outcomes"] as const) {
    if (computeCanonicalDigest(baseTarget[field], hasher) !== computeCanonicalDigest(nextTarget[field], hasher)) return false;
  }
  for (const [unitId, unit] of Object.entries(basePlan.units)) {
    if (unitId === targetId) continue;
    const next = plan.units[unitId];
    if (next === undefined || computeCanonicalDigest(unit, hasher) !== computeCanonicalDigest(next, hasher)) return false;
  }
  const permittedResources = new Set(baseTarget.repositorySurface.resourceRefs);
  const permittedPaths = new Set(baseTarget.repositorySurface.pathHints.map(normalizeEnvelopePath));
  const expansionUnitIds = new Set<string>([targetId]);
  for (const unitId of Object.keys(plan.units)) {
    const isNew = basePlan.units[unitId] === undefined;
    if (!isNew && unitId !== targetId) continue;
    if (isNew && !descendsFrom(plan, unitId, targetId)) return false;
    expansionUnitIds.add(unitId);
    const unit = plan.units[unitId]!;
    if (unit.repositorySurface.resourceRefs.some((resourceId) => !permittedResources.has(resourceId))) return false;
    if (unit.resourceIntents.some(({ resourceId }) => !permittedResources.has(resourceId))) return false;
    if (unit.repositorySurface.pathHints.some((path) => !withinPathEnvelope(normalizeEnvelopePath(path), permittedPaths))) return false;
  }
  for (const [seamId, seam] of Object.entries(plan.seams)) {
    const previous = basePlan.seams[seamId];
    if (previous !== undefined) {
      if (
        computeCanonicalDigest(previous, hasher) !== computeCanonicalDigest(seam, hasher) &&
        !localOwnershipTransfer(previous, seam, targetId, expansionUnitIds, hasher)
      ) return false;
      continue;
    }
    if (!expansionUnitIds.has(seam.producerUnitId) || seam.consumerUnitIds.some((id) => !expansionUnitIds.has(id))) return false;
  }
  for (const [artifactId, artifact] of Object.entries(plan.artifacts)) {
    const previous = basePlan.artifacts[artifactId];
    if (previous !== undefined) {
      if (
        computeCanonicalDigest(previous, hasher) !== computeCanonicalDigest(artifact, hasher) &&
        !localOwnershipTransfer(previous, artifact, targetId, expansionUnitIds, hasher)
      ) return false;
      continue;
    }
    if (!expansionUnitIds.has(artifact.producerUnitId) || artifact.consumerUnitIds.some((id) => !expansionUnitIds.has(id))) return false;
  }
  return true;
}

function localOwnershipTransfer(
  previous: { producerUnitId: string; consumerUnitIds: string[] },
  next: { producerUnitId: string; consumerUnitIds: string[] },
  targetId: string,
  expansionUnitIds: ReadonlySet<string>,
  hasher: DigestHasher
): boolean {
  if (
    previous.producerUnitId !== targetId ||
    next.producerUnitId === targetId ||
    !expansionUnitIds.has(next.producerUnitId)
  ) return false;
  const previousConsumers = new Set(previous.consumerUnitIds);
  if (previous.consumerUnitIds.some((id) => !next.consumerUnitIds.includes(id))) return false;
  if (next.consumerUnitIds.some((id) => !previousConsumers.has(id) && !expansionUnitIds.has(id))) return false;
  const withoutOwnership = (value: typeof previous | typeof next) => {
    const material = structuredClone(value) as Record<string, unknown>;
    Reflect.deleteProperty(material, "producerUnitId");
    Reflect.deleteProperty(material, "consumerUnitIds");
    return material;
  };
  return computeCanonicalDigest(withoutOwnership(previous), hasher) ===
    computeCanonicalDigest(withoutOwnership(next), hasher);
}

function normalizeEnvelopePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function withinPathEnvelope(path: string, envelope: ReadonlySet<string>): boolean {
  return [...envelope].some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

function descendsFrom(plan: SemanticPlan, unitId: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  let current = plan.units[unitId];
  while (current?.parentId !== undefined && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = plan.units[current.parentId];
  }
  return false;
}

const proofAuthorityFindingCodes = new Set([
  "required_criterion_uncovered",
  "missing_proof_strategy",
  "proof_obligation_mismatch",
  "proof_criterion_mismatch",
  "proof_pair_not_allowed",
  "independence_mismatch",
  "proof_authority_not_allowed",
  "proof_mode_not_allowed"
]);

function proofAuthorityDecision(findings: readonly PlanningFinding[]): DecisionDraft {
  return {
    id: "decision:proof-authority",
    question: "Which authorized proof should satisfy the uncovered required criterion?",
    rationale: "The deterministic verifier found no allowed proof authority; model opinion cannot replace it.",
    options: [
      {
        id: "option:provide-proof",
        label: "Provide proof strategy",
        consequences: ["Planning can continue only after an allowed, repository-bound ProofStrategy is supplied."]
      },
      {
        id: "option:revise-criterion",
        label: "Revise criterion",
        consequences: ["The GoalContract must be amended explicitly before planning continues."]
      }
    ],
    evidenceRefs: [...new Set(findings.flatMap(({ evidenceRefs }) => evidenceRefs))].sort()
  };
}

function expansionAmendmentDecision(): DecisionDraft {
  return {
    id: "decision:expansion-envelope",
    question: "Should the proposed expansion amend the approved plan envelope?",
    rationale: "The proposal changes responsibility outside the selected planning frontier.",
    options: [
      {
        id: "option:approve-amendment",
        label: "Approve amendment",
        consequences: ["Adopt the broader change as a new approved plan revision."]
      },
      {
        id: "option:keep-envelope",
        label: "Keep envelope",
        consequences: ["Request a replacement expansion confined to the existing frontier."]
      }
    ],
    evidenceRefs: []
  };
}

function needsInput(
  decisions: readonly DecisionDraft[],
  requestDigest: string,
  revisionDigest: string,
  planningTrace: PlanningTrace,
  hasher: DigestHasher
): PlanningResult {
  return {
    kind: "needs_input",
    decisions: [...decisions],
    continuation: continuation(requestDigest, revisionDigest, decisions, hasher),
    trace: planningTrace
  };
}

function continuation(
  requestDigest: string,
  revisionDigest: string,
  decisions: readonly DecisionDraft[],
  hasher: DigestHasher
): PlanningContinuation {
  return { requestDigest, revisionDigest, decisionSetDigest: decisionSetDigest(decisions, hasher) };
}

function decisionSetDigest(decisions: readonly DecisionDraft[], hasher: DigestHasher): string {
  return computeCanonicalDigest([...decisions].sort((left, right) => left.id.localeCompare(right.id)), hasher);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Planning aborted.");
}
