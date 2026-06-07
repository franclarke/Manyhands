import { NextResponse } from "next/server";
import { isExecutionResult } from "@/lib/execution-summary";
import { buildRunReceipt, renderRunReceiptMarkdown } from "@/lib/run-receipt";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  RunNotFoundError,
  ensureRunModelEventLogForRun,
  getRunRepository
} from "@/lib/server/runs";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import type { RunRecord } from "@/lib/server/runs/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ArtifactResponse {
  ref: string;
  kind: "diff" | "log" | "narrative" | "diagnosis" | "contract" | "json";
  title: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const ref = new URL(request.url).searchParams.get("ref");
  if (ref === null || ref.trim().length === 0) {
    return NextResponse.json({ error: "Missing artifact ref" }, { status: 400 });
  }

  try {
    const run = await getRunRepository().get(id);
    const artifact = await resolveArtifact(run, ref);
    if (artifact === null) {
      return NextResponse.json({ error: `Artifact not found: ${ref}` }, { status: 404 });
    }
    return NextResponse.json(artifact);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function resolveArtifact(run: RunRecord, ref: string): Promise<ArtifactResponse | null> {
  const url = parseRef(ref);
  if (url === null) return null;

  const parts = pathParts(url);
  const runId = run.runId;
  if (url.protocol === "diff:") {
    if (parts[0] === "runs" && parts[1] === runId && parts[2] === "final") {
      const finalPatch = run.finalPatch ?? finalPatchFromExecution(run);
      return {
        ref,
        kind: "diff",
        title: "Final aggregate diff",
        content: finalPatch.length > 0 ? finalPatch : "No final diff is available yet.",
        language: "diff"
      };
    }
    if (parts[0] === "runs" && parts[1] === runId && parts[2] === "node" && parts[3] !== undefined) {
      const nodeId = parts[3];
      const leaf = leafFor(run, nodeId);
      if (leaf === null) return null;
      return {
        ref,
        kind: "diff",
        title: `Node diff: ${nodeId}`,
        content: leaf.diff?.trim().length ? leaf.diff : "This node has no recorded diff.",
        language: "diff",
        metadata: { changedFiles: leaf.changedFiles ?? [], commitSha: leaf.commitSha }
      };
    }
  }

  if (url.protocol === "log:" && parts[0] === "runs" && parts[1] === runId && parts[2] === "node" && parts[3] !== undefined) {
    const nodeId = parts[3];
    const leaf = leafFor(run, nodeId);
    if (leaf === null) return null;
    return {
      ref,
      kind: "log",
      title: `Agent log: ${nodeId}`,
      content: [
        `status: ${leaf.status}`,
        `exitCode: ${leaf.executorExitCode}`,
        `timedOut: ${leaf.executorTimedOut}`,
        leaf.validationResult !== undefined
          ? `validation: ${leaf.validationResult.passed ? "passed" : "failed"} (${leaf.validationResult.exitCode})\n${leaf.validationResult.output}`
          : "validation: not recorded",
        leaf.stdoutTail !== undefined ? `\nstdout tail:\n${leaf.stdoutTail}` : "",
        leaf.stderrTail !== undefined ? `\nstderr tail:\n${leaf.stderrTail}` : ""
      ].filter(Boolean).join("\n"),
      language: "text"
    };
  }

  if (url.protocol === "narrative:" && parts[0] === "runs" && parts[1] === runId && parts[2] === "receipt") {
    return {
      ref,
      kind: "narrative",
      title: "Run receipt",
      content: renderRunReceiptMarkdown(buildRunReceipt(run)),
      language: "markdown"
    };
  }

  if (url.protocol === "diagnosis:" && parts[0] === "runs" && parts[1] === runId && parts[2] === "integration" && parts[3] !== undefined) {
    const compositeId = parts[3];
    const integration = integrationFor(run, compositeId);
    if (integration === null) return null;
    return {
      ref,
      kind: "diagnosis",
      title: `Integration diagnosis: ${compositeId}`,
      content: JSON.stringify(
        {
          status: integration.status,
          conflictDetails: integration.conflictDetails,
          preMergeFindings: integration.preMergeFindings,
          repairAttempted: integration.repairAttempted,
          repairResult: integration.repairResult
            ? {
                status: integration.repairResult.status,
                changedFiles: integration.repairResult.changedFiles,
                stderrTail: integration.repairResult.stderrTail
              }
            : undefined,
          parentValidation: integration.parentValidation
        },
        null,
        2
      ),
      language: "json"
    };
  }

  if (url.protocol === "contract:" && parts[0] === "runs" && parts[1] === runId && parts[2] === "seam" && parts[3] !== undefined) {
    const events = await ensureRunModelEventLogForRun(run);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
    const seam = model.seams.get(parts[3]);
    if (seam === undefined) return null;
    return {
      ref,
      kind: "contract",
      title: `Seam contract: ${seam.id}`,
      content: JSON.stringify(seam, null, 2),
      language: "json"
    };
  }

  return null;
}

function parseRef(ref: string): URL | null {
  try {
    return new URL(ref);
  } catch {
    return null;
  }
}

function pathParts(url: URL): string[] {
  return [url.hostname, ...url.pathname.split("/").filter((part) => part.length > 0)];
}

function finalPatchFromExecution(run: RunRecord): string {
  if (!isExecutionResult(run.execution)) return "";
  return run.execution.leafResults
    .map((leaf) => leaf.diff)
    .filter((diff) => diff.trim().length > 0)
    .join("\n\n");
}

function leafFor(run: RunRecord, nodeId: string): NonNullable<ReturnType<typeof executionShape>>["leafResults"][number] | null {
  const execution = executionShape(run);
  return execution?.leafResults.find((leaf) => leaf.taskId === nodeId) ?? null;
}

function integrationFor(run: RunRecord, compositeId: string): NonNullable<ReturnType<typeof executionShape>>["integrationResults"][number] | null {
  const execution = executionShape(run);
  return execution?.integrationResults.find((integration) => integration.compositeTaskId === compositeId) ?? null;
}

function executionShape(run: RunRecord) {
  return isExecutionResult(run.execution) ? run.execution : null;
}
