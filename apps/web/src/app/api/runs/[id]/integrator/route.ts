import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { AgentTaskContract, RunSnapshot, TaskNode } from "@manyhands/core";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const IntegratorRequestSchema = z.object({
  taskIds: z.array(z.string().trim().min(1)).min(2),
  reason: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(160).optional()
}).strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = IntegratorRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid integrator request");
    }

    const taskIds = [...new Set(parsed.data.taskIds)];
    if (taskIds.length !== parsed.data.taskIds.length) {
      throw new RunValidationError("Integrator taskIds must be unique");
    }

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
    const title = parsed.data.title ?? "Integration task";
    const objective = `${parsed.data.reason} Integrate outputs from ${taskIds.join(", ")}.`;
    const contract = buildIntegratorContract({
      taskId,
      objective,
      taskIds,
      snapshot: currentSnapshot
    });
    const node: TaskNode = {
      id: taskId,
      parentId,
      kind: "leaf",
      title,
      intent: objective,
      status: "planned",
      granularity: "fine",
      depth: parent.depth + 1,
      childrenIds: [],
      contract,
      metadata: {
        authoredBy: "human",
        integrator: true,
        integratesTaskIds: taskIds,
        integrationReason: parsed.data.reason
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
        rationale: parsed.data.reason
      }))
    });
    const saved = await persistRunPatches({ run, baseSnapshot, patches: [patch] });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
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
