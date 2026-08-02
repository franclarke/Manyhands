import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidatePlan, CandidatePlanDiagnostic, CandidatePlanSelection, CompiledGraphRevision, GranularityStrategyResult, GraphCompilerInput, PlanningEnvelope, WorkBreakdown, WorkBreakdownPlannerInput, WorkBreakdownPlanningObserver, WorkUnit } from "@manyhands/decomposer";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { PLAN_CRITIC_KINDS, PILOT_UTILITY_POLICY, buildGranularityPlanningBrief, canonicalRepositorySnapshotId, candidateBreakdownHash, createPlanningEnvelope, repositorySnapshotIdsMatch, resolveGranularityCondition, selectGranularityStrategy, selectPlannerCandidate, validatePlannerCandidateSet } from "@manyhands/decomposer";
import { foldRun, supersededDecisionIds, type RunEventInput, type RunProjection } from "@manyhands/run-coordinator";
import type { FencingAuthority, JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import {
  ExecutionFailureReceiptStore,
  persistRunFailure,
  reconcilePendingRunFailures
} from "./execution-failure-receipt";

export interface PlanningV2Input {
  runId: string;
  goal: string;
  repoPath: string;
  targetFingerprint: string;
  baseCommit: string;
  authority: FencingAuthority;
  acceptanceCriteria?: string[];
  constraints?: string[];
  questionAnswers?: Record<string, string>;
  /** G5 condition label; absent means the productive adaptive policy. */
  granularityCondition?: string;
  /** Frozen typed alternatives for deterministic policy replay without an LLM call. */
  frozenCandidates?: CandidatePlan[];
  experimentalCandidate?: {
    sourceHash: string;
    repositorySnapshotId: string;
    goal: string;
    acceptanceCriteria: string[];
    breakdown: WorkBreakdown;
  };
}

export interface PlanningV2Dependencies {
  events: JsonlRunEventStore;
  snapshots: RunSnapshotStore;
  inspect(input: Pick<PlanningV2Input, "repoPath" | "targetFingerprint" | "baseCommit">): Promise<RepositorySnapshot>;
  plan(input: WorkBreakdownPlannerInput, observer: WorkBreakdownPlanningObserver): Promise<WorkBreakdown>;
  planCandidates(input: WorkBreakdownPlannerInput, envelope: PlanningEnvelope, count: number, observer: WorkBreakdownPlanningObserver): Promise<CandidatePlan[]>;
  compile(input: GraphCompilerInput): CompiledGraphRevision;
  nodeIdFor?(key: string): string;
  now(): string;
}

export async function runPlanningV2(input: PlanningV2Input, dependencies: PlanningV2Dependencies): Promise<RunProjection> {
  await dependencies.events.advanceFence(input.runId, input.authority);
  let events = await dependencies.events.load(input.runId);
  if (events.length === 0) {
    events = await append(dependencies, input.runId, input.authority, 0, [{
      eventId: `run:${input.runId}:created`, occurredAt: dependencies.now(), type: "run.created", payload: { goal: input.goal }
    }]);
  }
  let state = foldRun(events);
  if (state.lifecycle !== "planning") return state;
  if (state.planningCandidates?.selection.kind === "replan_required") return state;
  let reconciledState: RunProjection | undefined;
  const reconciliation = await reconcilePendingRunFailures({
    store: new ExecutionFailureReceiptStore({ directory: dependencies.events.directory }),
    area: "planning",
    runId: input.runId,
    recordTerminalFailure: async (receipt) => {
      reconciledState = await recordPlanningFailure(input, dependencies, receipt.reason);
    }
  });
  if (reconciliation.reconciledReceiptIds.length > 0) return reconciledState!;
  if (Object.values(state.decisions).some((decision) => decision.kind === "clarify_goal" && decision.status === "pending")) {
    return state;
  }

  try {
    const repositorySnapshot = await dependencies.inspect(input);
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
      eventId: `repository:${repositorySnapshot.snapshotId}:inspection:${events.length + 1}`, occurredAt: dependencies.now(), type: "repository.inspected",
      payload: { snapshotId: repositorySnapshot.snapshotId, disposition: repositorySnapshot.inspectionDisposition, snapshot: asRecord(repositorySnapshot) }
    }])];
    const nodeIdFor = dependencies.nodeIdFor ?? defaultNodeIdFor;
    const planningObserverFor = (attemptOffset: number): WorkBreakdownPlanningObserver => ({
      onAttemptStarted: async ({ attempt }) => {
        const globalAttempt = attemptOffset + attempt;
        events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
          eventId: `planning:${input.runId}:attempt:${globalAttempt}:started`,
          occurredAt: dependencies.now(),
          type: "planning.attempt_started",
          payload: { attempt: globalAttempt }
        }])];
      },
      onUnitDiscovered: async ({ attempt, unit }) => {
        const globalAttempt = attemptOffset + attempt;
        events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
          eventId: `planning:${input.runId}:attempt:${globalAttempt}:node:${unit.key}`,
          occurredAt: dependencies.now(),
          type: "planning.node_discovered",
          payload: {
            attempt: globalAttempt,
            node: {
              ...unit,
              nodeId: nodeIdFor(unit.key),
              parentNodeId: unit.parentKey === null ? null : nodeIdFor(unit.parentKey)
            }
          }
        }])];
      },
      onAttemptFailed: async ({ attempt, reason }) => {
        const globalAttempt = attemptOffset + attempt;
        events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
          eventId: `planning:${input.runId}:attempt:${globalAttempt}:failed`,
          occurredAt: dependencies.now(),
          type: "planning.attempt_failed",
          payload: { attempt: globalAttempt, reason }
        }])];
      }
    });
    const plannerInput: WorkBreakdownPlannerInput = {
      goal: input.goal,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      repositorySnapshot: {
        snapshotId: repositorySnapshot.snapshotId,
        inspectionDisposition: repositorySnapshot.inspectionDisposition,
        evidence: repositoryEvidence(repositorySnapshot)
      },
      granularityBrief: buildGranularityPlanningBrief({
        repositorySnapshot,
        config: PILOT_UTILITY_POLICY
      }),
      ...(input.questionAnswers !== undefined ? { questionAnswers: input.questionAnswers } : {})
    };
    const envelope = createPlanningEnvelope({
      policyVersion: PILOT_UTILITY_POLICY.policyVersion,
      goal: input.goal,
      repositorySnapshot,
      maxLeafContextTokens: PILOT_UTILITY_POLICY.maxLeafContextTokens,
      maxLeafScopePaths: PILOT_UTILITY_POLICY.maxLeafScopePaths
    });
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
      eventId: `planning:${input.runId}:envelope:${events.length + 1}`,
      occurredAt: dependencies.now(),
      type: "planning.envelope_created",
      payload: envelope
    }])];
    const condition = resolveGranularityCondition(input.granularityCondition);
    let breakdown: WorkBreakdown;
    let strategy: GranularityStrategyResult;
    let selectedCandidate: CandidatePlan | undefined;
    if (input.experimentalCandidate !== undefined) {
      breakdown = validateExperimentalCandidate(input, repositorySnapshot);
      strategy = selectGranularityStrategy({ condition, breakdown, repositorySnapshot, config: PILOT_UTILITY_POLICY });
      if (strategy.requiresSemanticReplan) {
        throw new Error("The blocked candidate requires semantic replan and cannot be changed during experimental replay.");
      }
    } else {
      const plannerCandidates = input.frozenCandidates ?? await dependencies.planCandidates(
          plannerInput,
          envelope,
          envelope.candidateBudget.maximum,
          planningObserverFor(latestPlanningAttempt(events))
        );
      const evaluation = evaluatePlannerCandidates({ envelope, candidates: plannerCandidates, condition, repositorySnapshot });
      events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [
        candidatesEvaluatedEvent(input.runId, envelope, plannerCandidates, evaluation, condition, dependencies.now)
      ])];
      if (evaluation.selection.kind === "replan_required") {
        state = foldRun(events);
        await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
        return state;
      }
      breakdown = evaluation.selection.candidate.breakdown;
      selectedCandidate = evaluation.selection.candidate;
      strategy = evaluation.strategies.get(evaluation.selection.candidate.candidateId)!;
      if (strategy.requiresSemanticReplan) {
        state = foldRun(events);
        await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
        return state;
      }
    }
    breakdown = canonicalizeRepositorySnapshotReference(breakdown, repositorySnapshot.snapshotId);
    if (requiresClarification(breakdown)) {
      const drafts = clarificationEvents(breakdown, nodeIdFor, dependencies.now, events.length);
      events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
      state = foldRun(events);
      await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
      return state;
    }
    if (input.experimentalCandidate !== undefined) {
      const strategyEvent = strategySelectedEvent(
        input.runId,
        strategy,
        breakdown,
        nodeIdFor,
        dependencies.now,
        input.experimentalCandidate.sourceHash
      );
      events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [strategyEvent])];
    }
    const compiled = dependencies.compile({
      breakdown,
      repositorySnapshot,
      ...(input.experimentalCandidate === undefined ? {
        planningEnvelope: envelope,
        candidatePlan: selectedCandidate!
      } : {}),
      sourceContract: {
        goal: input.goal,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        constraints: input.constraints ?? []
      }
    });
    const drafts = strategySuccessEvents(input.runId, breakdown, compiled, dependencies.now);
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
    await writeStrategyDiagnostics(dependencies, input.runId, strategy, breakdown, input.experimentalCandidate?.sourceHash);
    return state;
  } catch (error) {
    let recordedState: RunProjection | undefined;
    try {
      await persistRunFailure({
        store: new ExecutionFailureReceiptStore({ directory: dependencies.events.directory }),
        area: "planning",
        runId: input.runId,
        operationId: input.authority.operationId,
        fencingToken: input.authority.fencingToken,
        error,
        recordTerminalFailure: async (receipt) => {
          recordedState = await recordPlanningFailure(input, dependencies, receipt.reason);
        }
      });
    } catch (receiptFailure) {
      throw new AggregateError(
        [error, receiptFailure],
        "Planning failed and its terminal state could not be fully persisted."
      );
    }
    return recordedState!;
  }
}

