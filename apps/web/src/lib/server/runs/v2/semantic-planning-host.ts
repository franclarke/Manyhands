import {
  createPlanningModule,
  digest,
  PlanningAttemptRecordEventSchema,
  PlanningCapacityError,
  PlanningOutcomeEventSchema,
  PlanningTimeoutError,
  ProposalReceiptEventSchema,
  type PlanningAttemptRecord,
  type PlanningContext,
  type PlanningLease,
  type PlanningOutcome,
  type PlanningProtocol,
  type PlanningRecordPort,
  type ProposalReceipt,
  type SemanticPlanDraft
} from "@manyhands/decomposer";
import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import { foldRun, type RunEventInput, type RunProjection } from "@manyhands/run-coordinator";
import type { FencingAuthority, JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import type { ZodType, ZodTypeDef } from "zod";

export interface SemanticPlanningV2Input {
  runId: string;
  goal: string;
  acceptanceCriteria: string[];
  constraints: string[];
  repoPath: string;
  targetFingerprint: string;
  baseCommit: string;
  authority: FencingAuthority;
  protocol: "product" | "experiment";
  resolvedDecisions?: unknown[];
}

export interface SemanticPlanningV2Dependencies {
  events: JsonlRunEventStore;
  snapshots: RunSnapshotStore;
  inspect(input: Pick<SemanticPlanningV2Input, "repoPath" | "targetFingerprint" | "baseCommit">): Promise<RepositorySnapshot>;
  propose(request: {
    attemptId: string;
    slot: number;
    goal: PlanningContext["goal"];
    repositorySnapshot: RepositorySnapshot;
    resolvedDecisions: unknown[];
    constraints: string[];
  }): Promise<SemanticPlanDraft | unknown>;
  now(): string;
}

export async function runSemanticPlanningV2(
  input: SemanticPlanningV2Input,
  dependencies: SemanticPlanningV2Dependencies
): Promise<RunProjection> {
  await dependencies.events.advanceFence(input.runId, input.authority);
  let events = await dependencies.events.load(input.runId);
  if (events.length === 0) {
    events = [...events, ...await dependencies.events.appendFenced(input.runId, 0, input.authority, [{
      eventId: `run:${input.runId}:created`,
      occurredAt: dependencies.now(),
      type: "run.created",
      payload: { goal: input.goal }
    }])];
  }
  let state = foldRun(events);
  if (state.lifecycle !== "planning") return state;

  try {
    let repositorySnapshot = inspectedSnapshot(events);
    if (repositorySnapshot === undefined) {
      repositorySnapshot = await dependencies.inspect(input);
      events = [...events, ...await dependencies.events.appendFenced(input.runId, events.length, input.authority, [{
        eventId: `repository:${repositorySnapshot.snapshotId}:inspection:${events.length + 1}`,
        occurredAt: dependencies.now(),
        type: "repository.inspected",
        payload: {
          snapshotId: repositorySnapshot.snapshotId,
          disposition: repositorySnapshot.inspectionDisposition,
          snapshot: asRecord(repositorySnapshot)
        }
      }])];
    }
    const lease = planningLease(input);
    const context: PlanningContext = {
      goal: {
        id: `goal:${input.runId}`,
        statement: input.goal,
        requiredCriteria: requiredCriteria(input)
      },
      repositorySnapshot,
      resolvedDecisions: input.resolvedDecisions ?? [],
      constraints: input.constraints
    };
    const protocol = protocolFor(input.protocol);
    const records = new EventPlanningRecordPort(input.runId, input.authority, dependencies.events, dependencies.now);
    const planning = createPlanningModule({
      contexts: { load: async () => context },
      protocols: { load: async () => protocol },
      proposals: { propose: dependencies.propose },
      records,
      now: dependencies.now
    });
    const latestAttemptId = await records.latestAttemptId();
    const outcome = latestAttemptId === undefined
      ? await planning.start({ lease, protocol: { id: protocol.id, revision: protocol.revision } })
      : (await records.load(latestAttemptId))?.terminal === undefined
        ? await planning.resume({ attemptId: latestAttemptId, lease })
        : await planning.replay({ attemptId: latestAttemptId });

    events = await dependencies.events.load(input.runId);
    if (outcome.kind !== "ready") {
      const reason = `Semantic planning is not ready: ${outcome.reason}.`;
      const appended = await appendFailureUnlessPresent(input, dependencies, events, reason);
      state = foldRun(appended);
      await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, appended.at(-1)!.eventId);
      return state;
    }

    const graph = outcome.compiled.graph;
    if (!events.some((event) => event.type === "graph.compiled" && event.payload.graphId === graph.graphId && event.payload.revision === graph.revision)) {
      const decisionId = approvalDecisionId(graph.graphId, graph.revision);
      const appended = await dependencies.events.appendFenced(input.runId, events.length, input.authority, [
        {
          eventId: `graph:${graph.graphId}:r${graph.revision}:compiled`,
          occurredAt: dependencies.now(),
          type: "graph.compiled",
          payload: {
            graphId: graph.graphId,
            revision: graph.revision,
            graph: asRecord(graph),
            contracts: outcome.compiled.contracts.map(asRecord),
            review: { kind: "semantic_plan", passed: true, findings: [] },
            trace: {
              planId: outcome.selected.plan.planId,
              executionCutId: outcome.selected.executionCut.cutId,
              compilationHash: outcome.compiled.compilationHash
            }
          }
        },
        {
          eventId: `graph:${graph.graphId}:r${graph.revision}:proposed`,
          occurredAt: dependencies.now(),
          type: "graph.revision.proposed",
          payload: { graphId: graph.graphId, revision: graph.revision }
        },
        {
          eventId: decisionId,
          occurredAt: dependencies.now(),
          type: "decision.raised",
          payload: {
            decision: {
              id: decisionId,
              kind: "approve_plan",
              question: `Approve graph revision ${graph.revision}?`,
              options: [
                { id: "approve", label: "Approve plan" },
                { id: "request_changes", label: "Request changes" }
              ],
              affectedNodeIds: [graph.rootId],
              evidenceRefs: [
                `semantic-plan:${outcome.selected.plan.planId}`,
                `graph:${graph.graphId}:r${graph.revision}`
              ],
              impact: "acceptance"
            }
          }
        }
      ]);
      events = [...events, ...appended];
    }
    state = foldRun(events);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, events.at(-1)!.eventId);
    return state;
  } catch (error) {
    if (error instanceof PlanningCapacityError || error instanceof PlanningTimeoutError) throw error;
    events = await dependencies.events.load(input.runId);
    const persisted = await appendFailureUnlessPresent(
      input,
      dependencies,
      events,
      error instanceof Error ? error.message : String(error)
    );
    state = foldRun(persisted);
    await dependencies.snapshots.write(input.runId, input.authority, state, state.sequence, persisted.at(-1)!.eventId);
    return state;
  }
}

