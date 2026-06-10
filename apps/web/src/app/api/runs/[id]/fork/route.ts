/**
 * POST /api/runs/[id]/fork — non-destructive time-travel rollback.
 *
 * When the user rolls back to a previous checkpoint from the canvas/timeline,
 * this endpoint:
 *   1. Reads the checkpoint history for the source run.
 *   2. Clones the state up to the specified checkpoint_id.
 *   3. Creates a new RunRecord with a fresh runId (preserves the original).
 *   4. Returns the new run ID so the frontend can navigate to it.
 *
 * Design: docs/design/langgraph-orchestrator-design.md §6 (Forking)
 * Invariant: Worktrees for the new run will be named mh-{newRunId}-{nodeId}.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunNotFoundError,
  RunValidationError,
  getRunRepository
} from "@/lib/server/runs";
import { JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import { resolveRunsDirectory } from "@/lib/server/runs/repository";
import { join } from "node:path";
import type { RunRecord } from "@/lib/server/runs/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ForkRequestSchema = z.object({
  /** The checkpoint ID to fork from. If omitted, forks from "latest". */
  checkpointId: z.string().min(1).optional()
});

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id: sourceRunId } = await context.params;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const parsed = ForkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fork request" }, { status: 400 });
  }

  try {
    // Fetch the source run to clone metadata
    const sourceRun = await getRunRepository().get(sourceRunId);

    // Read the checkpoint to restore from
    const runsDirectory = resolveRunsDirectory();
    const checkpointsDirectory = join(runsDirectory, "checkpoints");
    const checkpointer = new JsonFileCheckpointSaver(checkpointsDirectory);

    const checkpointConfig = {
      configurable: {
        thread_id: sourceRunId,
        ...(parsed.data.checkpointId !== undefined
          ? { checkpoint_id: parsed.data.checkpointId }
          : {})
      }
    };

    const sourceTuple = await checkpointer.getTuple(checkpointConfig);

    const newRunId = randomUUID();
    const now = new Date().toISOString();

    // Create the forked run record — same parameters, new ID, reset to "created"
    const forkedRun: RunRecord = {
      runId: newRunId,
      workspaceId: sourceRun.workspaceId,
      granularity: sourceRun.granularity,
      model: sourceRun.model,
      userPrompt: sourceRun.userPrompt,
      title: `[Fork] ${sourceRun.title}`,
      status: "created",
      createdAt: now,
      updatedAt: now,
      patches: [],
      ...(sourceRun.planningModel !== undefined ? { planningModel: sourceRun.planningModel } : {}),
      ...(sourceRun.repoSpec !== undefined ? { repoSpec: sourceRun.repoSpec } : {})
    };

    // Persist the new run record
    const savedRun = await getRunRepository().save(forkedRun);

    // If there's a checkpoint to fork from, clone it into the new thread
    if (sourceTuple !== undefined) {
      const { checkpoint } = sourceTuple;
      const forkConfig = {
        configurable: { thread_id: newRunId }
      };
      // Store the cloned checkpoint under the new run ID
      const metadata = sourceTuple.metadata ?? {
        source: "fork" as const,
        step: -1,
        parents: {}
      };
      await checkpointer.put(forkConfig, checkpoint, metadata, {});
    }

    return NextResponse.json({
      newRunId: savedRun.runId,
      sourceRunId,
      forkedFromCheckpointId: parsed.data.checkpointId ?? "latest",
      run: {
        runId: savedRun.runId,
        status: savedRun.status,
        title: savedRun.title,
        createdAt: savedRun.createdAt
      }
    }, { status: 201 });
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RunValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
