/**
 * SSE → RunEvent adapter (PR 11, additive half).
 *
 * Maps the LEGACY SSE event stream (`server/runs/events.ts`, a flat kind-based
 * union — aliased here as `StreamEvent` to dodge the deliberate name collision
 * with the new envelope) into the new agent-first `RunEvent[]` envelope, so the
 * existing live run can feed the same `runStore` + reducer + selectors the
 * fixtures already drive. This is the seam that lets the real run render through
 * the new model WITHOUT the backend emitting native events yet.
 *
 * PURE: no React, no SSE transport, no backend. Input is a plain array (e.g. from
 * `getRunEventHistory(runId)`); output is a plain `RunEvent[]`. Wiring this into
 * the legacy canvas (now removed) was the
 * SEPARATE, gated half of PR 11 — it touches legacy and needs a rollback flag.
 *
 * ── Coarseness (by design) ──────────────────────────────────────────────────
 * The legacy stream predates the agent-first model: it carries planning + COARSE
 * execution only. It does NOT emit seams, scope, waves, the verify-loop, conflicts,
 * amendments or evidence. So the bridged model is necessarily degraded vs a native
 * stream: nodes appear and reach running / done / failed, plus clarify gates — but
 * there is no freshness/obsolete/seam/conflict depth until the backend emits native
 * `RunEvent`s. Unmappable / redundant / non-model events are dropped (the reducer
 * also ignores unknowns, so dropping here keeps the envelope clean).
 *
 * Mapping (documented; the marked ones are reviewable judgement calls):
 *   planning.node.started             → plan.node.proposed (role: root if no parent, else leaf)
 *   planning.node.status              → plan.node.status (graph-generation telemetry:
 *                                       retrying/failed/fallback/generated; transient
 *                                       generating/active/pending dropped). PR-N1: this
 *                                       preserves the engine's D3 failure telemetry that
 *                                       PR11 was collapsing into a plain proposed node.
 *   planning.node.completed(children) → plan.node.proposed per childNode
 *   planning.question                 → decision.raised { clarify }
 *   gate.required                     → decision.raised { approve_plan }   ⚠ assumption
 *   agent.run.started                 → node.execution.started
 *   agent.run.completed(success)      → node.verify.passed | node.execution.failed
 *   validation.completed              → dropped (redundant with agent.run.completed) ⚠
 *   status.changed / title.updated / heartbeat / replay.* / planning.cli.output /
 *   node.added / edge.added / risk.added → dropped (derived, identity, or no data)
 *
 * `seq` is assigned 1-based over the OUTPUT events (the mapping is not 1:1 — a
 * `planning.node.completed` fans out to several), keeping the envelope strictly
 * monotonic for the reducer (`seq <= cursor` idempotency). `at` is carried from the
 * source event; `actor` is `agent` for agent.* and `system` otherwise.
 */
import type { StreamEvent } from "@/lib/server/runs/events";
import type {
  Actor,
  NodeRole,
  PlanningState,
  RunEvent,
  RunEventPayloads,
  RunEventType
} from "./types";

