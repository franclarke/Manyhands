import { z } from "zod";
import {
  AgentTaskContractSchema,
  type AcceptanceCriterion,
  type AgentTaskContract,
  TaskDependencySchema,
  TaskNodeSchema,
  type TaskDependency
} from "@manyhands/core";
import type { MockExecutionFlowResult, MockPlanningFlowResult, RunSnapshot } from "@manyhands/core";
import { EXECUTOR_IDS } from "@manyhands/execution-core";
import { addDependency, removeDependency, syncNodeDependencies, type TaskGraph } from "@manyhands/task-graph";
import type { RunRecord } from "./schema";

const PatchActorSchema = z.union([z.literal("human"), z.literal("system")]);

const PatchBaseSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  actor: PatchActorSchema
});

export const RunPatchSchema = z.discriminatedUnion("type", [
  PatchBaseSchema.extend({
    type: z.literal("NODE_RENAMED"),
    taskId: z.string().min(1),
    title: z.string().min(1).max(160)
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_OBJECTIVE_EDITED"),
    taskId: z.string().min(1),
    objective: z.string().min(1).max(4000)
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_PATHS_EDITED"),
    taskId: z.string().min(1),
    allowedPaths: z.array(z.string().min(1)),
    forbiddenPaths: z.array(z.string().min(1))
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_ACCEPTANCE_EDITED"),
    taskId: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1))
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_MARKED_MANUAL"),
    taskId: z.string().min(1),
    manual: z.boolean()
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_EXECUTOR_EDITED"),
    taskId: z.string().min(1),
    executorOverride: z
      .object({
        executorId: z.enum(EXECUTOR_IDS),
        model: z.string().min(1)
      })
      .nullable()
  }),
  PatchBaseSchema.extend({
    type: z.literal("NODE_EXECUTOR_SELECTION_EDITED"),
    taskId: z.string().min(1),
    executorSelection: z
      .object({
        executorId: z.enum(EXECUTOR_IDS),
        model: z.string().min(1)
      })
      .nullable()
  }),
  PatchBaseSchema.extend({
    type: z.literal("SUBTREE_REGENERATED"),
    taskId: z.string().min(1),
    granularity: z.union([z.literal("coarse"), z.literal("balanced"), z.literal("fine")]).optional(),
    removedTaskIds: z.array(z.string().min(1)),
    nodes: z.record(TaskNodeSchema),
    dependencies: z.array(TaskDependencySchema),
    contracts: z.array(AgentTaskContractSchema)
  }),
  PatchBaseSchema.extend({
    type: z.literal("INTEGRATOR_NODE_CREATED"),
    taskId: z.string().min(1),
    node: TaskNodeSchema,
    contract: AgentTaskContractSchema.optional(),
    dependencies: z.array(TaskDependencySchema).default([])
  }),
  PatchBaseSchema.extend({
    type: z.literal("TASKS_SERIALIZED"),
    fromTaskId: z.string().min(1),
    toTaskId: z.string().min(1),
    rationale: z.string().min(1).max(1000).optional()
  }),
  PatchBaseSchema.extend({
    type: z.literal("DEPENDENCY_REMOVED"),
    fromTaskId: z.string().min(1),
    toTaskId: z.string().min(1),
    rationale: z.string().min(1).max(1000).optional()
  }),
  PatchBaseSchema.extend({
    type: z.literal("RISK_ACKNOWLEDGED"),
    taskIds: z.tuple([z.string().min(1), z.string().min(1)]),
    reason: z.string().min(1).max(1000)
  })
]);

export type RunPatch = z.infer<typeof RunPatchSchema>;

type PatchableInput = RunSnapshot | RunRecord;

interface PatchContext {
  graph: PatchGraph;
  contracts: AgentTaskContract[];
  riskPredictions?: Array<Record<string, unknown>>;
}

interface PatchGraph {
  nodes: Record<string, PatchTaskNode>;
  dependencies: TaskDependency[];
  [key: string]: unknown;
}

