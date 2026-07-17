import type { CompiledGraphRevision, GraphCompilerInput, WorkBreakdown, WorkBreakdownPlannerInput } from "@manyhands/decomposer";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { PLAN_CRITIC_KINDS } from "@manyhands/decomposer";
import { foldRun, type RunEventInput, type RunProjection } from "@manyhands/run-coordinator";
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
}

export interface PlanningV2Dependencies {
  events: JsonlRunEventStore;
  snapshots: RunSnapshotStore;
  inspect(input: Pick<PlanningV2Input, "repoPath" | "targetFingerprint" | "baseCommit">): Promise<RepositorySnapshot>;
  plan(input: WorkBreakdownPlannerInput): Promise<WorkBreakdown>;
  compile(input: GraphCompilerInput): CompiledGraphRevision;
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

  try {
    const repositorySnapshot = await dependencies.inspect(input);
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, [{
      eventId: `repository:${repositorySnapshot.snapshotId}`, occurredAt: dependencies.now(), type: "repository.inspected",
      payload: { snapshotId: repositorySnapshot.snapshotId, disposition: repositorySnapshot.inspectionDisposition, snapshot: asRecord(repositorySnapshot) }
    }])];
    const breakdown = await dependencies.plan({
      goal: input.goal,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      repositorySnapshot: {
        snapshotId: repositorySnapshot.snapshotId,
        inspectionDisposition: repositorySnapshot.inspectionDisposition,
        evidence: repositoryEvidence(repositorySnapshot)
      },
      ...(input.questionAnswers !== undefined ? { questionAnswers: input.questionAnswers } : {})
    });
    const compiled = dependencies.compile({ breakdown, repositorySnapshot });
    const drafts = successEvents(input.runId, breakdown, compiled, dependencies.now);
    events = [...events, ...await append(dependencies, input.runId, input.authority, events.length, drafts)];
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
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
  const appended = await append(dependencies, runId, authority, expectedSequence, [
    { eventId: `${decisionId}:resolved`, occurredAt: dependencies.now(), type: "decision.resolved", payload: { decisionId, optionId: "approve" } },
    { eventId: `${decisionId}:graph-approved`, occurredAt: dependencies.now(), type: "graph.revision.approved", payload: { graphId: state.graphId!, revision } }
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

function successEvents(runId: string, breakdown: WorkBreakdown, compiled: CompiledGraphRevision, now: () => string): RunEventInput[] {
  return [
    { eventId: `planning:${breakdown.breakdownId}:completed`, occurredAt: now(), type: "planning.completed", payload: { breakdownId: breakdown.breakdownId, breakdown: asRecord(breakdown) } },
    ...compiledEvents(compiled, now)
  ];
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
  if (snapshot.index === undefined) return snapshot.diagnostics.map((diagnostic, index) => ({ id: `diagnostic-${index}`, kind: "diagnostic" as const, reference: diagnostic.filePath ?? snapshot.rootPath, observation: diagnostic.message, confidence: diagnostic.severity === "error" ? 0.3 : 0.7 }));
  return snapshot.index.files.map((file, index) => ({ id: `path-${index}`, kind: "path" as const, reference: file.path, observation: `Repository ${file.kind} file`, confidence: 1 }));
}

function asRecord<T>(value: T): Record<string, unknown> { return value as unknown as Record<string, unknown>; }