export async function approvePlanningV2(
  runId: string,
  authority: FencingAuthority,
  revision: number,
  expectedSequence: number,
  dependencies: PlanningV2Dependencies
): Promise<RunProjection> {
  const current = await dependencies.events.load(runId);
  const state = foldRun(current);
  if (state.sequence !== expectedSequence) throw new Error(`Planning approval sequence conflict: expected ${expectedSequence}, current ${state.sequence}.`);
  if (state.graphRevision !== revision) throw new Error(`Planning approval revision conflict: expected ${revision}, current ${state.graphRevision ?? "none"}.`);
  const decisionId = approvalDecisionId(state.graphId!, revision);
  const superseded = supersededDecisionIds(state.decisions, revision).filter((id) => id !== decisionId);
  const appended = await append(dependencies, runId, authority, expectedSequence, [
    { eventId: `${decisionId}:resolved`, occurredAt: dependencies.now(), type: "decision.resolved", payload: { decisionId, optionId: "approve" } },
    { eventId: `${decisionId}:graph-approved`, occurredAt: dependencies.now(), type: "graph.revision.approved", payload: { graphId: state.graphId!, revision } },
    ...superseded.map((id) => ({
      eventId: `${id}:expired:r${revision}`,
      occurredAt: dependencies.now(),
      type: "decision.expired" as const,
      payload: { decisionId: id, supersededByRevision: revision, reason: "A newer approved graph revision superseded the decision's premise." }
    }))
  ]);
  const next = foldRun([...current, ...appended]);
  await dependencies.snapshots.write(runId, authority, next, next.sequence, appended.at(-1)!.eventId);
  return next;
}