class EventPlanningRecordPort implements PlanningRecordPort {
  constructor(
    private readonly runId: string,
    private readonly authority: FencingAuthority,
    private readonly events: JsonlRunEventStore,
    private readonly now: () => string
  ) {}

  async begin(record: PlanningAttemptRecord): Promise<void> {
    this.assertLease(record.lease);
    await this.append({
      eventId: `${record.attemptId}:started`,
      occurredAt: this.now(),
      type: "planning.semantic_attempt_started",
      payload: { attemptId: record.attemptId, ...encodeRecord(record) }
    });
  }

  async recordProposal(attemptId: string, lease: PlanningLease, proposal: ProposalReceipt): Promise<void> {
    this.assertLease(lease);
    await this.append({
      eventId: `${attemptId}:proposal:${proposal.slot}`,
      occurredAt: this.now(),
      type: "planning.semantic_proposal_recorded",
      payload: { attemptId, ...encodeRecord(proposal) }
    });
  }

  async commitTerminal(attemptId: string, lease: PlanningLease, terminal: PlanningOutcome): Promise<void> {
    this.assertLease(lease);
    await this.append({
      eventId: `${attemptId}:terminal`,
      occurredAt: this.now(),
      type: "planning.semantic_terminal_committed",
      payload: { attemptId, ...encodeRecord(terminal) }
    });
  }

