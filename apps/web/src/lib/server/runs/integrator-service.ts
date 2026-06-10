import { randomUUID } from "node:crypto";
import type { AgentTaskContract, RunSnapshot, TaskNode } from "@manyhands/core";
import {
  RunLifecycleError,
  assertTaskExists,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches
} from "@/lib/server/runs";
import type { RunRecord } from "@/lib/server/runs/schema";

export async function createIntegratorTask(input: {
  id: string;
  taskIds: string[];
  reason: string;
  title?: string;
}): Promise<RunRecord> {
  const { id, taskIds, reason, title: inputTitle } = input;
  const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
  
  for (const taskId of taskIds) {
    assertTaskExists(currentSnapshot, taskId);
  }

  const parentId = findLowestCommonCompositeAncestor(currentSnapshot, taskIds);
  const parent = currentSnapshot.graphSnapshot.nodes[parentId];
  if (parent === undefined) {
    throw new RunLifecycleError(`Integrator parent ${parentId} does not exist`);
  }

  const taskId = `integrator-${randomUUID()}`;
  const title = inputTitle ?? "Integration task";
  const objective = `${reason} Integrate outputs from ${taskIds.join(", ")}.`;
  const contract = buildIntegratorContract({
    taskId,
    objective,
    taskIds,
    snapshot: currentSnapshot
  });
  const node: TaskNode = {
    id: taskId,
    parentId,
    kind: "integrator",
    title,
    goal: objective,
    status: "planned",
    granularity: "fine",
    depth: parent.depth + 1,
    childrenIds: [],
    dependencies: [],
    contract,
    metadata: {
      authoredBy: "human",
      integrator: true,
      integratesTaskIds: taskIds,
      integrationReason: reason
    }
  };

  const patch = buildPatch("INTEGRATOR_NODE_CREATED", {
    taskId,
    node,
    contract,
    dependencies: taskIds.map((sourceTaskId) => ({
      fromTaskId: sourceTaskId,
      toTaskId: taskId,
      type: "logical",
      inferred: false,
      rationale: reason
    }))
  });
  
  return persistRunPatches({ run, baseSnapshot, patches: [patch] });
}

function findLowestCommonCompositeAncestor(snapshot: RunSnapshot, taskIds: readonly string[]): string {
  const ancestorChains = taskIds.map((taskId) => ancestorsFor(snapshot, taskId));
  const firstChain = ancestorChains[0] ?? [];
  for (const candidate of firstChain) {
    const node = snapshot.graphSnapshot.nodes[candidate];
    if (node?.kind !== "composite") {
      continue;
    }
    if (ancestorChains.every((chain) => chain.includes(candidate))) {
      return candidate;
    }
  }
  return snapshot.graphSnapshot.rootId;
}

function ancestorsFor(snapshot: RunSnapshot, taskId: string): string[] {
  const ancestors: string[] = [];
  let currentId: string | null = taskId;
  while (currentId !== null) {
    ancestors.push(currentId);
    currentId = snapshot.graphSnapshot.nodes[currentId]?.parentId ?? null;
  }
  return ancestors;
}

function buildIntegratorContract(input: {
  taskId: string;
  objective: string;
  taskIds: readonly string[];
  snapshot: RunSnapshot;
}): AgentTaskContract {
  const contracts = input.taskIds
    .map((taskId) =>
      input.snapshot.contracts.find((contract) => contract.taskId === taskId) ??
      input.snapshot.graphSnapshot.nodes[taskId]?.contract
    )
    .filter((contract): contract is AgentTaskContract => contract !== undefined);
  const allowedPaths = uniqueStrings(contracts.flatMap((contract) => contract.allowed.paths));
  const forbiddenPaths = uniqueStrings(contracts.flatMap((contract) => contract.forbidden.paths));
  const changedFiles = uniqueStrings(contracts.flatMap((contract) => contract.expectedOutput.changedFiles));
  const acceptance = `Integration notes reconcile ${input.taskIds.join(", ")} and call out any residual risk.`;

  return {
    taskId: input.taskId,
    objective: input.objective,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: input.taskIds.map((taskId) => `Task ${taskId} output`)
    },
    allowed: {
      paths: allowedPaths.length > 0 ? allowedPaths : ["**/*"]
    },
    forbidden: {
      paths: forbiddenPaths
    },
    relevantSymbols: uniqueStrings(contracts.flatMap((contract) => contract.relevantSymbols)),
    dependencies: [...input.taskIds],
    acceptance: [
      {
        kind: "custom",
        description: acceptance
      }
    ],
    validationCommands: [],
    expectedOutput: {
      changedFiles: changedFiles.length > 0 ? changedFiles : [`manyhands/integration/${input.taskId}.md`],
      producedSymbols: [],
      consumedSymbols: uniqueStrings(contracts.flatMap((contract) => contract.expectedOutput.producedSymbols))
    },
    limits: {
      maxDurationMs: 15 * 60 * 1000,
      maxCostUsd: 0
    },
    knownRisks: uniqueStrings(contracts.flatMap((contract) => contract.knownRisks)),
    definitionOfDone: acceptance
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0);
}