export async function revisePlanningV2(
  runId: string,
  authority: FencingAuthority,
  expectedRevision: number,
  expectedSequence: number,
  compiled: CompiledGraphRevision,
  dependencies: PlanningV2Dependencies
): Promise<RunProjection> {
  const current = await dependencies.events.load(runId);
  const state = foldRun(current);
  if (state.sequence !== expectedSequence) throw new Error(`Planning edit sequence conflict: expected ${expectedSequence}, current ${state.sequence}.`);
  if (state.graphRevision !== expectedRevision) throw new Error(`Planning edit revision conflict: expected ${expectedRevision}, current ${state.graphRevision ?? "none"}.`);
  if (compiled.graph.graphId !== state.graphId || compiled.graph.revision !== expectedRevision + 1) throw new Error("Planning edit must preserve graph identity and increment revision exactly once.");
  const drafts = compiledEvents(compiled, dependencies.now);
  const appended = await append(dependencies, runId, authority, expectedSequence, drafts);
  const next = foldRun([...current, ...appended]);
  await dependencies.snapshots.write(runId, authority, next, next.sequence, appended.at(-1)!.eventId);
  return next;
}

interface PlannerCandidateEvaluation {
  validation: ReturnType<typeof validatePlannerCandidateSet>;
  strategies: Map<string, GranularityStrategyResult>;
  scores: Map<string, number>;
  selection: CandidatePlanSelection;
}