interface PatchTaskNode {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  goal: string;
  status: string;
  granularity: string;
  depth: number;
  childrenIds: string[];
  contract?: AgentTaskContract | undefined;
  metadata?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export function parseRunPatches(patches: readonly unknown[] | undefined): RunPatch[] {
  return (patches ?? []).map((patch) => RunPatchSchema.parse(patch));
}

export function appendPatch(run: RunRecord, patch: RunPatch): RunRecord {
  const parsed = RunPatchSchema.parse(patch);
  return {
    ...run,
    patches: [...(run.patches ?? []), parsed]
  };
}

export function applyPatches<T extends PatchableInput>(snapshotOrRun: T, patches: readonly unknown[]): T {
  return applyPatchesUpTo(snapshotOrRun, patches);
}

export function applyPatchesUpTo<T extends PatchableInput>(
  snapshotOrRun: T,
  patches: readonly unknown[],
  until?: number | string
): T {
  const parsed = selectPatches(parseRunPatches(patches), until);
  const clone = structuredClone(snapshotOrRun) as T;

  if (isRunSnapshot(clone)) {
    applyParsedPatchesToContext({
      graph: clone.graphSnapshot as PatchGraph,
      contracts: clone.contracts,
      riskPredictions: clone.riskPredictions as Array<Record<string, unknown>>
    }, parsed);
    return clone;
  }

  const planning = clone.planning as MockPlanningFlowResult | undefined;
  if (planning !== undefined) {
    applyParsedPatchesToContext(
      {
        graph: planning.decomposition.graph as PatchGraph,
        contracts: planning.decomposition.contracts,
        riskPredictions: planning.riskMatrix as Array<Record<string, unknown>>
      },
      parsed
    );
  }

  const execution = clone.execution as MockExecutionFlowResult | undefined;
  if (execution?.planning !== undefined) {
    applyParsedPatchesToContext(
      {
        graph: execution.planning.decomposition.graph as PatchGraph,
        contracts: execution.planning.decomposition.contracts,
        riskPredictions: execution.planning.riskMatrix as Array<Record<string, unknown>>
      },
      parsed
    );
  }
  if (execution?.snapshot !== undefined) {
    applyParsedPatchesToContext(
      {
        graph: execution.snapshot.graphSnapshot as PatchGraph,
        contracts: execution.snapshot.contracts,
        riskPredictions: execution.snapshot.riskPredictions as Array<Record<string, unknown>>
      },
      parsed
    );
  }

  return clone;
}

function selectPatches(patches: RunPatch[], until?: number | string): RunPatch[] {
  if (until === undefined) {
    return patches;
  }
  if (typeof until === "number") {
    return patches.slice(0, Math.max(0, until));
  }
  const index = patches.findIndex((patch) => patch.id === until);
  if (index === -1) {
    throw new Error(`Patch ${until} was not found`);
  }
  return patches.slice(0, index + 1);
}

function applyParsedPatchesToContext(context: PatchContext, patches: readonly RunPatch[]): void {
  for (const patch of patches) {
    applyPatchToContext(context, patch);
  }
}

function applyPatchToContext(context: PatchContext, patch: RunPatch): void {
  switch (patch.type) {
    case "NODE_RENAMED":
      updateNode(context, patch.taskId, (node) => ({ ...node, title: patch.title }));
      return;
    case "NODE_OBJECTIVE_EDITED":
      updateNode(context, patch.taskId, (node) => {
        const next = { ...node, goal: patch.objective };
        if (node.contract !== undefined) {
          next.contract = { ...node.contract, objective: patch.objective };
        }
        return next;
      });
      updateContract(context, patch.taskId, (contract) => ({ ...contract, objective: patch.objective }));
      return;
    case "NODE_PATHS_EDITED":
      updateContractRequired(context, patch.taskId, (contract) => ({
        ...contract,
        allowed: { ...contract.allowed, paths: [...patch.allowedPaths] },
        forbidden: { ...contract.forbidden, paths: [...patch.forbiddenPaths] }
      }));
      return;
    case "NODE_ACCEPTANCE_EDITED":
      updateContractRequired(context, patch.taskId, (contract) => ({
        ...contract,
        acceptance: toAcceptanceCriteria(patch.acceptanceCriteria)
      }));
      return;
    case "NODE_MARKED_MANUAL":
      updateNode(context, patch.taskId, (node) => ({
        ...node,
        metadata: {
          ...(node.metadata ?? {}),
          authoredBy: patch.manual ? "human" : "ai"
        }
      }));
      return;
    case "NODE_EXECUTOR_EDITED":
      updateNode(context, patch.taskId, (node) => {
        const metadata = { ...(node.metadata ?? {}) };
        if (patch.executorOverride === null) {
          delete metadata.executorOverride;
        } else {
          metadata.executorOverride = patch.executorOverride;
        }
        return { ...node, metadata };
      });
      return;
    case "NODE_EXECUTOR_SELECTION_EDITED":
      updateNode(context, patch.taskId, (node) => {
        const metadata = { ...(node.metadata ?? {}) };
        delete metadata.executorOverride;
        if (patch.executorSelection === null) {
          delete metadata.executorSelection;
        } else {
          metadata.executorSelection = patch.executorSelection;
        }
        return { ...node, metadata };
      });
      return;
    case "SUBTREE_REGENERATED":
      applySubtreeRegenerated(context, patch);
      return;
    case "INTEGRATOR_NODE_CREATED":
      context.graph.nodes[patch.node.id] = patch.node as PatchTaskNode;
      attachNodeToParent(context, patch.node.id, patch.node.parentId);
      if (patch.contract !== undefined) {
        upsertContract(context, patch.contract);
        context.graph.nodes[patch.node.id] = {
          ...context.graph.nodes[patch.node.id]!,
          contract: patch.contract
        };
      }
      for (const dependency of patch.dependencies) {
        addGraphDependency(context, dependency);
      }
      syncGraphDependencies(context);
      return;
    case "TASKS_SERIALIZED":
      addGraphDependency(context, {
        fromTaskId: patch.fromTaskId,
        toTaskId: patch.toTaskId,
        type: "logical",
        inferred: false,
        ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {})
      });
      syncGraphDependencies(context);
      return;
    case "DEPENDENCY_REMOVED":
      removeGraphDependency(context, patch.fromTaskId, patch.toTaskId);
      syncGraphDependencies(context);
      return;
    case "RISK_ACKNOWLEDGED":
      applyRiskAcknowledged(context, patch);
      return;
  }
}

