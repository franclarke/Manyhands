/**
 * Planning → run-model adapter (pure).
 *
 * The decomposer reports per-node step callbacks in tree order as it works. This
 * module maps those steps into native agent-first `RunEvent` inputs so the live
 * `/run-events` stream can build the graph in real time — the root appears first,
 * then each level as the decomposer recurses — mirroring how the execution-phase
 * trace adapter (`run-model-trace-adapter.ts`) works.
 *
 * PURE: no IO, no React, no SSE. The runner owns dedup (one proposal per node)
 * and publishing (append + bus). Closing the gap here is what makes the agent-first
 * workspace update during `generating` instead of staying stuck on "planificando".
 */
import type { RunModelEventInput } from "./run-model-event-log";
import type {
  NodeRole,
  PlanningState,
  PlanDependencyProposedPayload
} from "@/lib/run-model/types";
import { approvalDecisionId } from "./decision-identity";

export interface ProposedNode {
  nodeId: string;
  parentId: string | null;
  title: string;
  goal: string;
  depth: number;
}

/** A single node entering the proposed plan (root / group / task). */
export function planNodeProposedEvent(node: ProposedNode, role: NodeRole): RunModelEventInput {
  return {
    actor: "system",
    type: "plan.node.proposed",
    payload: {
      nodeId: node.nodeId,
      parentId: node.parentId,
      role,
      title: node.title,
      goal: node.goal,
      depth: node.depth
    }
  };
}

export interface PlanNodeStatusInput extends ProposedNode {
  state: PlanningState;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
}

/** A live planning heartbeat for a node that is being generated / retried / finalized. */
export function planNodeStatusEvent(node: PlanNodeStatusInput): RunModelEventInput {
  return {
    actor: "system",
    type: "plan.node.status",
    payload: {
      nodeId: node.nodeId,
      state: node.state,
      ...(node.attempt !== undefined ? { attempt: node.attempt } : {}),
      ...(node.maxAttempts !== undefined ? { maxAttempts: node.maxAttempts } : {}),
      ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
      ...(node.errorKind !== undefined ? { errorKind: node.errorKind } : {}),
      ...(node.errorMessage !== undefined ? { errorMessage: node.errorMessage } : {})
    }
  };
}

export interface SeamDraftInput {
  seamId: string;
  name: string;
  producerNodeId: string;
  consumerNodeIds: readonly string[];
  draftSignature: string;
}

export interface PlanCompletion {
  planRevision: number;
  rootId: string;
  nodeCount: number;
  dependencies: readonly PlanDependencyProposedPayload[];
  seams: readonly SeamDraftInput[];
  criticFindings: readonly string[];
  /** Nodes the human gates on (leaves + integrators); drives blocked highlighting. */
  executableNodeIds: readonly string[];
}

/**
 * The events that finalize a proposed plan: the seam drafts, the `plan.ready`
 * milestone, and the blocking `approve_plan` decision the human resolves. Emitted
 * once when planning reaches `needs_review`.
 */
export function planCompletionEvents(input: PlanCompletion): RunModelEventInput[] {
  const events: RunModelEventInput[] = input.dependencies.map((dependency) => ({
    actor: "system",
    type: "plan.dependency.proposed",
    payload: {
      fromTaskId: dependency.fromTaskId,
      toTaskId: dependency.toTaskId,
      type: dependency.type,
      inferred: dependency.inferred,
      ...(dependency.rationale !== undefined ? { rationale: dependency.rationale } : {})
    }
  }));

  for (const seam of input.seams) {
    events.push({
      actor: "system",
      type: "plan.seam.proposed",
      payload: {
        seamId: seam.seamId,
        name: seam.name,
        producerNodeId: seam.producerNodeId,
        consumerNodeIds: [...seam.consumerNodeIds],
        draftSignature: seam.draftSignature
      }
    });
  }

  events.push({
    actor: "system",
    type: "plan.ready",
    payload: {
      rootId: input.rootId,
      nodeCount: input.nodeCount,
      seamCount: input.seams.length,
      criticFindings: [...input.criticFindings]
    }
  });

  events.push({
    actor: "system",
    type: "decision.raised",
    payload: {
      decisionId: approvalDecisionId(input.planRevision),
      kind: "approve_plan",
      blocking: true,
      context: { nodeIds: [...input.executableNodeIds] }
    }
  });

  return events;
}