function evaluatePlannerCandidates(input: {
  envelope: PlanningEnvelope;
  candidates: readonly CandidatePlan[];
  condition: ReturnType<typeof resolveGranularityCondition>;
  repositorySnapshot: RepositorySnapshot;
}): PlannerCandidateEvaluation {
  const validation = validatePlannerCandidateSet({ envelope: input.envelope, candidates: input.candidates });
  const strategies = new Map<string, GranularityStrategyResult>();
  const scores = new Map<string, number>();
  for (const candidate of validation.validCandidates) {
    const strategy = selectGranularityStrategy({
      condition: input.condition,
      breakdown: candidate.breakdown,
      repositorySnapshot: input.repositorySnapshot,
      config: PILOT_UTILITY_POLICY
    });
    strategies.set(candidate.candidateId, strategy);
    const root = strategy.assessments[candidate.breakdown.root.key];
    if (root === undefined) throw new Error(`Candidate ${candidate.candidateId} has no root policy assessment.`);
    scores.set(candidate.candidateId, root.selected === "leaf" ? -root.splitAdvantage : root.splitAdvantage);
  }
  const viable = validation.validCandidates.filter((candidate) => !strategies.get(candidate.candidateId)!.requiresSemanticReplan);
  const selection = viable.length < input.envelope.candidateBudget.minimum
    ? replanForInsufficientCandidates(input.envelope, input.candidates, validation.diagnostics, viable.length)
    : selectPlannerCandidate({
        envelope: input.envelope,
        candidates: viable,
        score: (candidate) => scores.get(candidate.candidateId)!
      });
  return { validation, strategies, scores, selection };
}

function replanForInsufficientCandidates(
  envelope: PlanningEnvelope,
  candidates: readonly CandidatePlan[],
  diagnostics: CandidatePlanDiagnostic[],
  viableCount: number
): CandidatePlanSelection {
  const budgetDiagnostic: CandidatePlanDiagnostic = {
    code: "candidate_budget_not_met",
    message: `Candidate set has ${viableCount} viable plans but the envelope requires ${envelope.candidateBudget.minimum}..${envelope.candidateBudget.maximum}.`,
    refs: []
  };
  return {
    kind: "replan_required",
    diagnosis: {
      code: "no_structurally_valid_candidate",
      message: "The bounded candidate set did not contain enough structurally valid, policy-viable alternatives.",
      rejectedCandidateIds: candidates.map((candidate) => candidate.candidateId).sort(),
      diagnostics: [...diagnostics, budgetDiagnostic]
    }
  };
}

