import {
  GraphRevisionSchema,
  type GraphRevision,
  type ReviseGraphInput
} from "./graph-revision.js";
import { validateGraphRevision, type GraphRevisionIssue } from "./validate-v2.js";

export interface ReduceGraphResult {
  nextRevision: GraphRevision;
  issues: GraphRevisionIssue[];
}

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as any)[key];
    if (val !== null && (typeof val === "object" || typeof val === "function")) {
      deepFreeze(val);
    }
  }
  return obj;
}

export function reduceGraphRevision(
  current: GraphRevision,
  input: ReviseGraphInput
): ReduceGraphResult {
  if (current.revision !== input.expectedRevision) {
    throw new Error(
      `Stale CAS GraphRevision write: expected revision ${input.expectedRevision}, but current revision is ${current.revision}.`
    );
  }

  if (input.operations.length === 0) {
    return {
      nextRevision: current,
      issues: []
    };
  }

  const next = structuredClone(current);
  next.revision += 1;
  next.createdAt = input.createdAt ?? new Date().toISOString();

  for (const op of input.operations) {
    switch (op.type) {
      case "upsert_node":
        next.nodes[op.node.id] = structuredClone(op.node);
        break;
      case "remove_node":
        delete next.nodes[op.nodeId];
        break;
      case "update_node_goal":
        if (next.nodes[op.nodeId]) {
          next.nodes[op.nodeId]!.goal = op.goal;
        }
        break;
      case "add_artifact_requirement":
        next.artifactRequirements.push(structuredClone(op.requirement));
        break;
      case "remove_artifact_requirement":
        next.artifactRequirements = next.artifactRequirements.filter(
          (item) => item.id !== op.requirementId
        );
        break;
      case "add_seam_binding":
        next.seamBindings.push(structuredClone(op.binding));
        break;
      case "remove_seam_binding":
        next.seamBindings = next.seamBindings.filter(
          (item) => item.id !== op.bindingId
        );
        break;
      case "add_conflict_constraint":
        next.conflictConstraints.push(structuredClone(op.constraint));
        break;
      case "remove_conflict_constraint":
        next.conflictConstraints = next.conflictConstraints.filter(
          (item) => item.id !== op.constraintId
        );
        break;
      case "remove_legacy_ordering_constraint":
        next.legacyOrderingConstraints = next.legacyOrderingConstraints.filter(
          (item) => item.id !== op.constraintId
        );
        break;
    }
  }

  const issues = validateGraphRevision(next);
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0) {
    throw new Error(
      `GraphRevision reduction produced invalid graph: ${errors.map((e) => e.message).join("; ")}`
    );
  }

  deepFreeze(next);
  return {
    nextRevision: GraphRevisionSchema.parse(next),
    issues
  };
}
