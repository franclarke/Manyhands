import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const TaskNodeStatusSchema = z.union([
  z.literal("planned"),
  z.literal("ready"),
  z.literal("blocked"),
  z.literal("running"),
  z.literal("validating"),
  z.literal("done"),
  z.literal("conflict"),
  z.literal("failed"),
  z.literal("merged")
]);

export type TaskNodeStatus = z.infer<typeof TaskNodeStatusSchema>;

export const TaskNodeKindSchema = z.union([z.literal("composite"), z.literal("leaf")]);

export type TaskNodeKind = z.infer<typeof TaskNodeKindSchema>;

export const TaskGranularityLevelSchema = z.union([
  z.literal("coarse"),
  z.literal("medium"),
  z.literal("fine")
]);

export type TaskGranularityLevel = z.infer<typeof TaskGranularityLevelSchema>;

export const TaskDependencyTypeSchema = z.union([
  z.literal("contractual"),
  z.literal("structural"),
  z.literal("logical")
]);

export type TaskDependencyType = z.infer<typeof TaskDependencyTypeSchema>;

export const TaskDependencySchema = z.object({
  fromTaskId: EntityIdSchema,
  toTaskId: EntityIdSchema,
  type: TaskDependencyTypeSchema,
  inferred: z.boolean(),
  rationale: NonEmptyStringSchema.optional()
});

export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export const TaskNodeMetricsSchema = z.object({
  durationMs: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  retries: z.number().int().nonnegative().optional()
});

/**
 * Free-form structured annotations attached to a task node by orchestration layers
 * (e.g. `{ integrator: true, integratesTaskIds: [...] }`).
 *
 * Intentionally permissive (`z.record(z.unknown())`) so the web layer or future
 * decomposers can extend semantics without a core schema bump. Reserved keys —
 * documented per surface — gain typed accessors in the consumer.
 *
 * Reserved (informal, not enforced):
 *  - `integrator` (boolean)
 *  - `integratesTaskIds` (string[])
 *  - `integrationReason` (string)
 *  - `authoredBy` ("ai" | "human")
 *  - `supersededBy` (string)
 */
export const TaskNodeMetadataSchema = z.record(z.unknown());

export type TaskNodeMetadata = z.infer<typeof TaskNodeMetadataSchema>;

export const TaskNodeSchema = z.object({
  id: EntityIdSchema,
  parentId: EntityIdSchema.nullable(),
  kind: TaskNodeKindSchema,
  title: NonEmptyStringSchema,
  intent: NonEmptyStringSchema,
  status: TaskNodeStatusSchema,
  granularity: TaskGranularityLevelSchema,
  depth: z.number().int().nonnegative(),
  childrenIds: z.array(EntityIdSchema).default([]),
  contract: AgentTaskContractSchema.optional(),
  worktree: NonEmptyStringSchema.optional(),
  agentId: NonEmptyStringSchema.optional(),
  metrics: TaskNodeMetricsSchema.optional(),
  metadata: TaskNodeMetadataSchema.optional()
});

export type TaskNode = Omit<z.infer<typeof TaskNodeSchema>, "contract"> & {
  contract?: AgentTaskContract;
};

export const TaskGraphSchema = z.object({
  id: EntityIdSchema,
  planId: EntityIdSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema,
  featureRequest: NonEmptyStringSchema,
  nodes: z.record(EntityIdSchema, TaskNodeSchema),
  dependencies: z.array(TaskDependencySchema).default([]),
  rootId: EntityIdSchema,
  createdAt: IsoTimestampSchema
});

export type TaskGraph = Omit<z.infer<typeof TaskGraphSchema>, "nodes"> & {
  nodes: Record<string, TaskNode>;
};

export const TaskValidationIssueCodeSchema = z.union([
  z.literal("schema_invalid"),
  z.literal("missing_root"),
  z.literal("cycle_detected"),
  z.literal("leaf_without_contract"),
  z.literal("empty_scope"),
  z.literal("dangling_dependency"),
  z.literal("max_depth_exceeded"),
  z.literal("non_atomic_leaf"),
  z.literal("orphan_node"),
  z.literal("parent_child_mismatch"),
  z.literal("invalid_node_kind")
]);

export type TaskValidationIssueCode = z.infer<typeof TaskValidationIssueCodeSchema>;

export const TaskValidationIssueSchema = z.object({
  code: TaskValidationIssueCodeSchema,
  taskId: EntityIdSchema.optional(),
  message: NonEmptyStringSchema,
  severity: z.union([z.literal("error"), z.literal("warning")])
});

export type TaskValidationIssue = z.infer<typeof TaskValidationIssueSchema>;

export interface TaskReadiness {
  taskId: string;
  isReady: boolean;
  unmetDependencies: string[];
  blockingConflicts: string[];
}

export interface TaskGraphValidationOptions {
  maxDepth?: number;
}

export interface ReadinessOptions {
  blockingConflictIdsByTask?: Record<string, string[]>;
}

