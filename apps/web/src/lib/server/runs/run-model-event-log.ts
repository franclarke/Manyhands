import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { durableWritesEnabled } from "../workspaces/atomic-write";
import type { Actor, RunEvent, RunEventPayloads, RunEventType } from "@/lib/run-model/types";
import type { RunRecord } from "./schema";
import {
  approvalDecisionId,
  approvalDecisionRevision,
  isLegacyApprovalDecisionId
} from "./decision-identity";
import { resolveRunsDirectory } from "./repository";
import {
  executionSelectionForDisplay as executionSelection,
  planningSelectionForDisplay as planningSelection,
  repairSelectionForDisplay as repairSelection
} from "./executor-selection";
import {
  projectRunRecordToPlanGraph,
  projectRunRecordToRunEvents,
  runControlForRun
} from "./run-model-projection";
import { publishRunModelBusEvent } from "./run-model-event-bus";
import { globalSingleton } from "../global-singleton";
import { terminalDispositionForArtifact } from "./final-artifact";
import { RunMutationConflictError, RunValidationError } from "./errors";

const ATOMIC_RENAME_RETRIES = 5;

export type RunModelEventInput<K extends RunEventType = RunEventType> = {
  /** Stable producer identity: retries return the existing durable event. */
  eventId?: string;
  at?: string;
  actor: Actor;
  type: K;
  payload: RunEventPayloads[K];
};

// On globalThis: appends happen from several Next route bundles (pipelines,
// cancel, decisions); a per-bundle lock map would not serialize seq assignment.
const writeChains = globalSingleton(
  "run-model-event-log:write-chains",
  () => new Map<string, Promise<unknown>>()
);

export async function readRunModelEvents(runId: string): Promise<RunEvent[]> {
  return (await inspectRunModelEventLog(runId)).events;
}

export interface RunModelEventLogInspection {
  events: RunEvent[];
  /** `degraded` is a repairable trailing partial line; `corrupt` is a real invalid record. */
  status: "ok" | "degraded" | "corrupt";
  reason?: string;
}

export interface RunModelEventBatch {
  events: RunEvent[];
  nextCursor: number;
  hasMore: boolean;
  status: "ok" | "degraded";
  /** True when the reader resumed from the sparse offset index rather than byte zero. */
  indexed: boolean;
}

interface SparseOffset { seq: number; offset: number; }
interface SparseOffsetCache { size: number; mtimeMs: number; offsets: SparseOffset[]; }
const sparseOffsetCaches = globalSingleton("run-model-event-log:sparse-offsets", () => new Map<string, SparseOffsetCache>());
const OFFSET_STRIDE = 256;

/**
 * B-027 incremental reader. It scans JSONL as a stream so reconnects retain
 * only the requested delta in memory; callers resume from the durable seq.
 */
export async function readRunModelEventBatch(runId: string, afterSeq: number, limit = 250): Promise<RunModelEventBatch> {
  const safeLimit = Math.max(1, Math.min(limit, 1_000));
  const file = filePathFor(runId);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(file);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], nextCursor: afterSeq, hasMore: false, status: "ok", indexed: false };
    throw error;
  }
  const cached = sparseOffsetCaches.get(file);
  const cache = cached?.size === info.size && cached.mtimeMs === info.mtimeMs ? cached : undefined;
  const start = cache?.offsets.filter((entry) => entry.seq <= afterSeq + 1).at(-1);
  const startOffset = start?.offset ?? 0;
  const events: RunEvent[] = [];
  let expectedSeq = start?.seq ?? 1;
  let byteOffset = startOffset;
  const offsets = cache?.offsets ?? [];
  let hasMore = false;
  let status: "ok" | "degraded" = "ok";
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: "utf8", start: startOffset }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const lineOffset = byteOffset;
    byteOffset += Buffer.byteLength(line, "utf8") + 1;
    let event: RunEvent;
    try {
      event = JSON.parse(line) as RunEvent;
    } catch {
      status = "degraded";
      break;
    }
    if (!isEventShape(event, runId) || event.seq !== expectedSeq) {
      status = "degraded";
      break;
    }
    const durable = event as Partial<DurableRunEvent>;
    if (durable.schemaVersion !== undefined && (durable.schemaVersion !== 1 || typeof durable.eventId !== "string" || typeof durable.checksum !== "string" || durable.checksum !== checksumFor(durable as DurableRunEvent))) {
      status = "degraded";
      break;
    }
    expectedSeq += 1;
    if (event.seq % OFFSET_STRIDE === 1 && !offsets.some((entry) => entry.seq === event.seq)) {
      offsets.push({ seq: event.seq, offset: lineOffset });
    }
    if (event.seq <= afterSeq) continue;
    if (events.length >= safeLimit) {
      hasMore = true;
      break;
    }
    events.push(event);
  }
  sparseOffsetCaches.set(file, { size: info.size, mtimeMs: info.mtimeMs, offsets: offsets.sort((left, right) => left.seq - right.seq) });
  return { events, nextCursor: events.at(-1)?.seq ?? afterSeq, hasMore, status, indexed: startOffset > 0 };
}

