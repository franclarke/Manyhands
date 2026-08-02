import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidatePlan, CandidatePlanDiagnostic, CompiledGraphRevision, GranularityStrategyResult, GraphCompilerInput, PlanningEnvelope, WorkBreakdown, WorkBreakdownPlannerInput, WorkBreakdownPlanningObserver, WorkUnit } from "@manyhands/decomposer";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { PLAN_CRITIC_KINDS, PILOT_UTILITY_POLICY, canonicalRepositorySnapshotId, candidateBreakdownHash, createPlanningEnvelope, repositorySnapshotIdsMatch, resolveGranularityCondition, selectCandidatePlan, selectGranularityStrategy, validateCandidatePlanSet } from "@manyhands/decomposer";
import { foldRun, supersededDecisionIds, type RunEventInput, type RunProjection } from "@manyhands/run-coordinator";
import type { FencingAuthority, JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";

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
  planCandidates?(input: WorkBreakdownPlannerInput, count: number, observer: WorkBreakdownPlanningObserver): Promise<WorkBreakdown[]>;
  compile(input: GraphCompilerInput): CompiledGraphRevision;
  nodeIdFor?(key: string): string;
  now(): string;
}

type CandidateSetEvaluation =
  | { kind: "selected"; candidate: CandidatePlan; strategy: GranularityStrategyResult; compiled: CompiledGraphRevision; diagnostics: CandidatePlanDiagnostic[] }
  | { kind: "clarification"; breakdown: WorkBreakdown }
  | { kind: "replan_required"; rejectedCandidateIds: string[]; diagnostics: CandidatePlanDiagnostic[] };

interface CandidateSetEvaluationInput {
  plannerInput: WorkBreakdownPlannerInput;
  envelope: PlanningEnvelope;
  repositorySnapshot: RepositorySnapshot;
  condition: "A" | "B" | "C";
  observer: WorkBreakdownPlanningObserver;
  dependencies: PlanningV2Dependencies;
  sourceContract: GraphCompilerInput["sourceContract"];
}

async function evaluateCandidateSet(input: CandidateSetEvaluationInput): Promise<CandidateSetEvaluation> {
  if (input.dependencies.planCandidates === undefined) throw new Error("Candidate evaluation requires planCandidates.");
  const generated = await input.dependencies.planCandidates(
    input.plannerInput,
    input.envelope.candidateBudget.maximum,
    input.observer
  );
  const candidates = canonicalCandidatePlans(generated, input.repositorySnapshot.snapshotId);
  const clarification = candidates.find((candidate) => requiresClarification(candidate.breakdown));
  if (clarification !== undefined) return { kind: "clarification", breakdown: clarification.breakdown };

  const validation = validateCandidatePlanSet({ envelope: input.envelope, candidates });
  const strategies = new Map<string, GranularityStrategyResult>();
  const compiled = new Map<string, CompiledGraphRevision>();
  const compilerResults: Record<string, { approvable: boolean; diagnostics: string[] }> = {};
  for (const candidate of validation.validCandidates) {
    let strategy: GranularityStrategyResult;
    try {
      strategy = selectGranularityStrategy({
        condition: input.condition,
        breakdown: candidate.breakdown,
        repositorySnapshot: input.repositorySnapshot,
        config: PILOT_UTILITY_POLICY
      });
    } catch (error) {
      compilerResults[candidate.candidateId] = {
        approvable: false,
        diagnostics: [`Granularity strategy rejected candidate: ${errorMessage(error)}`]
      };
      continue;
    }
    strategies.set(candidate.candidateId, strategy);
    if (strategy.requiresSemanticReplan) {
      const assessment = strategy.assessments[candidate.breakdown.root.key];
      compilerResults[candidate.candidateId] = {
        approvable: false,
        diagnostics: [assessment?.rationale ?? "Candidate has no viable semantic frontier."]
      };
      continue;
    }
    try {
      const result = input.dependencies.compile({
        breakdown: strategy.selectedBreakdown,
        repositorySnapshot: input.repositorySnapshot,
        ...(input.sourceContract === undefined ? {} : { sourceContract: input.sourceContract })
      });
      compiled.set(candidate.candidateId, result);
      const diagnostics = result.review.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => `${finding.code}: ${finding.message}`);
      compilerResults[candidate.candidateId] = {
        approvable: result.review.approvable,
        diagnostics: diagnostics.length === 0 && !result.review.approvable
          ? ["Graph Compiler review is not approvable."]
          : diagnostics
      };
    } catch (error) {
      compilerResults[candidate.candidateId] = {
        approvable: false,
        diagnostics: [errorMessage(error)]
      };
    }
  }

  const selection = selectCandidatePlan({
    envelope: input.envelope,
    candidates,
    compilerResults,
    score: (candidate) => {
      const strategy = strategies.get(candidate.candidateId);
      const assessment = strategy?.assessments[candidate.breakdown.root.key];
      if (assessment === undefined) throw new Error(`Candidate ${candidate.candidateId} has no root utility assessment.`);
      return assessment.splitAdvantage;
    }
  });
  if (selection.kind === "replan_required") {
    return {
      kind: "replan_required",
      rejectedCandidateIds: selection.diagnosis.rejectedCandidateIds,
      diagnostics: selection.diagnosis.diagnostics
    };
  }
  const strategy = strategies.get(selection.candidate.candidateId);
  const compiledGraph = compiled.get(selection.candidate.candidateId);
  if (strategy === undefined || compiledGraph === undefined) {
    throw new Error(`Selected candidate ${selection.candidate.candidateId} has no compiled frontier.`);
  }
  return {
    kind: "selected",
    candidate: selection.candidate,
    strategy,
    compiled: compiledGraph,
    diagnostics: selection.diagnostics
  };
}