function applySubtreeRegenerated(
  context: PatchContext,
  patch: Extract<RunPatch, { type: "SUBTREE_REGENERATED" }>
): void {
  const removed = new Set(patch.removedTaskIds);
  for (const taskId of removed) {
    delete context.graph.nodes[taskId];
  }
  for (const node of Object.values(context.graph.nodes)) {
    node.childrenIds = node.childrenIds.filter((childId) => !removed.has(childId));
  }
  context.graph.dependencies = context.graph.dependencies.filter(
    (dependency) => !removed.has(dependency.fromTaskId) && !removed.has(dependency.toTaskId)
  );
  context.contracts = context.contracts.filter((contract) => !removed.has(contract.taskId));

  for (const node of Object.values(patch.nodes)) {
    context.graph.nodes[node.id] = node as PatchTaskNode;
  }
  for (const node of Object.values(patch.nodes)) {
    attachNodeToParent(context, node.id, node.parentId);
  }
  for (const dependency of patch.dependencies) {
    addGraphDependency(context, dependency);
  }
  for (const contract of patch.contracts) {
    upsertContract(context, contract);
    const node = context.graph.nodes[contract.taskId];
    if (node !== undefined) {
      context.graph.nodes[contract.taskId] = { ...node, contract };
    }
  }
  syncGraphDependencies(context);
}