export async function inspectRunModelEventLog(runId: string): Promise<RunModelEventLogInspection> {
  try {
    return inspectRawLog(runId, await readFile(filePathFor(runId), "utf8"));
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], status: "ok" };
    throw error;
  }
}

export async function ensureRunModelEventLogForRun(run: RunRecord): Promise<RunEvent[]> {
  // Dynamic import avoids a static cycle: recovery writes through this module
  // and resets the execution checkpoint before any approval/execution consumer
  // can observe the post-CAS RunRecord.
  const {
    hasPendingPlanMutation,
    recoverPendingAmendmentMutations
  } = await import("./plan-mutation-recovery");
  const recoveredRun = await recoverPendingAmendmentMutations(run.runId, run);
  // A fresh direct writer may still own the post-CAS finalization. Do not let a
  // read-side projection publish late graph/approval facts ahead of checkpoint
  // reset and the operation's canonical atomic event batch.
  if (await hasPendingPlanMutation(run.runId)) {
    return readRunModelEvents(run.runId);
  }
  const existing = await readRunModelEvents(recoveredRun.runId);
  if (existing.length > 0) return reconcileExistingRunModelEventLog(recoveredRun, existing);

  const projected = safeProjectRunRecordToRunEvents(recoveredRun);
  if (projected.length === 0) return [];

  return withLock(recoveredRun.runId, async () => {
    const current = await inspectRunModelEventLog(recoveredRun.runId);
    if (current.events.length > 0) return current.events;
    return appendInputsLocked(
      recoveredRun.runId,
      projected.map((event) => ({ actor: event.actor, at: event.at, type: event.type as RunEventType, payload: event.payload }))
    );
  });
}

async function reconcileExistingRunModelEventLog(run: RunRecord, existing: RunEvent[]): Promise<RunEvent[]> {
  if (requiredInputsForRun(run, existing).length === 0) return existing;

  return withLock(run.runId, async () => {
    const current = await readRunModelEvents(run.runId);
    const required = requiredInputsForRun(run, current);
    if (required.length === 0) return current;
    const appended = await appendInputsLocked(run.runId, required);
    return [...current, ...appended.filter((event) => !current.some((existing) => existing.eventId === event.eventId))];
  });
}

/** B-018 recovery outbox: durable RunRecord facts repair their required projection once. */
function requiredInputsForRun(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const required: RunModelEventInput[] = [];
  const latestStatus = [...events].reverse().find((event) => event.type === "run.status.changed");
  const projectedStatus = (latestStatus?.payload as { status?: unknown } | undefined)?.status;
  if (projectedStatus !== run.status) {
    required.push({
      eventId: `recovery-status:${run.runId}:v${run.version}:${run.status}`,
      actor: "system",
      at: run.updatedAt,
      type: "run.status.changed",
      payload: runControlForRun(run) as unknown as Record<string, unknown>
    });
  }
  const graphProjectionInputs = requiredPlanGraphProjectionInputs(run, events);
  required.push(...graphProjectionInputs);
  // Legacy additive logs need a canonical D1 dependency backfill. Once an
  // exact graph projection exists (or is being recovered in this append), its
  // dependency snapshot is already authoritative; appending an additive fact
  // after it would immediately make the projection stale again.
  if (
    graphProjectionInputs.length === 0 &&
    !events.some((event) => event.type === "plan.graph.projected")
  ) {
    required.push(...requiredDependencyInputs(run, events));
  }
  required.push(...requiredApprovalInputs(run, events));
  required.push(...requiredPendingQuestionInputs(run, events));
  required.push(...requiredObsoleteDecisionInputs(run, events));
  required.push(...requiredDeliveryInputs(run, events));
  return required;
}

function requiredPlanGraphProjectionInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const revision = run.planRevision ?? 1;
  const projectionPatches = (run.patches ?? []).filter((patch) => {
    if (typeof patch !== "object" || patch === null || !("type" in patch)) return false;
    return (patch as { type?: unknown }).type !== "RISK_ACKNOWLEDGED";
  });
  let latestProjectionIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "plan.graph.projected") {
      latestProjectionIndex = index;
      break;
    }
  }
  const latestProjection = latestProjectionIndex >= 0 ? events[latestProjectionIndex] : undefined;
  if (revision === 1 && projectionPatches.length === 0 && latestProjection === undefined) return [];

  const hasSemanticRevision = revision > 1 || projectionPatches.some((patch) => {
    const type = (patch as { type?: unknown }).type;
    return type !== "NODE_RENAMED";
  });
  const resetRuntime = hasSemanticRevision && (run.status === "needs_review" || run.status === "approved");
  const projection = projectRunRecordToPlanGraph(run, { resetRuntime });
  if (projection === null) return [];
  const projectedNodeIds = new Set(projection.nodes.map((node) => node.nodeId));
  const projectedSeamIds = new Set(projection.seams.map((seam) => seam.seamId));
  const lateStructuralFact = latestProjectionIndex >= 0
    ? events.slice(latestProjectionIndex + 1).find((event) =>
        conflictsWithPlanGraphProjection(event, projectedNodeIds, projectedSeamIds)
      )
    : undefined;
  const expected = planGraphStructuralIdentity(projection);
  const alreadyProjected = latestProjection !== undefined &&
    planGraphStructuralIdentity(
      latestProjection.payload as unknown as RunEventPayloads["plan.graph.projected"]
    ) === expected;
  if (alreadyProjected && lateStructuralFact === undefined) return [];
  const recoveryAnchor = lateStructuralFact?.seq ?? latestProjection?.seq ?? 0;
  const identityHash = createHash("sha256").update(expected).digest("hex").slice(0, 16);
  return [{
    eventId: `recovery-plan-graph:${run.runId}:v${run.version}:r${revision}:after-${recoveryAnchor}:${identityHash}`,
    at: run.updatedAt,
    actor: "system",
    type: "plan.graph.projected",
    payload: projection
  }];
}

function conflictsWithPlanGraphProjection(
  event: RunEvent,
  projectedNodeIds: ReadonlySet<string>,
  projectedSeamIds: ReadonlySet<string>
): boolean {
  // These facts rewrite graph structure even when every referenced entity is
  // still present, so a late legacy/additive event invalidates the snapshot.
  if (
    event.type === "plan.node.proposed" ||
    event.type === "plan.dependency.proposed" ||
    event.type === "plan.seam.proposed"
  ) {
    return true;
  }

  // Runtime and planning facts normally belong after a projection and must be
  // preserved for surviving nodes. They conflict only when reducer.ensureNode
  // would resurrect a node removed by the durable graph.
  if (
    event.type === "plan.node.status" ||
    event.type === "scope.derived" ||
    event.type === "node.execution.started" ||
    event.type === "node.verify.iteration" ||
    event.type === "node.verify.passed" ||
    event.type === "node.execution.failed"
  ) {
    const nodeId = (event.payload as { nodeId?: unknown }).nodeId;
    return typeof nodeId === "string" && !projectedNodeIds.has(nodeId);
  }
  if (event.type === "integration.validated" || event.type === "integration.completed") {
    const compositeNodeId = (event.payload as { compositeNodeId?: unknown }).compositeNodeId;
    return typeof compositeNodeId === "string" && !projectedNodeIds.has(compositeNodeId);
  }

  // Both reducer branches synthesize a seam when it is missing. Re-project
  // only for that ghost case; freezes/amendments for a surviving seam are
  // legitimate runtime facts and remain visible.
  if (event.type === "seam.frozen" || event.type === "seam.amended") {
    const seamId = (event.payload as { seamId?: unknown }).seamId;
    return typeof seamId === "string" && !projectedSeamIds.has(seamId);
  }
  return false;
}

function planGraphStructuralIdentity(payload: RunEventPayloads["plan.graph.projected"]): string {
  return JSON.stringify({
    projectionVersion: payload.projectionVersion,
    planRevision: payload.planRevision,
    nodes: payload.nodes,
    dependencies: payload.dependencies,
    seams: payload.seams
  });
}

function requiredDependencyInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  type Payload = RunEventPayloads["plan.dependency.proposed"];
  const existing = new Set(
    events
      .filter((event) => event.type === "plan.dependency.proposed")
      .map((event) => dependencyPayloadIdentity(event.payload as unknown as Payload))
  );
  const revision = run.planRevision ?? 1;
  return safeProjectRunRecordToRunEvents(run).flatMap((event): RunModelEventInput[] => {
    if (event.type !== "plan.dependency.proposed") return [];
    const payload = event.payload as unknown as Payload;
    if (existing.has(dependencyPayloadIdentity(payload))) return [];
    return [{
      eventId: `recovery-plan-dependency:${run.runId}:r${revision}:${payload.fromTaskId}:${payload.toTaskId}`,
      actor: "system",
      at: run.updatedAt,
      type: "plan.dependency.proposed",
      payload
    }];
  });
}

function dependencyPayloadIdentity(payload: RunEventPayloads["plan.dependency.proposed"]): string {
  return JSON.stringify([
    payload.fromTaskId,
    payload.toTaskId,
    payload.type,
    payload.inferred,
    payload.rationale ?? null
  ]);
}

function requiredPendingQuestionInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const question = run.pendingQuestion;
  if (question === undefined || (run.status !== "paused" && run.status !== "interrupted")) return [];
  const decisionId = `clarify:${question.nodeId}`;
  const raised = events.some(
    (event) => event.type === "decision.raised" && event.payload.decisionId === decisionId
  );
  const resolved = events.some(
    (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
  );
  // A late projection must never reopen a gate that already has a durable
  // resolution, even if a stale RunRecord still carries pendingQuestion.
  if (raised || resolved) return [];
  return [{
    eventId: `clarify-raised:${run.runId}:${question.nodeId}`,
    actor: "system",
    at: run.updatedAt,
    type: "decision.raised",
    payload: {
      decisionId,
      kind: "clarify",
      blocking: true,
      context: {
        nodeIds: [question.nodeId],
        question: question.question,
        options: [...question.options]
      }
    }
  }];
}

function requiredObsoleteDecisionInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const resolved = new Set(
    events
      .filter((event) => event.type === "decision.resolved")
      .map((event) => (event.payload as { decisionId?: unknown }).decisionId)
      .filter((decisionId): decisionId is string => typeof decisionId === "string")
  );
  return events.flatMap((event): RunModelEventInput[] => {
    if (event.type !== "decision.raised") return [];
    const payload = event.payload as { decisionId?: unknown; kind?: unknown };
    if (
      payload.kind !== "approve_merge" ||
      typeof payload.decisionId !== "string" ||
      resolved.has(payload.decisionId)
    ) {
      return [];
    }
    return [{
      eventId: `recovery-obsolete-approve-merge:${run.runId}:${payload.decisionId}`,
      actor: "system",
      at: run.updatedAt,
      type: "decision.resolved",
      payload: {
        decisionId: payload.decisionId,
        choice: { action: "reject" },
        actor: "system"
      }
    }];
  });
}

function requiredDeliveryInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const manifest = run.finalArtifactManifest;
  if (
    run.status !== "completed" ||
    run.deliveryOutcome !== "delivered" ||
    manifest === undefined ||
    terminalDispositionForArtifact({ manifest, acceptedRisk: false }) !== "completed"
  ) {
    return [];
  }
  const inputs: RunModelEventInput[] = [];
  const hasDeliveryFact = events.some((event) => {
    if (event.type !== "run.delivery.completed") return false;
    const payload = event.payload as { manifestId?: unknown; finalSha?: unknown };
    return payload.manifestId === manifest.manifestId && payload.finalSha === manifest.finalSha;
  });
  if (!hasDeliveryFact) {
    inputs.push({
      eventId: `recovery-delivery-completed:${run.runId}:${manifest.manifestId}`,
      actor: "system",
      at: run.updatedAt,
      type: "run.delivery.completed",
      payload: { manifestId: manifest.manifestId, finalSha: manifest.finalSha }
    });
  }
  const hasTerminalFact = events.some(
    (event) =>
      event.type === "run.completed" &&
      (event.payload as { status?: unknown }).status === "success"
  );
  if (!hasTerminalFact) {
    inputs.push({
      eventId: `recovery-run-completed:${run.runId}:${manifest.manifestId}`,
      actor: "system",
      at: run.updatedAt,
      type: "run.completed",
      payload: { status: "success" }
    });
  }
  return inputs;
}