function candidatesEvaluatedEvent(
  runId: string,
  envelope: PlanningEnvelope,
  candidates: readonly CandidatePlan[],
  evaluation: PlannerCandidateEvaluation,
  condition: ReturnType<typeof resolveGranularityCondition>,
  now: () => string
): RunEventInput {
  const validIds = new Set(evaluation.validation.validCandidates.map((candidate) => candidate.candidateId));
  const evaluations = candidates.map((candidate) => {
    const strategy = evaluation.strategies.get(candidate.candidateId);
    const diagnostics: Array<{ code: string; message: string; refs: string[] }> = evaluation.validation.diagnostics
      .filter((diagnostic) => diagnostic.candidateId === undefined || diagnostic.candidateId === candidate.candidateId)
      .map(({ code, message, refs }) => ({ code, message, refs }));
    if (strategy?.requiresSemanticReplan === true) {
      const root = strategy.assessments[candidate.breakdown.root.key];
      diagnostics.push({
        code: "semantic_replan_required",
        message: root?.rationale ?? "The policy could not identify a viable semantic cut.",
        refs: root?.evidenceRefs ?? []
      });
    }
    return {
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      candidate: asRecord(candidate),
      valid: validIds.has(candidate.candidateId) && strategy?.requiresSemanticReplan === false,
      ...(evaluation.scores.has(candidate.candidateId) ? { score: evaluation.scores.get(candidate.candidateId)! } : {}),
      gates: candidateGateResults(diagnostics, strategy),
      diagnostics
    };
  });
  const selection = evaluation.selection.kind === "selected"
    ? {
        kind: "selected" as const,
        candidateId: evaluation.selection.candidate.candidateId,
        score: evaluation.selection.score,
        rejectedCandidateIds: evaluation.selection.rejectedCandidateIds,
        tieBreak: candidateTieBreak(evaluation)
      }
    : {
        kind: "replan_required" as const,
        reason: evaluation.selection.diagnosis.message,
        rejectedCandidateIds: evaluation.selection.diagnosis.rejectedCandidateIds,
        diagnostics: evaluation.selection.diagnosis.diagnostics.map(({ code, message, refs }) => ({ code, message, refs }))
      };
  return {
    eventId: `planning:${runId}:candidates:${evaluations.map((item) => item.candidateHash).sort().join(":")}`,
    occurredAt: now(),
    type: "planning.candidates_evaluated",
    payload: {
      schemaVersion: 1,
      envelope: asRecord(envelope),
      policy: { version: envelope.policyVersion, condition, scoreBasis: "root_split_advantage" },
      candidates: evaluations,
      selection
    }
  };
}

function candidateGateResults(
  diagnostics: Array<{ code: string; message: string; refs: string[] }>,
  strategy: GranularityStrategyResult | undefined
): Array<{ gate: string; passed: boolean; diagnosticCodes: string[] }> {
  const gateCodes: Record<string, string[]> = {
    identity: ["candidate_not_typed", "candidate_hash_mismatch", "snapshot_mismatch", "goal_digest_mismatch"],
    scope: ["scope_declaration_incomplete", "scope_outside_grounding", "unknown_scope_unit"],
    acceptance: ["acceptance_criteria_incomplete", "acceptance_ownership_incomplete", "acceptance_role_mismatch", "unknown_acceptance_intent", "unknown_acceptance_owner", "duplicate_acceptance_owner", "global_owner_must_integrate", "local_owner_must_be_leaf", "leaf_without_local_acceptance"],
    seams: ["missing_seam_specification", "orphan_seam_specification", "semantic_dependency_without_seam"],
    obligations: ["contract_obligation_incomplete"],
    validation: ["leaf_validation_incomplete"],
    policy_viability: ["semantic_replan_required"]
  };
  return Object.entries(gateCodes).map(([gate, codes]) => {
    const diagnosticCodes = diagnostics.map((diagnostic) => diagnostic.code).filter((code) => codes.includes(code));
    if (gate === "policy_viability" && strategy?.requiresSemanticReplan === true && !diagnosticCodes.includes("semantic_replan_required")) {
      diagnosticCodes.push("semantic_replan_required");
    }
    return { gate, passed: diagnosticCodes.length === 0, diagnosticCodes };
  });
}

function candidateTieBreak(evaluation: PlannerCandidateEvaluation): { kind: "candidate_id"; applied: boolean; contenders: string[] } {
  if (evaluation.selection.kind !== "selected") return { kind: "candidate_id", applied: false, contenders: [] };
  const selectedScore = evaluation.selection.score;
  const contenders = [...evaluation.scores.entries()]
    .filter(([candidateId, score]) => score === selectedScore && evaluation.strategies.get(candidateId)?.requiresSemanticReplan === false)
    .map(([candidateId]) => candidateId)
    .sort();
  return { kind: "candidate_id", applied: contenders.length > 1, contenders };
}

