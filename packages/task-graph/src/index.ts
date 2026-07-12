import {
  AgentTaskContractSchema,
  validateAgentTaskContractBoundary,
  type AgentTaskContract
} from "@manyhands/contracts";
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

export const TaskNodeKindSchema = z.union([
  z.literal("root"),
  z.literal("composite"),
  z.literal("leaf"),
  z.literal("integrator")
]);

export type TaskNodeKind = z.infer<typeof TaskNodeKindSchema>;

export const TaskGranularityLevelSchema = z.union([
  z.literal("auto"),
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
  goal: NonEmptyStringSchema,
  status: TaskNodeStatusSchema,
  granularity: TaskGranularityLevelSchema,
  depth: z.number().int().nonnegative(),
  childrenIds: z.array(EntityIdSchema).default([]),
  dependencies: z.array(EntityIdSchema).default([]),
  prompt: NonEmptyStringSchema.optional(),
  acceptanceCriteria: z.array(NonEmptyStringSchema).optional(),
  output: z.record(z.unknown()).optional(),
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
  z.literal("multiple_roots"),
  z.literal("cycle_detected"),
  z.literal("leaf_without_contract"),
  z.literal("contract_invalid"),
  z.literal("contract_task_id_mismatch"),
  z.literal("unsafe_contract_path"),
  z.literal("missing_expected_output"),
  z.literal("orphan_consumed_interface"),
  z.literal("duplicate_produced_interface"),
  z.literal("empty_scope"),
  z.literal("dangling_dependency"),
  z.literal("dependency_sync_divergence"),
  z.literal("max_depth_exceeded"),
  z.literal("non_atomic_leaf"),
  z.literal("orphan_node"),
  z.literal("parent_child_mismatch"),
  z.literal("invalid_node_kind"),
  z.literal("invalid_integrator"),
  // B-009 (CF-12/13): full tree+DAG invariants.
  z.literal("invalid_root"),
  z.literal("node_key_mismatch"),
  z.literal("invalid_depth"),
  z.literal("duplicate_child"),
  z.literal("duplicate_dependency")
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

  const rootKindNodes = Object.values(graph.nodes).filter((n) => n.kind === "root");
  if (rootKindNodes.length > 1) {
    issues.push({
      code: "multiple_roots",
      message: `graph has ${rootKindNodes.length} root-kind nodes, expected at most 1`,
      severity: "error"
    });
  }

  if (root && root.kind === "root" && root.parentId !== null) {
    issues.push({
      code: "invalid_node_kind",
      taskId: root.id,
      message: `root-kind node ${root.id} must have parentId === null`,
      severity: "error"
    });
  }

  // B-009 (CF-12): the graph's entry node must be a real tree root — a
  // non-zero depth or a non-null parent there means the hierarchy is corrupt
  // no matter how schema-valid the nodes look. A single-node plan MAY be
  // rooted at a leaf (trivial prompt → one atomic task); a multi-node graph
  // rooted at an executable node is always incoherent.
  if (root) {
    const nodeCount = Object.keys(graph.nodes).length;
    if (root.kind !== "root" && root.kind !== "composite" && nodeCount > 1) {
      issues.push({
        code: "invalid_root",
        taskId: root.id,
        message: `rootId points at a ${root.kind} node in a ${nodeCount}-node graph; the root must be a root/composite node`,
        severity: "error"
      });
    }
    if (root.parentId !== null) {
      issues.push({
        code: "invalid_root",
        taskId: root.id,
        message: `root node ${root.id} must have parentId === null`,
        severity: "error"
      });
    }
    if (root.depth !== 0) {
      issues.push({
        code: "invalid_root",
        taskId: root.id,
        message: `root node ${root.id} must have depth 0, found ${root.depth}`,
        severity: "error"
      });
    }
  }

  // B-009 (CF-12): map key ↔ node id identity.
  for (const [key, node] of Object.entries(graph.nodes)) {
    if (key !== node.id) {
      issues.push({
        code: "node_key_mismatch",
        taskId: node.id,
        message: `node stored under key "${key}" declares id "${node.id}"`,
        severity: "error"
      });
    }
  }

  // B-009 (CF-12): canonical dependency edges must be unique.
  const seenEdges = new Set<string>();
  for (const dependency of graph.dependencies) {
    const key = `${dependency.fromTaskId}->${dependency.toTaskId}`;
    if (seenEdges.has(key)) {
      issues.push({
        code: "duplicate_dependency",
        taskId: dependency.toTaskId,
        message: `dependency ${key} is declared more than once in graph.dependencies`,
        severity: "error"
      });
    }
    seenEdges.add(key);
  }

  const incomingDeps = buildIncomingDependencyIndex(graph);

  for (const node of Object.values(graph.nodes)) {
    if (options.maxDepth !== undefined && node.depth > options.maxDepth) {
      issues.push({
        code: "max_depth_exceeded",
        taskId: node.id,
        message: `node ${node.id} has depth ${node.depth}, above max depth ${options.maxDepth}`,
        severity: "error"
      });
    }

    if ((node.kind === "leaf" || node.kind === "integrator") && node.childrenIds.length > 0) {
      issues.push({
        code: "invalid_node_kind",
        taskId: node.id,
        message: `${node.kind} node ${node.id} must not declare children`,
        severity: "error"
      });
    }

    if ((node.kind === "composite" || node.kind === "root") && node.childrenIds.length === 0) {
      issues.push({
        code: "invalid_node_kind",
        taskId: node.id,
        message: `${node.kind} node ${node.id} must declare at least one child`,
        severity: "error"
      });
    }

    if (node.kind === "integrator") {
      const integratesTaskIds = node.metadata?.integratesTaskIds;
      if (!Array.isArray(integratesTaskIds) || integratesTaskIds.length === 0) {
        issues.push({
          code: "invalid_integrator",
          taskId: node.id,
          message: `integrator node ${node.id} must specify integratesTaskIds in metadata`,
          severity: "warning"
        });
      }
    }

    if (node.kind === "leaf") {
      const hasGoal = node.prompt !== undefined || node.contract?.objective !== undefined;
      if (!hasGoal) {
        issues.push({
          code: "leaf_without_contract",
          taskId: node.id,
          message: `leaf node ${node.id} has neither prompt nor contract.objective`,
          severity: "warning"
        });
      }

      if (node.contract) {
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

          if (contract.data.acceptance.length === 0 && (node.acceptanceCriteria === undefined || node.acceptanceCriteria.length === 0)) {
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

    // B-009 (CF-13): the shortcut and the canonical edges must be the SAME
    // set, in both directions. Divergence means consumers of the shortcut see
    // a different reality than the scheduler.
    {
      const canonicalIncoming = new Set(incomingDeps.get(node.id) ?? []);
      const shortcut = new Set(node.dependencies);
      if (shortcut.size !== node.dependencies.length) {
        issues.push({
          code: "duplicate_dependency",
          taskId: node.id,
          message: `node ${node.id} lists duplicate entries in node.dependencies`,
          severity: "error"
        });
      }
      for (const depId of node.dependencies) {
        if (!canonicalIncoming.has(depId)) {
          issues.push({
            code: "dependency_sync_divergence",
            taskId: node.id,
            message: `node ${node.id} lists dependency ${depId} not found in graph.dependencies`,
            severity: "warning"
          });
        }
      }
      for (const depId of canonicalIncoming) {
        // A dep from a missing node is already reported as dangling_dependency;
        // flagging sync divergence on top would double-report one defect.
        if (!shortcut.has(depId) && graph.nodes[depId] !== undefined) {
          issues.push({
            code: "dependency_sync_divergence",
            taskId: node.id,
            message: `graph.dependencies declares ${depId} -> ${node.id} but node.dependencies does not list it`,
            severity: "warning"
          });
        }
      }
    }

    // B-009 (CF-12): duplicate children corrupt integration fan-in.
    if (new Set(node.childrenIds).size !== node.childrenIds.length) {
      issues.push({
        code: "duplicate_child",
        taskId: node.id,
        message: `node ${node.id} lists duplicate childrenIds`,
        severity: "error"
      });
    }

    // B-009 (CF-12): depth must be exactly parent.depth + 1.
    if (node.parentId !== null) {
      const parent = graph.nodes[node.parentId];
      if (parent !== undefined && node.depth !== parent.depth + 1) {
        issues.push({
          code: "invalid_depth",
          taskId: node.id,
          message: `node ${node.id} has depth ${node.depth}; expected ${parent.depth + 1} (parent ${parent.id} is at ${parent.depth})`,
          severity: "error"
        });
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

export function validateExecutableTaskGraph(
  graphInput: TaskGraph,
  options: TaskGraphValidationOptions = {}
): TaskValidationIssue[] {
  // B-009 (CF-13): for an EXECUTABLE graph, canonical/shortcut divergence is
  // not advisory — scheduling and readiness would disagree with prompts/UI.
  const issues = validateTaskGraph(graphInput, options).map((issue) =>
    issue.code === "dependency_sync_divergence" ? { ...issue, severity: "error" as const } : issue
  );
  const parsed = TaskGraphSchema.safeParse(graphInput);
  if (!parsed.success) {
    return issues;
  }
  const graph = parsed.data as TaskGraph;
  const producedByInterfaceId = new Map<string, string[]>();
  const consumedInterfaces: Array<{ id: string; taskId: string }> = [];

  for (const node of Object.values(graph.nodes)) {
    if (node.kind !== "leaf") {
      continue;
    }

    if (node.contract === undefined) {
      issues.push({
        code: "leaf_without_contract",
        taskId: node.id,
        message: `leaf node ${node.id} has no executable AgentTaskContract`,
        severity: "error"
      });
      continue;
    }

    const validation = validateAgentTaskContractBoundary(node.contract, {
      taskId: node.id,
      executable: true
    });
    for (const issue of validation.issues) {
      issues.push({
        code: taskIssueCodeForContractIssue(issue.code),
        taskId: issue.taskId ?? node.id,
        message: issue.message,
        severity: issue.severity === "error" ? "error" : "warning"
      });
    }
    if (!validation.ok) {
      continue;
    }

    for (const produced of validation.contract.producedInterfaces ?? []) {
      const producers = producedByInterfaceId.get(produced.id) ?? [];
      producers.push(node.id);
      producedByInterfaceId.set(produced.id, producers);
    }
    for (const consumed of validation.contract.consumedInterfaces ?? []) {
      consumedInterfaces.push({ id: consumed.id, taskId: node.id });
    }
  }

  for (const [interfaceId, producers] of producedByInterfaceId) {
    if (producers.length > 1) {
      for (const taskId of producers) {
        issues.push({
          code: "duplicate_produced_interface",
          taskId,
          message: `interface "${interfaceId}" is produced by multiple tasks: ${producers.join(", ")}`,
          severity: "error"
        });
      }
    }
  }

  for (const consumed of consumedInterfaces) {
    if (!producedByInterfaceId.has(consumed.id)) {
      issues.push({
        code: "orphan_consumed_interface",
        taskId: consumed.taskId,
        message: `interface "${consumed.id}" is consumed by ${consumed.taskId} but no leaf produces it`,
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

  if (!node || (node.kind !== "leaf" && node.kind !== "integrator")) {
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

  if (node.kind === "leaf" || node.kind === "integrator") {
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

// ---------------------------------------------------------------------------
// Public helpers: graph queries & dependency management
// ---------------------------------------------------------------------------

export function getRootNode(graph: TaskGraph): TaskNode | undefined {
  return graph.nodes[graph.rootId];
}

export function getExecutableNodes(graph: TaskGraph): TaskNode[] {
  return Object.values(graph.nodes).filter(
    (node) => node.kind === "leaf" || node.kind === "integrator"
  );
}

export function addDependency(
  graph: TaskGraph,
  dep: TaskDependency
): TaskGraph {
  const target = graph.nodes[dep.toTaskId];
  if (!target) return graph;

  const alreadyExists = graph.dependencies.some(
    (d) => d.fromTaskId === dep.fromTaskId && d.toTaskId === dep.toTaskId
  );
  if (alreadyExists) return graph;

  graph.dependencies.push(dep);

  if (!target.dependencies.includes(dep.fromTaskId)) {
    target.dependencies.push(dep.fromTaskId);
  }

  return graph;
}

export function removeDependency(
  graph: TaskGraph,
  fromTaskId: string,
  toTaskId: string
): TaskGraph {
  graph.dependencies = graph.dependencies.filter(
    (d) => !(d.fromTaskId === fromTaskId && d.toTaskId === toTaskId)
  );

  const target = graph.nodes[toTaskId];
  if (target) {
    target.dependencies = target.dependencies.filter((id) => id !== fromTaskId);
  }

  return graph;
}

export function syncNodeDependencies(graph: TaskGraph): void {
  const incoming = buildIncomingDependencyIndex(graph);

  for (const node of Object.values(graph.nodes)) {
    node.dependencies = incoming.get(node.id) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildIncomingDependencyIndex(graph: TaskGraph): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const dep of graph.dependencies) {
    const list = index.get(dep.toTaskId) ?? [];
    list.push(dep.fromTaskId);
    index.set(dep.toTaskId, list);
  }

  return index;
}

function taskIssueCodeForContractIssue(
  code: ReturnType<typeof validateAgentTaskContractBoundary>["issues"][number]["code"]
): TaskValidationIssueCode {
  switch (code) {
    case "schema_invalid":
      return "contract_invalid";
    case "task_id_mismatch":
      return "contract_task_id_mismatch";
    case "unsafe_path":
    case "invalid_interface_id":
    case "duplicate_interface_id":
      return "unsafe_contract_path";
    case "missing_execution_scope":
      return "empty_scope";
    case "missing_expected_changed_files":
      return "missing_expected_output";
  }
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

// ─── Selective re-decomposition: subtree grafting ───────────────────────────

export interface GraftSubtreeParams {
  graph: TaskGraph;
  /** The node whose subtree is being replanned. Must not be the root. */
  taskId: string;
  /** Freshly decomposed plan for that node; its root maps onto `taskId`. */
  replacement: TaskGraph;
  /** Monotonic replan revision; namespaces the new child ids. */
  revision: number;
}

export interface GraftSubtreeResult {
  graph: TaskGraph;
  /** New node ids introduced by the replacement subtree (sorted). */
  addedTaskIds: string[];
  /** Previous descendants of the target that were discarded (sorted). */
  removedTaskIds: string[];
}

/**
 * Graft a replanned subtree into an existing graph without discarding the rest
 * of the DAG. The target node keeps its identity (id, parent, title, goal) so
 * every external edge stays meaningful; its previous descendants are removed,
 * boundary edges that pointed at them are re-pointed at the target, and the
 * replacement's nodes are adopted under revision-namespaced ids. The result is
 * validated — an invalid graft throws instead of corrupting the plan.
 */
export function graftSubtree(params: GraftSubtreeParams): GraftSubtreeResult {
  const { graph, taskId, replacement, revision } = params;
  const target = graph.nodes[taskId];
  if (target === undefined) {
    throw new Error(`graftSubtree: task "${taskId}" is not in the graph.`);
  }
  if (taskId === graph.rootId) {
    throw new Error("graftSubtree: cannot replan the root node — restart planning instead.");
  }
  const subRoot = replacement.nodes[replacement.rootId];
  if (subRoot === undefined) {
    throw new Error("graftSubtree: replacement graph has no root node.");
  }

  // 1. Previous descendants of the target are discarded.
  const removed = new Set<string>();
  const stack = [...target.childrenIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || removed.has(id)) continue;
    removed.add(id);
    stack.push(...(graph.nodes[id]?.childrenIds ?? []));
  }

  // 2. Replacement ids are namespaced by revision; its root maps onto the target.
  const mapId = (id: string): string =>
    id === replacement.rootId ? taskId : `${taskId}-r${revision}-${id}`;

  // 3. Surviving nodes, with boundary deps re-pointed from removed descendants
  //    to the grafted target.
  const nodes: Record<string, TaskNode> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (id === taskId || removed.has(id)) continue;
    const repointed = node.dependencies.map((dep) => (removed.has(dep) ? taskId : dep));
    nodes[id] = { ...node, dependencies: [...new Set(repointed)].filter((dep) => dep !== id) };
  }

  // 4. Adopt the replacement subtree.
  const isAtomic = subRoot.childrenIds.length === 0;
  for (const [id, node] of Object.entries(replacement.nodes)) {
    if (id === replacement.rootId) {
      nodes[taskId] = {
        id: taskId,
        parentId: target.parentId,
        kind: isAtomic ? "leaf" : "composite",
        title: target.title,
        goal: target.goal,
        status: "planned",
        granularity: target.granularity,
        depth: target.depth,
        childrenIds: subRoot.childrenIds.map(mapId),
        dependencies: [...new Set(target.dependencies.filter((dep) => !removed.has(dep) && dep !== taskId))],
        ...(subRoot.contract !== undefined ? { contract: { ...subRoot.contract, taskId } } : {}),
        ...(subRoot.acceptanceCriteria !== undefined ? { acceptanceCriteria: subRoot.acceptanceCriteria } : {}),
        ...(subRoot.prompt !== undefined ? { prompt: subRoot.prompt } : {}),
        metadata: { ...(target.metadata ?? {}), replanRevision: revision }
      };
      continue;
    }
    const newId = mapId(id);
    nodes[newId] = {
      ...node,
      id: newId,
      parentId: mapId(node.parentId ?? replacement.rootId),
      depth: target.depth + node.depth,
      status: "planned",
      childrenIds: node.childrenIds.map(mapId),
      dependencies: node.dependencies.map(mapId),
      ...(node.contract !== undefined
        ? {
            contract: {
              ...node.contract,
              taskId: newId,
              dependencies: node.contract.dependencies.map(mapId)
            }
          }
        : {})
    };
  }

  // 5. Rebuild the canonical edge list: survivors (re-pointed), boundary edges
  //    touching the target, and the replacement's internal edges (remapped).
  const edges = new Map<string, TaskDependency>();
  const addEdge = (edge: TaskDependency): void => {
    if (edge.fromTaskId === edge.toTaskId) return;
    edges.set(`${edge.fromTaskId}->${edge.toTaskId}`, edge);
  };
  for (const edge of graph.dependencies) {
    addEdge({
      ...edge,
      fromTaskId: removed.has(edge.fromTaskId) ? taskId : edge.fromTaskId,
      toTaskId: removed.has(edge.toTaskId) ? taskId : edge.toTaskId
    });
  }
  for (const edge of replacement.dependencies) {
    addEdge({ ...edge, fromTaskId: mapId(edge.fromTaskId), toTaskId: mapId(edge.toTaskId) });
  }

  const grafted: TaskGraph = { ...graph, nodes, dependencies: [...edges.values()] };

  const errors = validateTaskGraph(grafted).filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `graftSubtree produced an invalid graph: ${errors.map((issue) => issue.message).join("; ")}`
    );
  }

  return {
    graph: grafted,
    addedTaskIds: Object.keys(replacement.nodes)
      .filter((id) => id !== replacement.rootId)
      .map(mapId)
      .sort(),
    removedTaskIds: [...removed].sort()
  };
}