function requiredApprovalInputs(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const raised = events.filter((event) => {
    if (event.type !== "decision.raised") return false;
    const payload = event.payload as { decisionId?: unknown; kind?: unknown };
    return payload.kind === "approve_plan" && typeof payload.decisionId === "string";
  });

  const resolved = new Set(
    events
      .filter((event) => event.type === "decision.resolved")
      .map((event) => (event.payload as { decisionId?: unknown }).decisionId)
      .filter((decisionId): decisionId is string => typeof decisionId === "string")
  );
  const currentRevision = run.planRevision ?? 1;
  const currentDecisionId = approvalDecisionId(currentRevision);
  const approvedRevision = run.approvedPlanRevision ?? (run.approvedAt !== undefined ? currentRevision : undefined);
  const inputs: RunModelEventInput[] = [];

  for (const event of raised) {
    const decisionId = (event.payload as { decisionId: string }).decisionId;
    if (resolved.has(decisionId)) continue;
    const revision = approvalDecisionRevision(decisionId);
    const approvedLegacy =
      isLegacyApprovalDecisionId(decisionId) &&
      run.approvedAt !== undefined &&
      (run.approvedPlanRevision ?? 1) === 1;
    const approvedCanonical = revision !== undefined && revision === approvedRevision && run.approvedAt !== undefined;
    const superseded =
      (revision !== undefined && revision < currentRevision) ||
      (isLegacyApprovalDecisionId(decisionId) && !approvedLegacy);
    if (!approvedLegacy && !approvedCanonical && !superseded) continue;
    const action = approvedLegacy || approvedCanonical ? "approve" : "reject";
    inputs.push({
      eventId: `recovery-approval:${run.runId}:${decisionId}:${action}:r${currentRevision}`,
      actor: approvedLegacy || approvedCanonical ? "human" : "system",
      at: approvedLegacy || approvedCanonical ? run.approvedAt ?? run.updatedAt : run.updatedAt,
      type: "decision.resolved",
      payload: {
        decisionId,
        choice: { action },
        actor: approvedLegacy || approvedCanonical ? "human" : "system"
      }
    });
  }

  const hasCurrentGate = raised.some(
    (event) => (event.payload as { decisionId?: unknown }).decisionId === currentDecisionId
  );
  if (run.planning !== undefined && run.status !== "created" && run.status !== "generating" && !hasCurrentGate) {
    const latestApproval = raised.at(-1);
    const previousNodeIds = latestApproval === undefined
      ? undefined
      : (latestApproval.payload as { context?: { nodeIds?: unknown } }).context?.nodeIds;
    const currentGraph = projectRunRecordToPlanGraph(run);
    const nodeIds = currentGraph !== null
      ? currentGraph.nodes
          .filter((node) => node.role === "leaf")
          .map((node) => node.nodeId)
      : Array.isArray(previousNodeIds)
        ? previousNodeIds.filter((id): id is string => typeof id === "string")
        : [];
    inputs.push({
      eventId: `recovery-approval-raised:${run.runId}:${currentDecisionId}`,
      actor: "system",
      at: run.updatedAt,
      type: "decision.raised",
      payload: {
        decisionId: currentDecisionId,
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds }
      }
    });
    if (approvedRevision === currentRevision && run.approvedAt !== undefined && !resolved.has(currentDecisionId)) {
      inputs.push({
        eventId: `recovery-approval:${run.runId}:${currentDecisionId}:approve:r${currentRevision}`,
        actor: "human",
        at: run.approvedAt,
        type: "decision.resolved",
        payload: {
          decisionId: currentDecisionId,
          choice: { action: "approve" },
          actor: "human"
        }
      });
    }
  }
  return inputs;
}

export async function appendRunModelEvent<K extends RunEventType>(
  runId: string,
  input: RunModelEventInput<K>
): Promise<RunEvent> {
  return withLock(runId, async () => (await appendInputsLocked(runId, [input]))[0]!);
}

export async function appendRunEventsRequired(
  runId: string,
  inputs: readonly RunModelEventInput[]
): Promise<RunEvent[]> {
  if (inputs.length === 0) return [];
  return withLock(runId, async () => appendInputsLocked(runId, inputs));
}