export interface CoordinatorEventEnvelope {
  eventId: string;
  runId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Lossless envelope adapter for the canonical V2 event journal. */
export function adaptCoordinatorEvent(event: CoordinatorEventEnvelope): RunEvent {
  return { eventId: event.eventId, seq: event.sequence, at: event.occurredAt, runId: event.runId, actor: "system", type: event.type, payload: structuredClone(event.payload) };
}

/** Placeholder for legacy fields the agent-first envelope requires but the stream lacks. */
const STREAM_PLACEHOLDER = "—";

/** A mapped envelope event before `seq`/`runId` are assigned. */
interface MappedEvent<K extends RunEventType = RunEventType> {
  actor: Actor;
  at: string;
  type: K;
  payload: RunEventPayloads[K];
}

function mk<K extends RunEventType>(actor: Actor, at: string, type: K, payload: RunEventPayloads[K]): MappedEvent<K> {
  return { actor, at, type, payload };
}

function roleFor(parentId: string | undefined): NodeRole {
  return parentId === undefined || parentId === null ? "root" : "leaf";
}

/**
 * Map the legacy planning lifecycle (`PlanningNodeState`) to the agent-first
 * `PlanningState`, or `null` for transient states the model does not record.
 * `complete` maps to `generated` (planned cleanly, clearing any prior retry).
 */
function toPlanningState(legacy: string): PlanningState | null {
  switch (legacy) {
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    case "fallback":
      return "fallback";
    case "generated":
    case "complete":
      return "generated";
    // generating / active / pending: transient, no concern → dropped.
    default:
      return null;
  }
}

/**
 * Map ONE legacy stream event to zero, one, or many envelope events (seq-less).
 * Exported for unit testing the per-kind mapping in isolation.
 */
export function adaptStreamEvent(event: StreamEvent): MappedEvent[] {
  switch (event.kind) {
    case "status.changed": {
      const out: MappedEvent[] = [];
      if (event.status === "needs_review") {
        out.push(
          mk("system", event.at, "decision.raised", {
            decisionId: "approve_plan",
            kind: "approve_plan",
            blocking: true,
            context: { nodeIds: [] }
          })
        );
      }
      if (event.status === "approved" || event.status === "running" || event.status === "completed") {
        out.push(
          mk("human", event.at, "decision.resolved", {
            decisionId: "approve_plan",
            choice: { action: "approve" },
            actor: "human"
          })
        );
      }
      if (event.status === "completed" || event.status === "failed" || event.status === "interrupted") {
        out.push(
          mk("system", event.at, "run.completed", {
            status: event.status === "completed" ? "success" : event.status
          })
        );
      }
      return out;
    }

    case "planning.node.started": {
      return [
        mk("system", event.at, "plan.node.proposed", {
          nodeId: event.nodeId,
          parentId: event.parentId ?? null,
          role: roleFor(event.parentId),
          title: event.title,
          goal: event.goal,
          depth: event.depth
        })
      ];
    }

    case "planning.node.status": {
      const state = toPlanningState(event.state);
      // Transient/no-op lifecycle states (generating/active/pending) carry no concern;
      // the node already exists via planning.node.started, so we drop them as noise.
      if (state === null) return [];
      return [
        mk("system", event.at, "plan.node.status", {
          nodeId: event.nodeId,
          state,
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.errorKind !== undefined ? { errorKind: event.errorKind } : {}),
          ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {})
        })
      ];
    }

    case "planning.node.completed": {
      // Only the child drafts carry enough data (title/goal/depth) to propose nodes.
      const children = event.childNodes ?? [];
      return children.map((child) =>
        mk("system", event.at, "plan.node.proposed", {
          nodeId: child.nodeId,
          parentId: child.parentId,
          role: "leaf",
          title: child.title,
          goal: child.goal,
          depth: child.depth
        })
      );
    }

    case "planning.question": {
      return [
        mk("system", event.at, "decision.raised", {
          decisionId: `clarify:${event.nodeId}`,
          kind: "clarify",
          blocking: true,
          context: { nodeIds: [event.nodeId], question: event.question, options: [...event.options] }
        })
      ];
    }

    case "gate.required": {
      // ⚠ Assumption: the legacy "gate" over ready task ids is the plan-approval gate.
      return [
        mk("system", event.at, "decision.raised", {
          decisionId: "approve_plan",
          kind: "approve_plan",
          blocking: true,
          context: { nodeIds: [...event.taskIds] }
        })
      ];
    }

    case "agent.run.started": {
      return [
        mk("agent", event.at, "node.execution.started", {
          nodeId: event.taskId,
          agent: "agent",
          model: STREAM_PLACEHOLDER
        })
      ];
    }

    case "agent.run.completed": {
      if (event.success) {
        return [
          mk("agent", event.at, "node.verify.passed", {
            nodeId: event.taskId,
            commit: STREAM_PLACEHOLDER,
            changedFiles: [],
            builtAgainst: []
          })
        ];
      }
      return [
        mk("agent", event.at, "node.execution.failed", {
          nodeId: event.taskId,
          cause: "agent run reported failure"
        })
      ];
    }

    // Dropped (derived phase / run identity / no model data / redundant). The reducer
    // ignores unknowns too, but dropping keeps the bridged envelope clean.
    case "validation.completed":
    case "title.updated":
    case "node.added":
    case "edge.added":
    case "risk.added":
    case "planning.cli.output":
    case "replay.start":
    case "replay.end":
    case "heartbeat":
      return [];

    default:
      return [];
  }
}

/**
 * Adapt a full legacy history (e.g. `getRunEventHistory(runId)`) into a monotonic
 * `RunEvent[]` envelope ready to fold through the reducer. Pure; never mutates the
 * input. `seq` is 1-based over the output (mapping is not 1:1).
 */
export function adaptStreamHistory(streamEvents: readonly StreamEvent[], runId: string): RunEvent[] {
  const out: RunEvent[] = [];
  let seq = 0;
  for (const stream of streamEvents) {
    for (const mapped of adaptStreamEvent(stream)) {
      seq += 1;
      out.push({
        seq,
        at: mapped.at,
        runId,
        actor: mapped.actor,
        type: mapped.type,
        payload: mapped.payload as Record<string, unknown>
      });
    }
  }
  return out;
}
