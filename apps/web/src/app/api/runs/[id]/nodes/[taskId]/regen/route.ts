import { NextResponse } from "next/server";
import { z } from "zod";
import {
  runMockPlanningFlow,
  type AgentTaskContract,
  type FeatureRequest,
  type MockPlanningFlowResult,
  type RunSnapshot,
  type TaskDependency,
  type TaskGraph,
  type TaskNode
} from "@manyhands/core";
import { pickDecomposer } from "@/lib/decomposer-policy";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTaskExists,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { getWorkspaceRepository } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotGraph = RunSnapshot["graphSnapshot"];
type SnapshotNode = SnapshotGraph["nodes"][string];

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

const RegenRequestSchema = z.object({
  granularity: z.union([z.literal("coarse"), z.literal("balanced"), z.literal("fine")]).optional()
}).strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, taskId } = await context.params;
  let payload: unknown = {};
  try {
    const text = await request.text();
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = RegenRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid regen request");
    }

    const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
    assertTaskExists(currentSnapshot, taskId);
    const node = currentSnapshot.graphSnapshot.nodes[taskId]!;
    const contract = currentSnapshot.contracts.find((entry) => entry.taskId === taskId) ?? node.contract;
    const runGranularity = run.granularity === "auto" ? "balanced" : run.granularity;
    const mode = parsed.data.granularity ?? runGranularity;
    const feature = buildFeatureRequest({
      taskId,
      node,
      snapshot: currentSnapshot,
      ...(contract !== undefined ? { contract } : {})
    });
    const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
    const planning = await runRegenerationPlanning({
      runId: run.runId,
      taskId,
      mode,
      feature,
      userPrompt: run.userPrompt,
      model: run.model,
      workspace: workspace ?? undefined
    });
    const graft = buildSubtreeGraft({
      snapshot: currentSnapshot,
      taskId,
      generatedGraph: planning.decomposition.graph,
      generatedContracts: planning.decomposition.contracts
    });

    const patch = buildPatch("SUBTREE_REGENERATED", {
      taskId,
      granularity: mode,
      removedTaskIds: graft.removedTaskIds,
      nodes: graft.nodes,
      dependencies: graft.dependencies,
      contracts: graft.contracts
    });
    const saved = await persistRunPatches({ run, baseSnapshot, patches: [patch], expectedVersion: run.version });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

async function runRegenerationPlanning(input: {
  runId: string;
  taskId: string;
  mode: "coarse" | "balanced" | "fine";
  feature: FeatureRequest;
  userPrompt: string;
  model: string;
  workspace?: Parameters<typeof pickDecomposer>[0]["workspace"];
}): Promise<MockPlanningFlowResult> {
  const selection = pickDecomposer({
    userPrompt: `${input.userPrompt}\n\nRegenerate subtree ${input.taskId}: ${input.feature.description}`,
    model: input.model,
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {})
  });
  if (selection.provider === "deterministic" && selection.fallbackReason !== "forced_by_env") {
    throw new RunValidationError("Subtree regeneration requires a configured LLM decomposer.");
  }
  const baseOptions = {
    feature: input.feature,
    mode: input.mode,
    schedulerPolicy: "risk_aware" as const,
    runLabel: `${input.runId}:${input.taskId}:regen`
  };

  return runMockPlanningFlow({
    ...baseOptions,
    decomposer: selection.decomposer
  });
}

function buildFeatureRequest(input: {
  taskId: string;
  node: SnapshotNode;
  contract?: AgentTaskContract;
  snapshot: RunSnapshot;
}): FeatureRequest {
  const acceptanceCriteria = input.contract?.acceptance.map((entry) => entry.description) ?? [];
  return {
    id: `regen-${safeId(input.taskId)}`,
    title: `Regenerate ${input.node.title}`,
    description: input.contract?.objective ?? input.node.goal,
    repositoryPath: input.snapshot.graphSnapshot.repo,
    targetStack: [],
    constraints: [
      `Preserve the external task id ${input.taskId}.`,
      ...(input.contract?.knownRisks ?? [])
    ],
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : [input.node.goal]
  };
}