/** Re-check a human gate under the durable event-log mutex. */
export async function assertPendingDecisionRequired(run: RunRecord, decisionId: string): Promise<void> {
  await withLock(run.runId, async () => {
    const inspection = await inspectRunModelEventLog(run.runId);
    assertDecisionPendingInEvents(run, inspection.events, decisionId);
  });
}

/** Atomically append the complete resolution batch for one pending decision. */
export async function appendPendingDecisionEventsRequired(
  run: RunRecord,
  decisionId: string,
  inputs: readonly RunModelEventInput[]
): Promise<RunEvent[]> {
  const resolution = inputs.find((input) =>
    input.type === "decision.resolved" &&
    (input.payload as { decisionId?: unknown }).decisionId === decisionId
  );
  if (resolution === undefined) {
    throw new RunValidationError(`Decision batch ${decisionId} has no matching resolution event.`);
  }
  return withLock(run.runId, async () => {
    const inspection = await inspectWritableRunModelEventLog(run.runId);
    if (inspection.status === "corrupt") {
      throw new Error(`Run event log ${run.runId} is corrupt: ${inspection.reason ?? "unknown corruption"}`);
    }
    assertDecisionPendingInEvents(run, inspection.events, decisionId);
    return appendInputsLocked(run.runId, inputs);
  });
}

