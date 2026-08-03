import { canonicalizeSemanticPlan, digest } from "./canonicalize.js";
import { compileSemanticPlan, executionCutIssues, selectExecutionCut } from "./compiler.js";
import type {
  NotReadyPlanningOutcome,
  PlanningAttemptRecord,
  PlanningContext,
  PlanningLease,
  PlanningOutcome,
  PlanningProtocol,
  ProposalReceipt,
  ReadyPlanningOutcome,
  SemanticPlanDraft
} from "./model.js";

export interface PlanningContextPort {
  load(lease: PlanningLease): Promise<PlanningContext>;
}

export interface PlanningProtocolPort {
  load(reference: { id: string; revision: string }): Promise<PlanningProtocol>;
}

export interface SemanticProposalPort {
  propose(request: {
    attemptId: string;
    slot: number;
    goal: PlanningContext["goal"];
    repositorySnapshot: PlanningContext["repositorySnapshot"];
    resolvedDecisions: unknown[];
    constraints: string[];
  }): Promise<SemanticPlanDraft | unknown>;
}

export interface PlanningRecordPort {
  begin(record: PlanningAttemptRecord): Promise<void>;
  recordProposal(attemptId: string, lease: PlanningLease, proposal: ProposalReceipt): Promise<void>;
  commitTerminal(attemptId: string, lease: PlanningLease, terminal: PlanningOutcome): Promise<void>;
  load(attemptId: string): Promise<PlanningAttemptRecord | undefined>;
}

export interface PlanningModule {
  start(command: {
    lease: PlanningLease;
    protocol: { id: string; revision: string };
  }): Promise<PlanningOutcome>;
  resume(command: { attemptId: string; lease: PlanningLease }): Promise<PlanningOutcome>;
  replay(command: { attemptId: string }): Promise<PlanningOutcome>;
}

export interface PlanningModuleDependencies {
  contexts: PlanningContextPort;
  protocols: PlanningProtocolPort;
  proposals: SemanticProposalPort;
  records: PlanningRecordPort;
  now(): string;
}

export function createPlanningModule(dependencies: PlanningModuleDependencies): PlanningModule {
  return {
    async start(command): Promise<PlanningOutcome> {
      const context = await dependencies.contexts.load(command.lease);
      const protocol = await dependencies.protocols.load(command.protocol);
      assertProtocol(protocol, command.protocol);
      const startedAt = dependencies.now();
      const attemptId = `planning-attempt:${digest({ lease: command.lease, protocol: command.protocol, startedAt })}`;
      const attempt: PlanningAttemptRecord = {
        schemaVersion: 1,
        attemptId,
        lease: command.lease,
        protocol,
        context,
        startedAt,
        proposals: []
      };
      await dependencies.records.begin(attempt);

      const receipts: ProposalReceipt[] = [];
      for (let slot = 0; slot < protocol.proposalTarget; slot += 1) {
        let draft: unknown;
        try {
          draft = await dependencies.proposals.propose({
            attemptId,
            slot,
            goal: context.goal,
            repositorySnapshot: context.repositorySnapshot,
            resolvedDecisions: context.resolvedDecisions,
            constraints: context.constraints ?? []
          });
        } catch (error) {
          const issues = [{ code: "proposal_failed", message: error instanceof Error ? error.message : String(error) }];
          const receipt: ProposalReceipt = { slot, receivedAt: dependencies.now(), draft: null, issues };
          await dependencies.records.recordProposal(attemptId, command.lease, receipt);
          receipts.push(receipt);
          continue;
        }
        const canonical = canonicalizeSemanticPlan(draft, context, protocol);
        const policyIssues = canonical.ok ? executionCutIssues(canonical.plan) : [];
        const receipt: ProposalReceipt = canonical.ok
          ? { slot, receivedAt: dependencies.now(), draft, plan: canonical.plan, issues: policyIssues }
          : { slot, receivedAt: dependencies.now(), draft, issues: canonical.issues };
        await dependencies.records.recordProposal(attemptId, command.lease, receipt);
        receipts.push(receipt);
      }
      const outcome = evaluateAttempt({ ...attempt, proposals: receipts });
      await dependencies.records.commitTerminal(attemptId, command.lease, outcome);
      return outcome;
    },

    async resume(command): Promise<PlanningOutcome> {
      const attempt = await dependencies.records.load(command.attemptId);
      if (attempt === undefined) throw new Error(`Planning attempt ${command.attemptId} does not exist.`);
      if (attempt.lease.runId !== command.lease.runId) {
        throw new Error(`Planning attempt ${command.attemptId} belongs to run ${attempt.lease.runId}, not ${command.lease.runId}.`);
      }
      if (attempt.terminal !== undefined) {
        const replayed = evaluateAttempt(attempt);
        if (digest(replayed) !== digest(attempt.terminal)) throw new Error(`Planning attempt ${command.attemptId} failed deterministic replay.`);
        return replayed;
      }
      const receipts = [...attempt.proposals];
      const recordedSlots = new Set(receipts.map((receipt) => receipt.slot));
      if (recordedSlots.size !== receipts.length || receipts.some((receipt) => receipt.slot < 0 || receipt.slot >= attempt.protocol.proposalTarget)) {
        throw new Error(`Planning attempt ${command.attemptId} has invalid proposal slots.`);
      }
      for (let slot = 0; slot < attempt.protocol.proposalTarget; slot += 1) {
        if (recordedSlots.has(slot)) continue;
        let receipt: ProposalReceipt;
        try {
          const draft = await dependencies.proposals.propose({
            attemptId: attempt.attemptId,
            slot,
            goal: attempt.context.goal,
            repositorySnapshot: attempt.context.repositorySnapshot,
            resolvedDecisions: attempt.context.resolvedDecisions,
            constraints: attempt.context.constraints ?? []
          });
          const canonical = canonicalizeSemanticPlan(draft, attempt.context, attempt.protocol);
          const policyIssues = canonical.ok ? executionCutIssues(canonical.plan) : [];
          receipt = canonical.ok
            ? { slot, receivedAt: dependencies.now(), draft, plan: canonical.plan, issues: policyIssues }
            : { slot, receivedAt: dependencies.now(), draft, issues: canonical.issues };
        } catch (error) {
          receipt = {
            slot,
            receivedAt: dependencies.now(),
            draft: null,
            issues: [{ code: "proposal_failed", message: error instanceof Error ? error.message : String(error) }]
          };
        }
        await dependencies.records.recordProposal(attempt.attemptId, command.lease, receipt);
        receipts.push(receipt);
      }
      const outcome = evaluateAttempt({ ...attempt, proposals: receipts });
      await dependencies.records.commitTerminal(attempt.attemptId, command.lease, outcome);
      return outcome;
    },

    async replay(command): Promise<PlanningOutcome> {
      const attempt = await dependencies.records.load(command.attemptId);
      if (attempt === undefined) throw new Error(`Planning attempt ${command.attemptId} does not exist.`);
      if (attempt.terminal === undefined) throw new Error(`Planning attempt ${command.attemptId} has no committed terminal outcome.`);
      const replayed = evaluateAttempt(attempt);
      if (digest(replayed) !== digest(attempt.terminal)) {
        throw new Error(`Planning attempt ${command.attemptId} failed deterministic replay.`);
      }
      return replayed;
    }
  };
}

