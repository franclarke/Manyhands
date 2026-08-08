import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CompiledGraphRevision, GoalCriterion, GranularityStrategyResult, GraphCompilerInput, RecursivePlanner, SemanticPlan, WorkBreakdown, WorkUnit } from "@manyhands/decomposer";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { PLAN_CRITIC_KINDS, PILOT_UTILITY_POLICY, createSemanticPlan, projectPlannedTree, projectSemanticPlanForLegacyCompiler, resolveGranularityCondition, selectGranularityStrategy } from "@manyhands/decomposer";
import { foldRun, supersededDecisionIds, type RunEventInput, type RunProjection } from "@manyhands/run-coordinator";
import type { FencingAuthority, JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import {
  RunFailureReceiptStore,
  persistRunFailure,
  reconcilePendingRunFailures
} from "./run-failure-receipt";

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
}

/**
 * What approving or editing an already compiled revision needs: the journal and
 * a clock. It used to be the full planning surface with throwing stubs for the
 * parts approval never reaches, which said nothing except that the interface
 * was too wide.
 */
export interface PlanningV2JournalDependencies {
  events: JsonlRunEventStore;
  snapshots: RunSnapshotStore;
  now(): string;
}

export interface PlanningV2Dependencies extends PlanningV2JournalDependencies {
  inspect(input: Pick<PlanningV2Input, "repoPath" | "targetFingerprint" | "baseCommit">): Promise<RepositorySnapshot>;
  /** Product planning cuts one unit at a time. */
  recursivePlanner: RecursivePlanner;
  compile(input: GraphCompilerInput): CompiledGraphRevision;
  nodeIdFor?(key: string): string;
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
    store: new RunFailureReceiptStore({ directory: dependencies.events.directory }),
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
    const evidence = repositoryEvidence(repositorySnapshot);
    const criteria = goalCriteria(input);
    const plan = await dependencies.recursivePlanner.plan({
      root: {
        key: "root",
        objective: input.goal,
        criteria,
        reads: evidence.filter((item) => item.kind === "path").map((item) => item.reference),
        writes: []
      },
      criteria,
      evidence,
      observer: {
        // A resolved unit is exactly the durable node fact the journal
        // already records, so the redesigned path reuses it rather than
        // introducing a second way to say the same thing.
        onUnitResolved: async ({ unit, kind, position }) => {
          events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
            eventId: `planning:${input.runId}:unit:${unit.key}`,
            occurredAt: dependencies.now(),
            type: "planning.node_discovered",
            payload: {
              // Recursive planning is a single pass over the tree; a unit's
              // own repairs are recorded separately as attempt failures.
              // Counting resolved units here would make the journal claim to
              // measure attempts while measuring something else.
              attempt: 1,
              node: {
                nodeId: nodeIdFor(unit.key),
                parentNodeId: position.parentKey === null ? null : nodeIdFor(position.parentKey),
                key: unit.key,
                parentKey: position.parentKey,
                kind,
                title: unit.key,
                objective: unit.objective,
                siblingIndex: position.siblingIndex,
                siblingCount: position.siblingCount
              }
            }
          }])];
        },
        onRepairAttempted: async ({ unit, attempt: unitAttempt, diagnostics }) => {
          events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
            eventId: `planning:${input.runId}:unit:${unit.key}:repair:${unitAttempt}`,
            occurredAt: dependencies.now(),
            type: "planning.attempt_failed",
            payload: { attempt: unitAttempt, reason: diagnostics.join("; ") || "The cut was rejected." }
          }])];
        },
        onUnitUnresolved: async ({ unit, diagnostics, depth, position }) => {
          events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
            eventId: `planning:${input.runId}:unit:${unit.key}:unresolved`,
            occurredAt: dependencies.now(),
            type: "planning.unit_unresolved",
            payload: {
              nodeId: nodeIdFor(unit.key),
              key: unit.key,
              parentKey: position.parentKey,
              depth,
              diagnostics: diagnostics.length > 0 ? diagnostics : ["The cut was rejected."]
            }
          }])];
        }
      }
    });

    if (plan.unresolved.length > 0) {
      throw new Error(`no_safe_cut: ${plan.unresolved
        .map((node) => `${node.unit.key}: ${node.diagnostics.join("; ")}`)
        .join(" | ")}`);
    }

    const projected = projectPlannedTree({
      tree: plan.root,
      goal: input.goal,
      criteria,
      evidence,
      repositorySnapshotId: repositorySnapshot.snapshotId
    });
    const semanticPlan = createSemanticPlan({
      goal: input.goal,
      repositorySnapshotId: repositorySnapshot.snapshotId,
      criteria: [...projected.criteria],
      draft: projected.draft
    });
    const compiled = dependencies.compile({
      semanticPlan,
      repositorySnapshot,
      sourceContract: {
        goal: input.goal,
        acceptanceCriteria: criteria.map((criterion) => criterion.description),
        constraints: input.constraints ?? []
      }
    });
    // Stage 3D: the utility formula keeps being measured because it is what
    // lets the thesis say why a scalar could not decide granularity — but the
    // tree that compiles is the one the fixpoint produced. Its
    // `selectedBreakdown` is deliberately discarded.
    const observedBreakdown = projectSemanticPlanForLegacyCompiler(semanticPlan).breakdown;
    const observed = selectGranularityStrategy({
      condition: resolveGranularityCondition(input.granularityCondition),
      breakdown: observedBreakdown,
      repositorySnapshot,
      config: PILOT_UTILITY_POLICY
    });
    const drafts = [
      ...semanticSuccessEvents(input.runId, semanticPlan, compiled, dependencies.now),
      strategySelectedEvent(input.runId, observed, observedBreakdown, nodeIdFor, dependencies.now)
    ];
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
    await writeStrategyDiagnostics(dependencies, input.runId, observed, observedBreakdown);
    return state;
  } catch (error) {
    let recordedState: RunProjection | undefined;
    try {
      await persistRunFailure({
        store: new RunFailureReceiptStore({ directory: dependencies.events.directory }),
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
  dependencies: PlanningV2JournalDependencies
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
  dependencies: PlanningV2JournalDependencies
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
  now: () => string
): RunEventInput {
  return {
    eventId: `planning:${candidateBreakdown.breakdownId}:strategy:${runId}`,
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
      // The tree that compiled, never `strategy.selectedBreakdown`. Since 3D the
      // policy decides nothing, so its preferred tree is not the one that runs —
      // and depth reached is read from here. Measuring the policy's tree would
      // report a run that never happened, silently, whenever the two diverge.
      metrics: structuralMetrics(candidateBreakdown.root)
    }
  };
}

function semanticSuccessEvents(
  runId: string,
  plan: SemanticPlan,
  compiled: CompiledGraphRevision,
  now: () => string
): RunEventInput[] {
  return [
    { eventId: `planning:${plan.planId}:completed:${runId}`, occurredAt: now(), type: "planning.completed", payload: { breakdownId: plan.planId, breakdown: asRecord(plan) } },
    ...compiledEvents(compiled, now)
  ];
}

/**
 * A per-run diagnostic artifact carrying the structural measurement, alongside
 * the journal event. It is written after the state is durable: a measurement
 * that is not evidence must never be able to fail a run.
 */
async function writeStrategyDiagnostics(
  dependencies: PlanningV2JournalDependencies,
  runId: string,
  strategy: GranularityStrategyResult,
  measuredBreakdown: WorkBreakdown
): Promise<void> {
  const artifact = {
    runId,
    policyVersion: strategy.policyVersion,
    condition: strategy.condition,
    candidateTreeHash: strategy.candidateTreeHash,
    config: strategy.config,
    metrics: structuralMetrics(measuredBreakdown.root),
    generatedAt: dependencies.now()
  };
  const target = path.join(dependencies.events.directory, `${runId.replace(/[^A-Za-z0-9._-]/gu, "_")}.granularity-metrics.json`);
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}
`, "utf8");
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

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
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

async function append(dependencies: PlanningV2JournalDependencies, runId: string, authority: FencingAuthority, expected: number, events: RunEventInput[]) {
  return dependencies.events.appendFenced(runId, expected, authority, events);
}

async function recordPlanningFailure(
  input: Pick<PlanningV2Input, "runId" | "authority">,
  dependencies: PlanningV2JournalDependencies,
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

/**
 * A run states its goal; acceptance criteria are optional and today only a
 * replay supplies them. The goal itself is then the single root claim, and the
 * tree refines it: each child declares its own criterion below.
 */
function goalCriteria(input: PlanningV2Input): GoalCriterion[] {
  const declared = (input.acceptanceCriteria ?? [])
    .map((description) => description.trim())
    .filter((description) => description.length > 0);
  const source = declared.length > 0 ? declared : [input.goal];
  return source.map((description, index) => ({ id: `criterion-${index + 1}`, description, required: true }));
}

function defaultNodeIdFor(key: string): string {
  return `node-${key.replace(/[^A-Za-z0-9._:-]/gu, "-")}`;
}

function asRecord<T>(value: T): Record<string, unknown> { return value as unknown as Record<string, unknown>; }