function assertDecisionPendingInEvents(run: RunRecord, events: readonly RunEvent[], decisionId: string): void {
  const raised = events.some(
    (event) => event.type === "decision.raised" && event.payload.decisionId === decisionId
  );
  const resolved = events.some(
    (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
  );
  if (!raised || resolved) {
    throw new RunMutationConflictError(
      `Decision "${decisionId}" is no longer pending.`,
      run.status,
      run.version
    );
  }
}

/**
 * Required lifecycle/audit event: callers must await this and fail the current
 * operation if the append-only event log cannot be written.
 */
export const appendRunEventRequired = appendRunModelEvent;

/** Build a required event from its durable sequence while holding the append lock. */
export async function appendRunEventRequiredWithSeq<K extends RunEventType>(
  runId: string,
  build: (seq: number, existingEvents: readonly RunEvent[]) => RunModelEventInput<K>
): Promise<RunEvent> {
  return withLock(runId, async () => {
    const inspection = await inspectRunModelEventLog(runId);
    if (inspection.status === "corrupt") throw new Error(`Run event log ${runId} is corrupt: ${inspection.reason ?? "unknown"}`);
    return (await appendInputsLocked(runId, [
      build((inspection.events.at(-1)?.seq ?? 0) + 1, inspection.events)
    ]))[0]!;
  });
}

/**
 * Best-effort projection/detail event: failures are logged but do not block the
 * run. Use this only for events that can be reconstructed or are UI detail, not
 * for lifecycle status/decision/cancellation guarantees.
 */
export async function appendRunEventBestEffort<K extends RunEventType>(
  runId: string,
  input: RunModelEventInput<K>
): Promise<RunEvent | undefined> {
  try {
    return await appendRunModelEvent(runId, input);
  } catch (error) {
    console.warn(
      `[run-model-event-log] best-effort append failed for ${input.type} on ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

// Fire-and-forget publishes tracked for test drains: a publish still in flight
// when a test restores MANYHANDS_RUNS_DIR would write into the REAL runs dir.
// On globalThis: publishes happen from several Next route bundles.
const pendingPublishes = globalSingleton(
  "run-model-event-log:pending-publishes",
  () => new Set<Promise<unknown>>()
);

export function publishRunModelEvent<K extends RunEventType>(runId: string, input: RunModelEventInput<K>): void {
  const write = appendRunEventBestEffort(runId, input).finally(() => pendingPublishes.delete(write));
  pendingPublishes.add(write);
}

/** Await every fire-and-forget publish currently in flight (test teardown). */
export async function drainRunModelEventWritesForTests(): Promise<void> {
  while (pendingPublishes.size > 0) {
    await Promise.allSettled(Array.from(pendingPublishes));
  }
}

export async function resetRunModelEventLogForTests(runId: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(filePathFor(runId));
  } catch (error) {
    if (!isErrno(error) || error.code !== "ENOENT") throw error;
  }
}

function safeProjectRunRecordToRunEvents(run: RunRecord): RunEvent[] {
  try {
    return projectRunRecordToRunEvents(run);
  } catch (error) {
    console.warn(
      `[run-model-event-log] projection fallback for ${run.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return minimalRunEvents(run);
  }
}

function minimalRunEvents(run: RunRecord): RunEvent[] {
  const planning = planningSelection(run);
  const exec = executionSelection(run);
  const repair = repairSelection(run);
  const events: RunEvent[] = [
    {
      seq: 1,
      at: run.createdAt,
      runId: run.runId,
      actor: "system",
      type: "run.created",
      payload: {
        intent: run.userPrompt || run.title,
        workspaceId: run.workspaceId,
        config: {
          aggressiveness: run.granularity === "fine" ? "high" : run.granularity === "coarse" ? "low" : "medium",
          planningModel: planning.model,
          executionSelection: exec,
          repairSelection: repair
        }
      }
    }
  ];
  if (run.provisioned !== undefined) {
    events.push({
      seq: events.length + 1,
      at: run.provisioned.provisionedAt,
      runId: run.runId,
      actor: "system",
      type: "run.context.resolved",
      payload: {
        repo: run.provisioned.repoRoot,
        baseCommit: run.provisioned.baseCommit,
        readiness: "ok"
      }
    });
  }
  events.push({
    seq: events.length + 1,
    at: run.updatedAt,
    runId: run.runId,
    actor: "system",
    type: "run.status.changed",
    payload: runControlForRun(run) as unknown as Record<string, unknown>
  });
  return events;
}

type DurableRunEvent = RunEvent & { schemaVersion: 1; eventId: string; checksum: string };

async function appendInputsLocked(runId: string, inputs: readonly RunModelEventInput[]): Promise<RunEvent[]> {
  const inspection = await inspectWritableRunModelEventLog(runId);
  if (inspection.status === "corrupt") {
    throw new Error(`Run event log ${runId} is corrupt: ${inspection.reason ?? "unknown corruption"}`);
  }

  const byId = new Map(
    inspection.events
      .filter((event): event is RunEvent & { eventId: string } => event.eventId !== undefined)
      .map((event) => [event.eventId, event])
  );
  let seq = inspection.events.at(-1)?.seq ?? 0;
  const appended: RunEvent[] = [];
  const newLines: string[] = [];
  for (const input of inputs) {
    const eventId = input.eventId ?? randomUUID();
    const existing = byId.get(eventId);
    if (existing !== undefined) {
      appended.push(existing);
      continue;
    }
    const event: DurableRunEvent = {
      schemaVersion: 1,
      eventId,
      seq: ++seq,
      at: input.at ?? new Date().toISOString(),
      runId,
      actor: input.actor,
      type: input.type,
      payload: input.payload as Record<string, unknown>,
      checksum: ""
    };
    event.checksum = checksumFor(event);
    byId.set(eventId, event);
    appended.push(event);
    newLines.push(JSON.stringify(event));
  }

  if (newLines.length > 0 || inspection.status === "degraded") {
    await atomicWriteEventLog(runId, [...inspection.validLines, ...newLines]);
  }
  for (const event of appended) {
    if (!inspection.events.some((existing) => existing.eventId === event.eventId)) {
      publishRunModelBusEvent(runId, event);
    }
  }
  return appended;
}

async function inspectWritableRunModelEventLog(
  runId: string
): Promise<RunModelEventLogInspection & { validLines: string[] }> {
  try {
    return inspectRawLog(runId, await readFile(filePathFor(runId), "utf8"));
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], validLines: [], status: "ok" };
    throw error;
  }
}

function inspectRawLog(runId: string, raw: string): RunModelEventLogInspection & { validLines: string[] } {
  const lines = raw.split(/\r?\n/);
  const validLines: string[] = [];
  const events: RunEvent[] = [];
  const eventIds = new Set<string>();
  let expectedSeq = 1;
  const lastNonEmpty = lines.reduce((last, line, index) => (line.trim().length > 0 ? index : last), -1);

  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;
    let event: RunEvent;
    try {
      event = JSON.parse(line) as RunEvent;
    } catch {
      if (index === lastNonEmpty && !raw.endsWith("\n")) {
        return { events, validLines, status: "degraded", reason: "trailing partial JSONL line" };
      }
      return { events, validLines, status: "corrupt", reason: `invalid JSON at line ${index + 1}` };
    }
    if (!isEventShape(event, runId)) {
      return { events, validLines, status: "corrupt", reason: `invalid envelope at line ${index + 1}` };
    }
    const durable = event as Partial<DurableRunEvent>;
    if (durable.schemaVersion !== undefined) {
      if (durable.schemaVersion !== 1 || typeof durable.eventId !== "string" || typeof durable.checksum !== "string") {
        return { events, validLines, status: "corrupt", reason: `invalid durable envelope at line ${index + 1}` };
      }
      if (durable.checksum !== checksumFor(durable as DurableRunEvent)) {
        return { events, validLines, status: "corrupt", reason: `checksum mismatch at line ${index + 1}` };
      }
    }
    if (event.seq !== expectedSeq) {
      return { events, validLines, status: "corrupt", reason: `non-monotonic seq at line ${index + 1}` };
    }
    expectedSeq += 1;
    if (event.eventId !== undefined && eventIds.has(event.eventId)) {
      return { events, validLines, status: "corrupt", reason: `duplicate eventId at line ${index + 1}` };
    }
    if (event.eventId !== undefined) eventIds.add(event.eventId);
    validLines.push(line);
    events.push(event);
  }
  return { events, validLines, status: "ok" };
}