  async load(attemptId: string): Promise<PlanningAttemptRecord | undefined> {
    const events = await this.events.load(this.runId);
    const started = events.find((event) => event.type === "planning.semantic_attempt_started" && event.payload.attemptId === attemptId);
    if (started === undefined || started.type !== "planning.semantic_attempt_started") return undefined;
    const attempt = decodeRecord(started.payload, PlanningAttemptRecordEventSchema);
    attempt.proposals = events
      .flatMap((event) => event.type === "planning.semantic_proposal_recorded" && event.payload.attemptId === attemptId
        ? [decodeRecord(event.payload, ProposalReceiptEventSchema)]
        : [])
      .sort((left, right) => left.slot - right.slot);
    const terminal = events.find((event) => event.type === "planning.semantic_terminal_committed" && event.payload.attemptId === attemptId);
    if (terminal !== undefined && terminal.type === "planning.semantic_terminal_committed") {
      attempt.terminal = decodeRecord(terminal.payload, PlanningOutcomeEventSchema);
    }
    return attempt;
  }

  async latestAttemptId(): Promise<string | undefined> {
    return (await this.events.load(this.runId))
      .filter((event) => event.type === "planning.semantic_attempt_started")
      .at(-1)?.payload.attemptId;
  }

  private async append(input: RunEventInput): Promise<void> {
    const current = await this.events.load(this.runId);
    await this.events.appendFenced(this.runId, current.length, this.authority, [input]);
  }

  private assertLease(lease: PlanningLease): void {
    if (
      lease.runId !== this.runId
      || lease.holderId !== this.authority.operationId
      || lease.fenceToken !== String(this.authority.fencingToken)
    ) {
      throw new Error(`Planning lease does not match the fenced authority for run ${this.runId}.`);
    }
  }
}

function requiredCriteria(input: SemanticPlanningV2Input): PlanningContext["goal"]["requiredCriteria"] {
  const criteria = input.acceptanceCriteria.length === 0 ? [input.goal] : input.acceptanceCriteria;
  return criteria.map((statement, index) => ({ id: `criterion-${index + 1}`, statement }));
}

function protocolFor(kind: SemanticPlanningV2Input["protocol"]): PlanningProtocol {
  return kind === "experiment"
    ? {
        id: "thesis-semantic-comparison",
        revision: "1",
        proposalTarget: 2,
        minSafeCandidates: 2,
        minComparableCandidates: 2,
        allowDegradedComparison: false
      }
    : {
        id: "product-semantic-planning",
        revision: "1",
        proposalTarget: 2,
        minSafeCandidates: 1,
        minComparableCandidates: 0,
        allowDegradedComparison: true
      };
}

function planningLease(input: SemanticPlanningV2Input): PlanningLease {
  return {
    runId: input.runId,
    holderId: input.authority.operationId,
    fenceToken: String(input.authority.fencingToken)
  };
}

function inspectedSnapshot(events: Awaited<ReturnType<JsonlRunEventStore["load"]>>): RepositorySnapshot | undefined {
  const inspected = [...events].reverse().find((event) => event.type === "repository.inspected");
  if (inspected === undefined || inspected.type !== "repository.inspected" || inspected.payload.snapshot === undefined) return undefined;
  return RepositorySnapshotSchema.parse(inspected.payload.snapshot) as RepositorySnapshot;
}

async function appendFailureUnlessPresent(
  input: Pick<SemanticPlanningV2Input, "runId" | "authority">,
  dependencies: SemanticPlanningV2Dependencies,
  events: Awaited<ReturnType<JsonlRunEventStore["load"]>>,
  reason: string
) {
  if (events.some((event) => event.type === "planning.failed")) return events;
  const appended = await dependencies.events.appendFenced(input.runId, events.length, input.authority, [{
    eventId: `planning:${input.runId}:semantic-failed:${events.length + 1}`,
    occurredAt: dependencies.now(),
    type: "planning.failed",
    payload: { reason }
  }]);
  return [...events, ...appended];
}

function approvalDecisionId(graphId: string, revision: number): string {
  return `approve-plan:${graphId}:r${revision}`;
}

function asRecord<T>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function encodeRecord(value: unknown): { recordJson: string; recordSha256: string } {
  return { recordJson: JSON.stringify(value), recordSha256: digest(value) };
}

function decodeRecord<T>(
  envelope: { recordJson: string; recordSha256: string },
  schema: ZodType<T, ZodTypeDef, unknown>
): T {
  const parsed: unknown = JSON.parse(envelope.recordJson);
  if (digest(parsed) !== envelope.recordSha256) throw new Error("Semantic planning record digest mismatch.");
  return schema.parse(parsed);
}