function strategySelectedEvent(
  runId: string,
  strategy: GranularityStrategyResult,
  candidateBreakdown: WorkBreakdown,
  nodeIdFor: (key: string) => string,
  now: () => string,
  candidateSourceHash?: string
): RunEventInput {
  const breakdown = strategy.selectedBreakdown;
  return {
    eventId: `planning:${breakdown.breakdownId}:strategy:${runId}`,
    occurredAt: now(),
    type: "planning.granularity_strategy_selected",
    payload: {
      policyVersion: strategy.policyVersion,
      condition: strategy.condition,
      candidateTreeHash: strategy.candidateTreeHash,
      candidateTree: {
        root: asRecord(candidateBreakdown.root),
        candidateArtifacts: candidateBreakdown.candidateArtifacts.map(asRecord),
        candidateSeams: candidateBreakdown.candidateSeams.map(asRecord)
      },
      ...(candidateSourceHash === undefined ? {} : { candidateSourceHash }),
      config: {
        minimumAdvantage: strategy.config.minimumAdvantage,
        maxLeafContextTokens: strategy.config.maxLeafContextTokens,
        maxLeafScopePaths: strategy.config.maxLeafScopePaths,
        maxLeafPlannedPaths: strategy.config.maxLeafPlannedPaths
      },
      assessments: Object.values(strategy.assessments).map((assessment) => ({
        unitKey: assessment.unitKey,
        nodeId: nodeIdFor(assessment.unitKey),
        selected: assessment.selected,
        leafFeasible: assessment.leafFeasible,
        splitViable: assessment.splitViable,
        features: assessment.features,
        benefit: assessment.benefit,
        cost: assessment.cost,
        splitAdvantage: assessment.splitAdvantage,
        minimumAdvantage: assessment.minimumAdvantage,
        evidenceRefs: assessment.evidenceRefs,
        rationale: assessment.rationale
      })),
      metrics: structuralMetrics(breakdown.root)
    }
  };
}

function strategySuccessEvents(
  runId: string,
  breakdown: WorkBreakdown,
  compiled: CompiledGraphRevision,
  now: () => string
): RunEventInput[] {
  return [
    { eventId: `planning:${breakdown.breakdownId}:completed:${runId}`, occurredAt: now(), type: "planning.completed", payload: { breakdownId: breakdown.breakdownId, breakdown: asRecord(breakdown) } },
    ...compiledEvents(compiled, now)
  ];
}

function validateExperimentalCandidate(
  input: PlanningV2Input,
  repositorySnapshot: RepositorySnapshot
): WorkBreakdown {
  const candidate = input.experimentalCandidate;
  if (candidate === undefined) throw new Error("Missing experimental planning candidate.");
  if (!repositorySnapshotIdsMatch(candidate.repositorySnapshotId, repositorySnapshot.snapshotId)
    || !repositorySnapshotIdsMatch(candidate.breakdown.repositorySnapshotId, repositorySnapshot.snapshotId)) {
    throw new Error("Experimental candidate snapshot does not match the inspected repository snapshot.");
  }
  if (candidate.goal !== input.goal) throw new Error("Experimental candidate goal does not match the run goal.");
  if (JSON.stringify(candidate.acceptanceCriteria) !== JSON.stringify(input.acceptanceCriteria ?? [])) {
    throw new Error("Experimental candidate acceptance input does not match the run acceptance input.");
  }
  const actualHash = candidateBreakdownHash(candidate.breakdown);
  if (candidate.sourceHash !== actualHash) throw new Error(`Experimental candidate source hash mismatch: expected ${candidate.sourceHash}, measured ${actualHash}.`);
  return canonicalizeRepositorySnapshotReference(candidate.breakdown, repositorySnapshot.snapshotId);
}

function canonicalizeRepositorySnapshotReference(breakdown: WorkBreakdown, canonicalSnapshotId: string): WorkBreakdown {
  const repositorySnapshotId = canonicalRepositorySnapshotId(breakdown.repositorySnapshotId, canonicalSnapshotId);
  return repositorySnapshotId === breakdown.repositorySnapshotId
    ? breakdown
    : { ...breakdown, repositorySnapshotId };
}

function structuralMetrics(root: WorkUnit): {
  maxGraphDepth: number;
  totalLeafCount: number;
  averageBranchingFactor: number;
} {
  const units = flattenUnits(root);
  const composites = units.filter((unit): unit is Extract<WorkUnit, { kind: "composite" }> => unit.kind === "composite");
  const depth = (unit: WorkUnit): number => unit.kind === "leaf" ? 0 : 1 + Math.max(...unit.children.map(depth));
  return {
    maxGraphDepth: depth(root),
    totalLeafCount: units.filter((unit) => unit.kind === "leaf").length,
    averageBranchingFactor: composites.length === 0
      ? 0
      : composites.reduce((sum, unit) => sum + unit.children.length, 0) / composites.length
  };
}