function isEventShape(event: RunEvent, runId: string): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    event.runId === runId &&
    Number.isInteger(event.seq) &&
    event.seq > 0 &&
    typeof event.at === "string" &&
    typeof event.actor === "string" &&
    typeof event.type === "string" &&
    typeof event.payload === "object" &&
    event.payload !== null
  );
}

function checksumFor(event: DurableRunEvent): string {
  const content = JSON.stringify({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    seq: event.seq,
    at: event.at,
    runId: event.runId,
    actor: event.actor,
    type: event.type,
    payload: event.payload
  });
  return createHash("sha256").update(content).digest("hex");
}

async function atomicWriteEventLog(runId: string, lines: readonly string[]): Promise<void> {
  const file = filePathFor(runId);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
    if (durableWritesEnabled()) await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Windows can retain a transient handle on an event log during atomic publish. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = isErrno(error) ? error.code : undefined;
      if (attempt >= ATOMIC_RENAME_RETRIES || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

function filePathFor(runId: string): string {
  return path.join(resolveRunsDirectory(), `${safeFileName(runId)}.events.jsonl`);
}

function safeFileName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(runId) ?? Promise.resolve();
  const next = previous.then(() => withFilesystemLock(runId, fn), () => withFilesystemLock(runId, fn));
  writeChains.set(runId, next.catch(() => undefined));
  return next;
}

async function withFilesystemLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const locks = path.join(resolveRunsDirectory(), ".event-locks");
  const lock = path.join(locks, safeFileName(runId));
  const token = randomUUID();
  await mkdir(locks, { recursive: true });
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(
        path.join(lock, "owner.json"),
        JSON.stringify({ token, pid: process.pid, acquiredAt: Date.now() }),
        "utf8"
      );
      break;
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
        const quarantine = `${lock}.stale-${randomUUID()}`;
        try {
          await rename(lock, quarantine);
          await rm(quarantine, { recursive: true, force: true });
        } catch (takeoverError) {
          if (!isErrno(takeoverError) || takeoverError.code !== "ENOENT") throw takeoverError;
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out locking event log for ${runId}.`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await removeEventLock(lock, token);
  }
}

/** Release only the lock generation acquired by this writer. */
async function removeEventLock(lock: string, token: string): Promise<void> {
  const owner = await readEventLockOwner(lock);
  if (owner?.token !== token) return;
  const quarantine = `${lock}.released-${token}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(lock, quarantine);
      const captured = await readEventLockOwner(quarantine);
      if (captured?.token !== token) {
        await rename(quarantine, lock).catch(() => undefined);
        return;
      }
      await rm(quarantine, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = isErrno(error) ? error.code : undefined;
      if (code === "ENOENT") return;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function readEventLockOwner(lock: string): Promise<{ token: string } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as { token?: unknown };
    return typeof parsed.token === "string" ? { token: parsed.token } : undefined;
  } catch {
    return undefined;
  }
}

interface NodeErrnoException {
  code?: string;
}

function isErrno(value: unknown): value is NodeErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}

export async function hasRunModelEventLog(runId: string): Promise<boolean> {
  try {
    const info = await stat(filePathFor(runId));
    return info.isFile() && info.size > 0;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