const resolvedStatuses = new Set<TaskNodeStatus>(["done", "merged"]);
const runnableStatuses = new Set<TaskNodeStatus>(["planned", "ready", "blocked"]);

export function validateTaskGraph(
  graphInput: TaskGraph,
  options: TaskGraphValidationOptions = {}
): TaskValidationIssue[] {
  const issues: TaskValidationIssue[] = [];
  const parsed = TaskGraphSchema.safeParse(graphInput);

  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: "schema_invalid",
      message: `${issue.path.join(".")}: ${issue.message}`,
      severity: "error"
    }));
  }

  const graph = parsed.data as TaskGraph;
  const root = graph.nodes[graph.rootId];

  if (!root) {
    issues.push({
      code: "missing_root",
      taskId: graph.rootId,
      message: `root node ${graph.rootId} does not exist`,
      severity: "error"
    });
  }

  for (const node of Object.values(graph.nodes)) {
    if (options.maxDepth !== undefined && node.depth > options.maxDepth) {
      issues.push({
        code: "max_depth_exceeded",
        taskId: node.id,
        message: `node ${node.id} has depth ${node.depth}, above max depth ${options.maxDepth}`,
        severity: "error"
      });
    }

    if (node.kind === "leaf" && node.childrenIds.length > 0) {
      issues.push({
        code: "invalid_node_kind",
        taskId: node.id,
        message: `leaf node ${node.id} must not declare children`,
        severity: "error"
      });
    }

    if (node.kind === "composite" && node.childrenIds.length === 0) {
      issues.push({
        code: "invalid_node_kind",
        taskId: node.id,
        message: `composite node ${node.id} must declare at least one child`,
        severity: "error"
      });
    }

    if (node.kind === "leaf") {
      if (!node.contract) {
        issues.push({
          code: "leaf_without_contract",
          taskId: node.id,
          message: `leaf node ${node.id} does not have an agent task contract`,
          severity: "error"
        });
      } else {
        const contract = AgentTaskContractSchema.safeParse(node.contract);

        if (!contract.success) {
          issues.push({
            code: "leaf_without_contract",
            taskId: node.id,
            message: `leaf node ${node.id} has an invalid contract`,
            severity: "error"
          });
        } else {
          if (contract.data.allowed.paths.length === 0) {
            issues.push({
              code: "empty_scope",
              taskId: node.id,
              message: `leaf node ${node.id} declares an empty allowed scope`,
              severity: "error"
            });
          }

          if (contract.data.acceptance.length === 0) {
            issues.push({
              code: "non_atomic_leaf",
              taskId: node.id,
              message: `leaf node ${node.id} has no acceptance criteria`,
              severity: "error"
            });
          }
        }
      }
    }

    for (const childId of node.childrenIds) {
      const child = graph.nodes[childId];

      if (!child) {
        issues.push({
          code: "parent_child_mismatch",
          taskId: node.id,
          message: `node ${node.id} references missing child ${childId}`,
          severity: "error"
        });
      } else if (child.parentId !== node.id) {
        issues.push({
          code: "parent_child_mismatch",
          taskId: child.id,
          message: `child ${child.id} does not point back to parent ${node.id}`,
          severity: "error"
        });
      }
    }

    if (node.parentId !== null) {
      const parent = graph.nodes[node.parentId];

      if (!parent || !parent.childrenIds.includes(node.id)) {
        issues.push({
          code: "parent_child_mismatch",
          taskId: node.id,
          message: `node ${node.id} declares parent ${node.parentId} but is not listed as its child`,
          severity: "error"
        });
      }
    }
  }

  for (const dependency of graph.dependencies) {
    if (!graph.nodes[dependency.fromTaskId] || !graph.nodes[dependency.toTaskId]) {
      issues.push({
        code: "dangling_dependency",
        message: `dependency ${dependency.fromTaskId} -> ${dependency.toTaskId} references a missing node`,
        severity: "error"
      });
    }
  }

  const cycle = findCycle(graph);

  if (cycle.length > 0) {
    issues.push({
      code: "cycle_detected",
      message: `cycle detected: ${cycle.join(" -> ")}`,
      severity: "error"
    });
  }

  if (root) {
    for (const orphanId of findOrphanNodeIds(graph)) {
      issues.push({
        code: "orphan_node",
        taskId: orphanId,
        message: `node ${orphanId} is not reachable from root ${graph.rootId}`,
        severity: "error"
      });
    }
  }

  return issues;
}

export function getLeafNodes(graph: TaskGraph): TaskNode[] {
  return Object.values(graph.nodes).filter((node) => node.kind === "leaf");
}