function buildSubtreeGraft(input: {
  snapshot: RunSnapshot;
  taskId: string;
  generatedGraph: TaskGraph;
  generatedContracts: readonly AgentTaskContract[];
}): {
  removedTaskIds: string[];
  nodes: Record<string, TaskNode>;
  dependencies: TaskDependency[];
  contracts: AgentTaskContract[];
} {
  const oldRoot = input.snapshot.graphSnapshot.nodes[input.taskId];
  const generatedRoot = input.generatedGraph.nodes[input.generatedGraph.rootId];
  if (oldRoot === undefined || generatedRoot === undefined) {
    throw new RunLifecycleError("Cannot build regenerated subtree graft");
  }

  const removedTaskIds = collectSubtreeTaskIds(input.snapshot.graphSnapshot, input.taskId);
  const removed = new Set(removedTaskIds);
  const idMap = new Map<string, string>();
  for (const oldId of Object.keys(input.generatedGraph.nodes)) {
    idMap.set(oldId, oldId === input.generatedGraph.rootId ? input.taskId : `${input.taskId}:${safeId(oldId)}`);
  }

  const contractsByOldId = new Map(input.generatedContracts.map((contract) => [contract.taskId, contract]));
  const nodes: Record<string, TaskNode> = {};
  for (const generated of Object.values(input.generatedGraph.nodes)) {
    const nextId = idMap.get(generated.id);
    if (nextId === undefined) {
      throw new RunLifecycleError(`Generated task ${generated.id} was not mapped`);
    }
    const nextParentId = generated.parentId === null
      ? oldRoot.parentId
      : idMap.get(generated.parentId) ?? oldRoot.parentId;
    const remappedContract = contractsByOldId.has(generated.id)
      ? remapContract(contractsByOldId.get(generated.id)!, idMap)
      : undefined;
    const node: TaskNode = {
      ...generated,
      id: nextId,
      parentId: nextParentId,
      depth: oldRoot.depth + generated.depth,
      childrenIds: generated.childrenIds.map((childId) => idMap.get(childId) ?? childId),
      // B-009 (CF-13): the shortcut must be remapped exactly like the
      // canonical edges — the old code left stale pre-remap ids here.
      dependencies: generated.dependencies.map((depId) => idMap.get(depId) ?? depId),
      metadata: {
        ...(generated.metadata ?? {}),
        authoredBy: "ai",
        regeneratedFromTaskId: input.taskId
      }
    };
    if (remappedContract !== undefined) {
      node.contract = remappedContract;
    } else {
      delete node.contract;
    }
    nodes[nextId] = node;
  }

  const contracts = input.generatedContracts.map((contract) => remapContract(contract, idMap));
  const dependencies = uniqueDependencies([
    ...input.generatedGraph.dependencies.map((dependency) => remapDependency(dependency, idMap)),
    ...boundaryDependencies(input.snapshot.graphSnapshot, removed, input.taskId)
  ]);

  return { removedTaskIds, nodes, dependencies, contracts };
}

function collectSubtreeTaskIds(graph: SnapshotGraph, taskId: string): string[] {
  const result: string[] = [];
  const visit = (id: string): void => {
    result.push(id);
    for (const childId of graph.nodes[id]?.childrenIds ?? []) {
      visit(childId);
    }
  };
  visit(taskId);
  return result;
}

function boundaryDependencies(graph: SnapshotGraph, removed: ReadonlySet<string>, replacementTaskId: string): TaskDependency[] {
  return graph.dependencies.flatMap((dependency) => {
    const fromRemoved = removed.has(dependency.fromTaskId);
    const toRemoved = removed.has(dependency.toTaskId);
    if (fromRemoved === toRemoved) {
      return [];
    }
    const next: TaskDependency = {
      ...dependency,
      fromTaskId: fromRemoved ? replacementTaskId : dependency.fromTaskId,
      toTaskId: toRemoved ? replacementTaskId : dependency.toTaskId
    };
    return next.fromTaskId === next.toTaskId ? [] : [next];
  });
}

function remapDependency(dependency: TaskDependency, idMap: ReadonlyMap<string, string>): TaskDependency {
  return {
    ...dependency,
    fromTaskId: idMap.get(dependency.fromTaskId) ?? dependency.fromTaskId,
    toTaskId: idMap.get(dependency.toTaskId) ?? dependency.toTaskId
  };
}

function remapContract(contract: AgentTaskContract, idMap: ReadonlyMap<string, string>): AgentTaskContract {
  return {
    ...contract,
    taskId: idMap.get(contract.taskId) ?? contract.taskId,
    dependencies: contract.dependencies.map((taskId) => idMap.get(taskId) ?? taskId)
  };
}

function uniqueDependencies(dependencies: readonly TaskDependency[]): TaskDependency[] {
  const seen = new Set<string>();
  const result: TaskDependency[] = [];
  for (const dependency of dependencies) {
    const key = `${dependency.fromTaskId}->${dependency.toTaskId}`;
    if (seen.has(key) || dependency.fromTaskId === dependency.toTaskId) {
      continue;
    }
    seen.add(key);
    result.push(dependency);
  }
  return result;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/g, "-");
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
