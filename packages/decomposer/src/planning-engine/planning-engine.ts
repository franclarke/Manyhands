import {
  PlanningBudgetSchema,
  buildPlanningRevision,
  buildSemanticPlan,
  computeCanonicalDigest,
  type DecisionDraft,
  type DigestHasher,
  type GoalContract,
  type PlanningAlternativeRef,
  type PlanningBudget,
  type PlanningBudgetUsage,
  type PlanningFinding,
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
  | { kind: "ambiguous"; decisions: readonly DecisionDraft[]; alternatives: readonly PlanningAlternativeRef[] }
  | { kind: "unsupported"; findings: readonly ModelTerminalFinding[]; missingCapabilities: readonly string[] }
  | { kind: "rejected"; findings: readonly ModelTerminalFinding[] };

export interface ModelTerminalFinding {
  code: string;
  message: string;
  evidenceRefs: readonly string[];
}

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

export interface PlanningRepositoryReader {
  inspect(input: {
    operation: PlanningOperation;
    goal: GoalContract;
    repositoryView: RepositoryView;
    basePlan?: SemanticPlan;
    unitId?: string;
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

  private async execute(operation: PlanningOperation, request: InternalRequest, signal: AbortSignal): Promise<PlanningResult> {
    throwIfAborted(signal);
    const budget = PlanningBudgetSchema.parse(request.budget);
    const consumed = emptyUsage();
    const revisions: PlanningRevision[] = [];
    const advisoryFindings: PlanningFinding[] = [];
    const requestDigest = computeCanonicalDigest({
      operation,
      goalDigest: request.goal.digest,
      repositoryViewDigest: request.repositoryView.digest,
      basePlanDigest: request.basePlan?.digest,
      unitId: request.unitId,
      decisions: request.decisions
    }, this.hasher);

    if (operation === "expand") consumed.expansions = 1;
    if (exceeds(consumed, budget)) return rejected([budgetFinding("expansions")], trace(budget, consumed, revisions, advisoryFindings));

    const inspection = await this.repository.inspect({
      operation,
      goal: request.goal,
      repositoryView: request.repositoryView,
      ...(request.basePlan === undefined ? {} : { basePlan: request.basePlan }),
      ...(request.unitId === undefined ? {} : { unitId: request.unitId }),
      signal
    });
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

    let previousProposalDigest: string | undefined;
    let previousFindings: PlanningFinding[] = [];
    let parentDigest: string | undefined;
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

      if (proposal.kind !== "candidate") {
        consumed.revisions += 1;
        const revision = buildPlanningRevision({
          index: revisions.length + 1,
          ...(parentDigest === undefined ? {} : { parentDigest }),
          cause: revisions.length === 0 ? "initial" : "deterministic_repair",
          budget,
          consumed: { ...consumed },
          queryReceipts: [...inspection.queryReceipts],
          evidenceRefs: [...inspection.evidenceRefs],
          changedDecisionIds: proposal.kind === "needs_input" || proposal.kind === "ambiguous"
            ? proposal.decisions.map(({ id }) => id)
            : [],
          changedFindingCodes: proposal.kind === "unsupported" || proposal.kind === "rejected"
            ? proposal.findings.map(({ code }) => code)
            : []
        }, this.hasher);
        revisions.push(revision);
        return terminalResult(proposal, requestDigest, revision.digest, trace(budget, consumed, revisions, advisoryFindings));
      }

      let plan: SemanticPlan;
      let proposalDigest: string;
      try {
        plan = buildSemanticPlan(proposal.material, this.hasher);
        proposalDigest = plan.digest;
      } catch (error) {
        proposalDigest = computeCanonicalDigest(proposal.material, this.hasher);
        previousFindings = [terminalFinding("schema_invalid", error instanceof Error ? error.message : String(error), [])];
        const noProgress = previousProposalDigest === proposalDigest;
        if (noProgress) return rejected([noProgressFinding()], trace(budget, consumed, revisions, advisoryFindings));
        previousProposalDigest = proposalDigest;
        consumed.revisions += 1;
        const revision = buildRevision(budget, consumed, revisions, parentDigest, inspection, proposalDigest, previousFindings, this.hasher);
        revisions.push(revision);
        parentDigest = revision.digest;
        if (!canRepair(consumed, budget)) return rejected(previousFindings, trace(budget, consumed, revisions, advisoryFindings));
        consumed.repairs += 1;
        continue;
      }

      if (previousProposalDigest === proposalDigest) {
        return rejected([noProgressFinding()], trace(budget, consumed, revisions, advisoryFindings));
      }
      const verification = verifyPlan({
        plan,
        goal: request.goal,
        proofStrategies: request.proofStrategies,
        repositoryView: request.repositoryView,
        hasher: this.hasher
      });
      consumed.revisions += 1;
      const revision = buildRevision(budget, consumed, revisions, parentDigest, inspection, proposalDigest, verification.findings, this.hasher);
      revisions.push(revision);
      parentDigest = revision.digest;
      previousProposalDigest = proposalDigest;
      if (verification.ok) {
        if (this.critic !== undefined) {
          const reviewed = await this.critic.review({ plan, goal: request.goal, repositoryView: request.repositoryView, signal });
          advisoryFindings.push(...reviewed.map((item) => ({
            code: item.code,
            severity: "advisory" as const,
            authority: "model_advisory" as const,
            message: item.message,
            evidenceRefs: [...new Set(item.evidenceRefs)].sort(),
            resolution: item.resolution
          })));
        }
        return { kind: "ready", plan, trace: trace(budget, consumed, revisions, advisoryFindings) };
      }
      previousFindings = verification.findings;
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
  planningTrace: PlanningTrace
): PlanningResult {
  if (proposal.kind === "needs_input") {
    return {
      kind: "needs_input",
      decisions: [...proposal.decisions],
      continuation: { requestDigest, revisionDigest },
      trace: planningTrace
    };
  }
  if (proposal.kind === "ambiguous") {
    return { kind: "ambiguous", decisions: [...proposal.decisions], alternatives: [...proposal.alternatives], trace: planningTrace };
  }
  if (proposal.kind === "unsupported") {
    return {
      kind: "unsupported",
      findings: proposal.findings.map((item) => terminalFinding(item.code, item.message, item.evidenceRefs)),
      missingCapabilities: [...proposal.missingCapabilities],
      trace: planningTrace
    };
  }
  return rejected(proposal.findings.map((item) => terminalFinding(item.code, item.message, item.evidenceRefs)), planningTrace);
}

function buildRevision(
  budget: PlanningBudget,
  consumed: PlanningBudgetUsage,
  revisions: readonly PlanningRevision[],
  parentDigest: string | undefined,
  inspection: RepositoryInspection,
  proposalDigest: string,
  findings: readonly PlanningFinding[],
  hasher: DigestHasher
): PlanningRevision {
  return buildPlanningRevision({
    index: revisions.length + 1,
    ...(parentDigest === undefined ? {} : { parentDigest }),
    cause: revisions.length === 0 ? "initial" : "deterministic_repair",
    budget,
    consumed: { ...consumed },
    queryReceipts: [...inspection.queryReceipts],
    evidenceRefs: [...inspection.evidenceRefs],
    changedDecisionIds: [],
    changedFindingCodes: findings.map(({ code }) => code),
    proposalDigest
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Planning aborted.");
}