async function writeStrategyDiagnostics(
  dependencies: PlanningV2Dependencies,
  runId: string,
  strategy: GranularityStrategyResult,
  selectedCandidateBreakdown: WorkBreakdown,
  candidateSourceHash?: string
): Promise<void> {
  const artifact = {
    runId,
    policyVersion: strategy.policyVersion,
    condition: strategy.condition,
    candidateTreeHash: strategy.candidateTreeHash,
    ...(candidateSourceHash === undefined ? {} : { candidateSourceHash }),
    config: strategy.config,
    metrics: structuralMetrics(selectedCandidateBreakdown.root),
    generatedAt: new Date().toISOString()
  };
  const target = path.join(dependencies.events.directory, `${runId.replace(/[^A-Za-z0-9._-]/gu, "_")}.granularity-metrics.json`);
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function requiresClarification(breakdown: WorkBreakdown): boolean {
  return breakdown.questions.length > 0 || breakdown.uncertainties.some((uncertainty) => uncertainty.requiresHumanDecision);
}

function clarificationEvents(
  breakdown: WorkBreakdown,
  nodeIdFor: (key: string) => string,
  now: () => string,
  sequenceOffset: number
): RunEventInput[] {
  const completion: RunEventInput = {
    eventId: `planning:${breakdown.breakdownId}:clarification:${sequenceOffset + 1}`,
    occurredAt: now(),
    type: "planning.completed",
    payload: { breakdownId: breakdown.breakdownId, breakdown: asRecord(breakdown) }
  };
  const questions = breakdown.questions.length > 0
    ? breakdown.questions.map((question) => ({
      id: `planning-question-${question.id}`,
      question: question.question,
      options: question.options,
      impact: question.impact,
      evidenceIds: question.evidenceIds,
      sourceRef: `work-question:${question.id}`
    }))
    : breakdown.uncertainties
      .filter((uncertainty) => uncertainty.requiresHumanDecision)
      .map((uncertainty) => ({
        id: `planning-uncertainty-${uncertainty.id}`,
        question: `How should this uncertainty be resolved? ${uncertainty.description}`,
        options: ["Provide direction", "Stop this run"],
        impact: "risk" as const,
        evidenceIds: uncertainty.evidenceIds,
        sourceRef: `work-uncertainty:${uncertainty.id}`
      }));
  return [
    completion,
    ...questions.map((question) => ({
      eventId: question.id,
      occurredAt: now(),
      type: "decision.raised" as const,
      payload: {
        decision: {
          id: question.id,
          kind: "clarify_goal" as const,
          question: question.question,
          options: question.options.map((label, index) => ({ id: `option-${index + 1}`, label })),
          affectedNodeIds: affectedNodeIds(breakdown.root, question.evidenceIds, nodeIdFor),
          evidenceRefs: [question.sourceRef, ...question.evidenceIds],
          impact: question.impact
        }
      }
    }))
  ];
}

function affectedNodeIds(root: WorkUnit, evidenceIds: readonly string[], nodeIdFor: (key: string) => string): string[] {
  if (evidenceIds.length === 0) return [nodeIdFor(root.key)];
  const matches = flattenUnits(root)
    .filter((unit) => unit.evidenceIds.some((id) => evidenceIds.includes(id)))
    .map((unit) => nodeIdFor(unit.key));
  return matches.length > 0 ? [...new Set(matches)] : [nodeIdFor(root.key)];
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function latestPlanningAttempt(events: readonly { type: string; payload: Record<string, unknown> }[]): number {
  return events.reduce((latest, event) => {
    if (!event.type.startsWith("planning.attempt_")) return latest;
    const attempt = event.payload.attempt;
    return typeof attempt === "number" && Number.isInteger(attempt) ? Math.max(latest, attempt) : latest;
  }, 0);
}

function compiledEvents(compiled: CompiledGraphRevision, now: () => string): RunEventInput[] {
  const graph = compiled.graph;
  const decisionId = approvalDecisionId(graph.graphId, graph.revision);
  return [
    { eventId: `graph:${graph.graphId}:r${graph.revision}:compiled`, occurredAt: now(), type: "graph.compiled", payload: { graphId: graph.graphId, revision: graph.revision, graph: asRecord(graph), contracts: compiled.contracts.map(asRecord), review: asRecord(compiled.review), trace: asRecord(compiled.trace) } },
    ...PLAN_CRITIC_KINDS.map((critic) => ({ eventId: `graph:${graph.graphId}:r${graph.revision}:critic:${critic}`, occurredAt: now(), type: "planning.critic_recorded" as const, payload: { critic, findings: compiled.review.findings.filter((finding) => finding.critic === critic).map(asRecord) } })),
    { eventId: `graph:${graph.graphId}:r${graph.revision}:proposed`, occurredAt: now(), type: "graph.revision.proposed", payload: { graphId: graph.graphId, revision: graph.revision } },
    { eventId: decisionId, occurredAt: now(), type: "decision.raised", payload: { decision: { id: decisionId, kind: "approve_plan", question: `Approve graph revision ${graph.revision}?`, options: [{ id: "approve", label: "Approve plan" }, { id: "request_changes", label: "Request changes" }], affectedNodeIds: [graph.rootId], evidenceRefs: [`graph:${graph.graphId}:r${graph.revision}`], impact: "acceptance" } } }
  ];
}

function approvalDecisionId(graphId: string, revision: number): string { return `approve-plan:${graphId}:r${revision}`; }

async function append(dependencies: PlanningV2Dependencies, runId: string, authority: FencingAuthority, expected: number, events: RunEventInput[]) {
  return dependencies.events.appendFenced(runId, expected, authority, events);
}

async function recordPlanningFailure(
  input: Pick<PlanningV2Input, "runId" | "authority">,
  dependencies: PlanningV2Dependencies,
  reason: string
): Promise<RunProjection> {
  const current = await dependencies.events.load(input.runId);
  const alreadyRecorded = current.some((event) => event.type === "planning.failed");
  const persisted = alreadyRecorded
    ? current
    : [...current, ...await append(dependencies, input.runId, input.authority, current.length, [{
      eventId: `planning:${input.runId}:failed:${current.length + 1}`,
      occurredAt: dependencies.now(),
      type: "planning.failed",
      payload: { reason }
    }])];
  const state = foldRun(persisted);
  await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, persisted.at(-1)!.eventId);
  return state;
}

function repositoryEvidence(snapshot: RepositorySnapshot) {
  const paths = snapshot.index?.files.map((file, index) => ({ id: `path-${index}`, kind: "path" as const, reference: file.path, observation: `Repository ${file.kind} file`, confidence: 1 })) ?? [];
  const hasPackageManifest = snapshot.capabilities.packageManager !== undefined ||
    Object.keys(snapshot.capabilities.scripts).length > 0 ||
    snapshot.capabilities.stack.some((item) => item.evidence.some((entry) => entry.includes("package.json")));
  if (hasPackageManifest && !paths.some((item) => item.reference.replaceAll("\\", "/").toLowerCase() === "package.json")) {
    paths.push({ id: "config-package-json", kind: "path" as const, reference: "package.json", observation: "Repository package manifest defining scripts, dependencies and toolchain metadata", confidence: 1 });
  }
  const diagnostics = snapshot.diagnostics.map((diagnostic, index) => ({ id: `diagnostic-${index}`, kind: "diagnostic" as const, reference: diagnostic.filePath ?? snapshot.rootPath, observation: diagnostic.message, confidence: diagnostic.severity === "error" ? 0.3 : 0.7 }));
  const scripts = Object.entries(snapshot.capabilities.scripts).map(([name, command], index) => ({ id: `script-${index}`, kind: "script" as const, reference: name, observation: command, confidence: 1 }));
  const stack = snapshot.capabilities.stack.map((item, index) => ({ id: `stack-${index}`, kind: "stack" as const, reference: item.name, observation: item.evidence.join("; ") || `Detected ${item.name}`, confidence: item.confidence }));
  return [...paths, ...scripts, ...stack, ...diagnostics];
}

function defaultNodeIdFor(key: string): string {
  return `node-${key.replace(/[^A-Za-z0-9._:-]/gu, "-")}`;
}

function asRecord<T>(value: T): Record<string, unknown> { return value as unknown as Record<string, unknown>; }