function canonicalCandidatePlans(breakdowns: readonly WorkBreakdown[], snapshotId: string): CandidatePlan[] {
  const seenHashes = new Set<string>();
  const usedIds = new Set<string>();
  const candidates: CandidatePlan[] = [];
  for (const original of breakdowns) {
    const breakdown = canonicalizeRepositorySnapshotReference(original, snapshotId);
    const hash = candidateBreakdownHash(breakdown);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    const baseId = breakdown.breakdownId;
    const candidateId = usedIds.has(baseId) ? `${baseId}-${hash.slice(-12)}` : baseId;
    usedIds.add(candidateId);
    candidates.push({ candidateId, breakdown });
  }
  return candidates;
}

function candidateSetFeedback(evaluation: Extract<CandidateSetEvaluation, { kind: "replan_required" }>): {
  rejectedCandidateIds: string[];
  diagnostics: string[];
} {
  return {
    rejectedCandidateIds: [...evaluation.rejectedCandidateIds],
    diagnostics: evaluation.diagnostics.map((diagnostic) =>
      `${diagnostic.candidateId ?? "candidate-set"} [${diagnostic.code}]: ${diagnostic.message}`
    )
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const planningEnvelope = createPlanningEnvelope({
      policyVersion: PILOT_UTILITY_POLICY.policyVersion,
      goal: input.goal,
      repositorySnapshot,
      maxCandidatePlans: 3,
      maxLeafContextTokens: PILOT_UTILITY_POLICY.maxLeafContextTokens,
      maxLeafScopePaths: PILOT_UTILITY_POLICY.maxLeafScopePaths,
      maxLeafPlannedPaths: PILOT_UTILITY_POLICY.maxLeafPlannedPaths
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
      planningEnvelope,
      ...(input.questionAnswers !== undefined ? { questionAnswers: input.questionAnswers } : {})
    };
    const condition = resolveGranularityCondition(input.granularityCondition);
    let breakdown: WorkBreakdown;
    let strategy: GranularityStrategyResult;
    let compiled: CompiledGraphRevision;
    if (input.experimentalCandidate === undefined && dependencies.planCandidates !== undefined) {
      let evaluation = await evaluateCandidateSet({
        plannerInput,
        envelope: planningEnvelope,
        repositorySnapshot,
        condition,
        observer: planningObserverFor(latestPlanningAttempt(events)),
        dependencies,
        sourceContract: {
          goal: input.goal,
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          constraints: input.constraints ?? []
        }
      });
      if (evaluation.kind === "replan_required") {
        evaluation = await evaluateCandidateSet({
          plannerInput: { ...plannerInput, candidateSetFeedback: candidateSetFeedback(evaluation) },
          envelope: planningEnvelope,
          repositorySnapshot,
          condition,
          observer: planningObserverFor(latestPlanningAttempt(events)),
          dependencies,
          sourceContract: {
            goal: input.goal,
            acceptanceCriteria: input.acceptanceCriteria ?? [],
            constraints: input.constraints ?? []
          }
        });
      }
      if (evaluation.kind === "clarification") {
        const drafts = clarificationEvents(evaluation.breakdown, nodeIdFor, dependencies.now, events.length);
        events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
        state = foldRun(events);
        await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
        return state;
      }
      if (evaluation.kind === "replan_required") {
        const feedback = candidateSetFeedback(evaluation);
        throw new Error(`No candidate survived the bounded semantic candidate replan. Rejected candidates: ${feedback.rejectedCandidateIds.join(", ") || "none"}. Findings: ${feedback.diagnostics.join(" | ") || "none"}.`);
      }
      breakdown = evaluation.candidate.breakdown;
      strategy = evaluation.strategy;
      compiled = evaluation.compiled;
    } else {
      breakdown = input.experimentalCandidate === undefined
        ? await dependencies.plan(plannerInput, planningObserverFor(latestPlanningAttempt(events)))
        : validateExperimentalCandidate(input, repositorySnapshot);
      breakdown = canonicalizeRepositorySnapshotReference(breakdown, repositorySnapshot.snapshotId);
      if (requiresClarification(breakdown)) {
        const drafts = clarificationEvents(breakdown, nodeIdFor, dependencies.now, events.length);
        events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
        state = foldRun(events);
        await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
        return state;
      }
      // The productive path uses policy C; the semantic planner selects a
      // frontier before the Graph Compiler materializes it.
      // The planner tree remains the single canonical model.
      strategy = selectGranularityStrategy({ condition, breakdown, repositorySnapshot, config: PILOT_UTILITY_POLICY });
      if (strategy.requiresSemanticReplan) {
        if (input.experimentalCandidate !== undefined) throw new Error("The blocked candidate requires semantic replan and cannot be changed during experimental replay.");
        const rootAssessment = strategy.assessments[breakdown.root.key];
        if (rootAssessment === undefined) throw new Error("C requested semantic replan without a root assessment.");
        breakdown = await dependencies.plan({
          ...plannerInput,
          granularityFeedback: {
            unitKey: rootAssessment.unitKey,
            reason: rootAssessment.leafFeasible ? "missing_semantic_cut" : "leaf_context_infeasible",
            evidence: [rootAssessment.rationale, ...rootAssessment.evidenceRefs]
          }
        }, planningObserverFor(latestPlanningAttempt(events)));
        breakdown = canonicalizeRepositorySnapshotReference(breakdown, repositorySnapshot.snapshotId);
        if (requiresClarification(breakdown)) {
          const drafts = clarificationEvents(breakdown, nodeIdFor, dependencies.now, events.length);
          events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
          state = foldRun(events);
          await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
          return state;
        }
        strategy = selectGranularityStrategy({ condition, breakdown, repositorySnapshot, config: PILOT_UTILITY_POLICY });
        if (strategy.requiresSemanticReplan) throw new Error("C could not obtain a viable semantic cut after one bounded replan.");
      }
      compiled = dependencies.compile({
        breakdown: strategy.selectedBreakdown,
        repositorySnapshot,
        sourceContract: {
          goal: input.goal,
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          constraints: input.constraints ?? []
        }
      });
    }
    const strategyEvent = strategySelectedEvent(
      input.runId,
      strategy,
      breakdown,
      nodeIdFor,
      dependencies.now,
      input.experimentalCandidate?.sourceHash
    );
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [strategyEvent])];
    const drafts = strategySuccessEvents(input.runId, strategy, compiled, dependencies.now);
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
    await writeStrategyDiagnostics(dependencies, input.runId, strategy, input.experimentalCandidate?.sourceHash);
    return state;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failed = await append(dependencies, input.runId, input.authority, events.length, [{
      eventId: `planning:${input.runId}:failed:${events.length + 1}`, occurredAt: dependencies.now(), type: "planning.failed", payload: { reason }
    }]);
    events = [...events, ...failed];
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
    return state;
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
  strategy: GranularityStrategyResult,
  compiled: CompiledGraphRevision,
  now: () => string
): RunEventInput[] {
  const breakdown = strategy.selectedBreakdown;
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
  candidateSourceHash?: string
): Promise<void> {
  const artifact = {
    runId,
    policyVersion: strategy.policyVersion,
    condition: strategy.condition,
    candidateTreeHash: strategy.candidateTreeHash,
    ...(candidateSourceHash === undefined ? {} : { candidateSourceHash }),
    config: strategy.config,
    metrics: structuralMetrics(strategy.selectedBreakdown.root),
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