export function getTopologicalOrder(graph: TaskGraph): string[] {
  const adjacency = buildAdjacency(graph);
  const nodeIds = Object.keys(graph.nodes);
  const indegree = new Map<string, number>(nodeIds.map((nodeId) => [nodeId, 0]));

  for (const [fromId, toIds] of adjacency.entries()) {
    if (!graph.nodes[fromId]) {
      continue;
    }

    for (const toId of toIds) {
      if (!graph.nodes[toId]) {
        continue;
      }

      indegree.set(toId, (indegree.get(toId) ?? 0) + 1);
    }
  }

  const queue = nodeIds.filter((nodeId) => (indegree.get(nodeId) ?? 0) === 0).sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (!nodeId) {
      break;
    }

    result.push(nodeId);

    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (!graph.nodes[nextId]) {
        continue;
      }

      const nextIndegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextIndegree);

      if (nextIndegree === 0) {
        queue.push(nextId);
        queue.sort();
      }
    }
  }

  if (result.length !== nodeIds.length) {
    throw new Error("task graph contains a cycle");
  }

  return result;
}

export function getLeafReadiness(
  graph: TaskGraph,
  options: ReadinessOptions = {}
): TaskReadiness[] {
  return getLeafNodes(graph).map((node) => getTaskReadiness(graph, node.id, options));
}

export function getReadyLeaves(graph: TaskGraph, options: ReadinessOptions = {}): TaskNode[] {
  const readinessByTask = new Map(
    getLeafReadiness(graph, options).map((readiness) => [readiness.taskId, readiness])
  );

  return getLeafNodes(graph).filter((node) => readinessByTask.get(node.id)?.isReady === true);
}

export function getTaskReadiness(
  graph: TaskGraph,
  taskId: string,
  options: ReadinessOptions = {}
): TaskReadiness {
  const node = graph.nodes[taskId];

  if (!node || node.kind !== "leaf") {
    return {
      taskId,
      isReady: false,
      unmetDependencies: [],
      blockingConflicts: []
    };
  }

  const unmetDependencies = graph.dependencies
    .filter((dependency) => dependency.toTaskId === taskId)
    .filter((dependency) => !resolvedStatuses.has(graph.nodes[dependency.fromTaskId]?.status ?? "planned"))
    .map((dependency) => dependency.fromTaskId);

  const blockingConflicts = options.blockingConflictIdsByTask?.[taskId] ?? [];
  const isRunnableStatus = runnableStatuses.has(node.status);

  return {
    taskId,
    isReady: isRunnableStatus && unmetDependencies.length === 0 && blockingConflicts.length === 0,
    unmetDependencies,
    blockingConflicts
  };
}

export function aggregateTaskStatus(graph: TaskGraph, taskId: string): TaskNodeStatus {
  const node = graph.nodes[taskId];

  if (!node) {
    throw new Error(`unknown task ${taskId}`);
  }

  if (node.kind === "leaf") {
    return node.status;
  }

  const childStatuses = node.childrenIds.map((childId) => aggregateTaskStatus(graph, childId));

  if (childStatuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (childStatuses.some((status) => status === "conflict")) {
    return "conflict";
  }

  if (childStatuses.every((status) => status === "done" || status === "merged")) {
    return "done";
  }

  if (childStatuses.some((status) => status === "running")) {
    return "running";
  }

  if (childStatuses.some((status) => status === "validating")) {
    return "validating";
  }

  if (childStatuses.some((status) => status === "ready")) {
    return "ready";
  }

  if (childStatuses.some((status) => status === "blocked")) {
    return "blocked";
  }

  return "planned";
}

function buildAdjacency(graph: TaskGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const nodeId of Object.keys(graph.nodes)) {
    adjacency.set(nodeId, []);
  }

  for (const node of Object.values(graph.nodes)) {
    const outgoing = adjacency.get(node.id);

    if (outgoing) {
      outgoing.push(...node.childrenIds);
    }
  }

  for (const dependency of graph.dependencies) {
    const outgoing = adjacency.get(dependency.fromTaskId);

    if (outgoing) {
      outgoing.push(dependency.toTaskId);
    }
  }

  return adjacency;
}

function findCycle(graph: TaskGraph): string[] {
  const adjacency = buildAdjacency(graph);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): string[] => {
    if (visiting.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(Math.max(start, 0)), nodeId];
    }

    if (visited.has(nodeId)) {
      return [];
    }

    visiting.add(nodeId);
    stack.push(nodeId);

    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (!graph.nodes[nextId]) {
        continue;
      }

      const cycle = visit(nextId);

      if (cycle.length > 0) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return [];
  };

  for (const nodeId of Object.keys(graph.nodes)) {
    const cycle = visit(nodeId);

    if (cycle.length > 0) {
      return cycle;
    }
  }

  return [];
}

function findOrphanNodeIds(graph: TaskGraph): string[] {
  const reachable = new Set<string>();
  const visit = (nodeId: string): void => {
    if (reachable.has(nodeId)) {
      return;
    }

    reachable.add(nodeId);

    for (const childId of graph.nodes[nodeId]?.childrenIds ?? []) {
      visit(childId);
    }
  };

  visit(graph.rootId);

  return Object.keys(graph.nodes).filter((nodeId) => !reachable.has(nodeId)).sort();
}