function evaluateAttempt(attempt: PlanningAttemptRecord): PlanningOutcome {
  const safePlans: Array<{ slot: number; plan: NonNullable<ProposalReceipt["plan"]> }> = [];
  const rejections: NotReadyPlanningOutcome["rejections"] = [];
  for (const receipt of attempt.proposals) {
    if (receipt.draft === null) {
      rejections.push({ slot: receipt.slot, issues: receipt.issues });
      continue;
    }
    const canonical = canonicalizeSemanticPlan(receipt.draft, attempt.context, attempt.protocol);
    if (canonical.ok) {
      const policyIssues = executionCutIssues(canonical.plan);
      if (policyIssues.length === 0) safePlans.push({ slot: receipt.slot, plan: canonical.plan });
      else rejections.push({ slot: receipt.slot, issues: policyIssues });
    } else rejections.push({ slot: receipt.slot, issues: canonical.issues });
  }

  const distinctPlans = new Map(safePlans.map((candidate) => [candidate.plan.planId, candidate]));
  const comparableCandidates = distinctPlans.size >= 2 ? distinctPlans.size : 0;
  const comparison = {
    status: safePlans.length >= attempt.protocol.proposalTarget && comparableCandidates >= attempt.protocol.minComparableCandidates
      ? "complete" as const
      : "degraded" as const,
    safeCandidates: safePlans.length,
    comparableCandidates
  };
  const base = { attemptId: attempt.attemptId, comparison, rejections };
  if (safePlans.length === 0) {
    return { kind: "not_ready", ...base, reason: "no_safe_candidate" };
  }
  if (comparableCandidates < attempt.protocol.minComparableCandidates) {
    return { kind: "not_ready", ...base, reason: "insufficient_comparable_candidates" };
  }
  if (safePlans.length < attempt.protocol.minSafeCandidates) {
    return { kind: "not_ready", ...base, reason: "insufficient_safe_candidates" };
  }
  if (comparison.status === "degraded" && !attempt.protocol.allowDegradedComparison) {
    return { kind: "not_ready", ...base, reason: "insufficient_comparable_candidates" };
  }

  const selectedPlan = [...distinctPlans.values()]
    .sort((left, right) => left.plan.planId.localeCompare(right.plan.planId))[0]!.plan;
  const executionCut = selectExecutionCut(selectedPlan);
  const compiled = compileSemanticPlan(selectedPlan, executionCut, attempt.context, attempt.startedAt);
  const outcome: ReadyPlanningOutcome = {
    kind: "ready",
    ...base,
    selected: { plan: selectedPlan, executionCut },
    compiled
  };
  return outcome;
}

function assertProtocol(protocol: PlanningProtocol, reference: { id: string; revision: string }): void {
  if (protocol.id !== reference.id || protocol.revision !== reference.revision) {
    throw new Error(`Planning protocol ${reference.id}@${reference.revision} resolved to ${protocol.id}@${protocol.revision}.`);
  }
  for (const [field, value] of [
    ["proposalTarget", protocol.proposalTarget],
    ["minSafeCandidates", protocol.minSafeCandidates],
    ["minComparableCandidates", protocol.minComparableCandidates]
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Planning protocol ${field} must be a non-negative integer.`);
  }
  if (protocol.proposalTarget < 1) throw new Error("Planning protocol proposalTarget must be positive.");
  if (protocol.minSafeCandidates > protocol.proposalTarget || protocol.minComparableCandidates > protocol.proposalTarget) {
    throw new Error("Planning protocol quorum cannot exceed proposalTarget.");
  }
}
