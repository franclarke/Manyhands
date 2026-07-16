import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type AgentTaskContract,
  type FeatureRequest,
  type MockPlanningFlowResult,
  type RunSnapshot,
  type TaskDependency,
  type TaskGraph,
  type TaskNode
} from "@manyhands/core";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTaskExists,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches
} from "@/lib/server/runs";
import { invokePlanning } from "@/lib/server/runs/planning-invocation-service";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import type { Workspace } from "@/lib/api-types";
import type { RunRecord } from "@/lib/server/runs/schema";
import {
  RunTargetMismatchError,
  resolveRunTargetPath
} from "@/lib/server/runs/target-context";
import { getRunRepository } from "@/lib/server/runs/store";

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
    const targetPath = await resolveRunTargetPath(run);
    const feature = {
      ...buildFeatureRequest({
      taskId,
      node,
      snapshot: currentSnapshot,
      ...(contract !== undefined ? { contract } : {})
      }),
      // The graph's historical repo field is not target authority. Productive
      // local runs always regenerate against the immutable captured target.
      ...(targetPath !== undefined ? { repositoryPath: targetPath } : {})
    };
    const workspaceRecord = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
    const workspace = workspaceRecord !== null && targetPath !== undefined
      ? { ...workspaceRecord, repoPath: targetPath }
      : workspaceRecord;
    const planning = await runRegenerationPlanning({
      run,
      taskId,
      mode,
      feature,
      ...(workspace !== null ? { workspace } : {})
    });
    // A subtree regeneration is another long LLM boundary. Re-read both the
    // record and the physical target before constructing/persisting its patch.
    await resolveRunTargetPath(await getRunRepository().get(id));
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
    return NextResponse.json(await toCanonicalRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

async function runRegenerationPlanning(input: {
  run: RunRecord;
  taskId: string;
  mode: "coarse" | "balanced" | "fine";
  feature: FeatureRequest;
  workspace?: Workspace;
}): Promise<MockPlanningFlowResult> {
  const { planning } = await invokePlanning({
    run: input.run,
    feature: input.feature,
    mode: input.mode,
    runLabel: `${input.run.runId}:${input.taskId}:regen`,
    processLabel: `regen-decomposer:${input.taskId}`,
    userPrompt: `${input.run.userPrompt}\n\nRegenerate subtree ${input.taskId}: ${input.feature.description}`,
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {})
  });
  return planning;
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
    const isGeneratedRoot = generated.id === input.generatedGraph.rootId;
    const graftedKind = isGeneratedRoot
      ? oldRoot.parentId === null
        ? "root"
        : generated.childrenIds.length === 0
          ? "leaf"
          : "composite"
      : generated.kind;
    const node: TaskNode = {
      ...generated,
      id: nextId,
      parentId: nextParentId,
      // A standalone decomposition always has a `root`, but when grafted
      // below the existing root that node becomes the replacement leaf or
      // composite. Preserving kind=root would create an invalid two-root DAG.
      kind: graftedKind,
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
  if (error instanceof RunTargetMismatchError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