function addGraphDependency(context: PatchContext, dependency: TaskDependency): void {
  addDependency(context.graph as unknown as TaskGraph, dependency);
}

function removeGraphDependency(context: PatchContext, fromTaskId: string, toTaskId: string): void {
  removeDependency(context.graph as unknown as TaskGraph, fromTaskId, toTaskId);
}

function syncGraphDependencies(context: PatchContext): void {
  syncNodeDependencies(context.graph as unknown as TaskGraph);
}

function attachNodeToParent(context: PatchContext, taskId: string, parentId: string | null): void {
  if (parentId === null) {
    return;
  }
  const parent = context.graph.nodes[parentId];
  if (parent === undefined || parent.childrenIds.includes(taskId)) {
    return;
  }
  parent.childrenIds = [...parent.childrenIds, taskId];
}

function applyRiskAcknowledged(
  context: PatchContext,
  patch: Extract<RunPatch, { type: "RISK_ACKNOWLEDGED" }>
): void {
  if (context.riskPredictions === undefined) {
    return;
  }
  const pairKey = canonicalPairKey(patch.taskIds[0], patch.taskIds[1]);
  for (const prediction of context.riskPredictions) {
    const taskAId = typeof prediction.taskAId === "string" ? prediction.taskAId : undefined;
    const taskBId = typeof prediction.taskBId === "string" ? prediction.taskBId : undefined;
    if (taskAId === undefined || taskBId === undefined) {
      continue;
    }
    if (canonicalPairKey(taskAId, taskBId) !== pairKey) {
      continue;
    }
    prediction.acknowledged = true;
    prediction.acknowledgedReason = patch.reason;
    prediction.acknowledgedAt = patch.createdAt;
  }
}

export function canonicalPairKey(taskAId: string, taskBId: string): string {
  return [taskAId, taskBId].sort((left, right) => left.localeCompare(right)).join("::");
}

function updateNode(context: PatchContext, taskId: string, updater: (node: PatchTaskNode) => PatchTaskNode): void {
  const node = context.graph.nodes[taskId];
  if (node === undefined) {
    throw new Error(`Task ${taskId} does not exist`);
  }
  const next = updater(node);
  context.graph.nodes[taskId] = next;
  if (next.contract !== undefined) {
    upsertContract(context, next.contract);
  }
}

function updateContractRequired(
  context: PatchContext,
  taskId: string,
  updater: (contract: AgentTaskContract) => AgentTaskContract
): void {
  updateContract(context, taskId, updater, true);
}

function updateContract(
  context: PatchContext,
  taskId: string,
  updater: (contract: AgentTaskContract) => AgentTaskContract,
  required = false
): void {
  const node = context.graph.nodes[taskId];
  if (node === undefined) {
    throw new Error(`Task ${taskId} does not exist`);
  }
  const contract = node.contract ?? context.contracts.find((entry) => entry.taskId === taskId);
  if (contract === undefined) {
    if (required) {
      throw new Error(`Task ${taskId} does not have an editable contract`);
    }
    return;
  }
  const next = updater(contract);
  context.graph.nodes[taskId] = { ...node, contract: next };
  upsertContract(context, next);
}

function upsertContract(context: PatchContext, contract: AgentTaskContract): void {
  const index = context.contracts.findIndex((entry) => entry.taskId === contract.taskId);
  if (index === -1) {
    context.contracts.push(contract);
    return;
  }
  context.contracts[index] = contract;
}

function toAcceptanceCriteria(descriptions: readonly string[]): AcceptanceCriterion[] {
  return descriptions.map((description) => ({
    kind: "custom",
    description
  }));
}

function isRunSnapshot(value: PatchableInput): value is RunSnapshot {
  return "graphSnapshot" in value;
}
