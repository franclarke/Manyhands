import { NextResponse } from "next/server";
import { z } from "zod";

import {
  RunLifecycleError,
  RunNotFoundError,
  appendStatusAndRunEventsOrRollback,
  assertRunActionAllowed,
  ensureRunModelEventLogForRun,
  getRunRepository,
  isRunnerActive
} from "@/lib/server/runs";
import {
  DeliveryError,
  type DeliveryReceipt,
  type DeliveryRequest,
  cleanupRunArtifacts,
  discardRunBranch,
  deliverRunBranch,
  getDeliveryReceipt,
  getDeliveryStatus,
} from "@/lib/server/runs/delivery";
import { revealInFileExplorer } from "@/lib/server/local-fs";
import { terminalDispositionForArtifact } from "@/lib/server/runs/final-artifact";
import type { RunRecord } from "@/lib/server/runs/schema";
import { resolveRunRevealTarget } from "@/lib/server/runs/delivery-reveal-target";
import { RunTargetMismatchError } from "@/lib/server/runs/target-context";
import {
  claimRunOperation,
  releaseRunOperation,
  updateRunForOperation
} from "@/lib/server/runs/run-operation-lease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    return NextResponse.json(await getDeliveryStatus(run));
  } catch (error) {
    return errorResponse(error);
  }
}

const ActionSchema = z.object({
  action: z.enum(["merge", "discard", "cleanup", "reveal"]),
  manifestId: z.string().uuid().optional(),
  finalSha: z.string().min(1).optional(),
  targetBranch: z.string().min(1).optional(),
  expectedTargetHead: z.string().min(1).optional(),
  expectedClean: z.boolean().optional(),
  targetFingerprint: z.string().min(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(8).max(200).optional()
});

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "action must be one of: merge, discard, cleanup, reveal" }, { status: 400 });
  }

  try {
    const run = await getRunRepository().get(id);

    // Destructive delivery (merge/discard/cleanup) must not run while the run is
    // not terminal or while a runner still drives it — otherwise it can clobber
    // an in-flight integration or delete a resumable run's worktrees/branches.
    // `reveal` is read-only and stays ungated.
    if (parsed.data.action !== "reveal") {
      assertRunActionAllowed(run, "deliver");
      if (isRunnerActive(id)) {
        throw new RunLifecycleError(
          "El run tiene un runner activo en ejecución; no se puede entregar hasta que termine."
        );
      }
    }

    switch (parsed.data.action) {
      case "merge": {
        if (
          parsed.data.manifestId !== undefined && parsed.data.finalSha !== undefined && parsed.data.targetBranch !== undefined &&
          parsed.data.expectedTargetHead !== undefined && parsed.data.expectedClean !== undefined &&
          parsed.data.targetFingerprint !== undefined && parsed.data.expectedVersion !== undefined && parsed.data.idempotencyKey !== undefined
        ) {
          const deliveryRequest: DeliveryRequest = {
            runId: id,
            manifestId: parsed.data.manifestId,
            finalSha: parsed.data.finalSha,
            targetBranch: parsed.data.targetBranch,
            expectedTargetHead: parsed.data.expectedTargetHead,
            expectedClean: parsed.data.expectedClean,
            targetFingerprint: parsed.data.targetFingerprint,
            actor: "local_operator",
            idempotencyKey: parsed.data.idempotencyKey
          };
          let priorReceipt: DeliveryReceipt | undefined;
          let claimBase = run;
          if (parsed.data.expectedVersion !== run.version) {
            priorReceipt = await getDeliveryReceipt(run, deliveryRequest);
            if (priorReceipt?.disposition !== "delivered") {
              throw new RunLifecycleError("El run cambió desde la confirmación de delivery; refrescá y confirmá de nuevo.");
            }
            // The original request may reconcile the record while this retry
            // waits on the repository lease. Refresh before adopting its fact.
            claimBase = await getRunRepository().get(id);
            if (isDeliveryPersisted(claimBase, parsed.data.manifestId, parsed.data.finalSha)) {
              await ensureRunModelEventLogForRun(claimBase);
              return NextResponse.json({ ok: true, mergedInto: priorReceipt.targetBranch, receipt: priorReceipt });
            }
          }
          let claimedResult;
          try {
            claimedResult = await claimRunOperation(id, "delivery", {
              expectedStatuses: ["needs_delivery", "failed_delivery", "completed", "completed_with_accepted", "failed"],
              expectedVersion: priorReceipt === undefined ? parsed.data.expectedVersion : claimBase.version,
              ...(priorReceipt !== undefined && claimBase.activeOperation?.kind === "delivery"
                ? { allowTakeover: true }
                : {})
            });
          } catch (error) {
            if (priorReceipt?.disposition === "delivered") {
              const latest = await getRunRepository().get(id);
              if (isDeliveryPersisted(latest, parsed.data.manifestId, parsed.data.finalSha)) {
                await ensureRunModelEventLogForRun(latest);
                return NextResponse.json({ ok: true, mergedInto: priorReceipt.targetBranch, receipt: priorReceipt });
              }
            }
            throw error;
          }
          const { run: claimed, lease } = claimedResult;
          try {
            const deliveredManifest = claimed.finalArtifactManifest === undefined
              ? undefined
              : { ...claimed.finalArtifactManifest, deliveryDisposition: "delivered" as const };
            const disposition = terminalDispositionForArtifact({
              manifest: deliveredManifest,
              acceptedRisk: claimed.executionOutcome === "partial"
            });
            if (
              (claimed.status === "needs_delivery" || claimed.status === "failed_delivery") &&
              disposition !== "completed"
            ) {
              throw new DeliveryError(
                `Artifact ${parsed.data.manifestId} cannot transition to completed after delivery (${disposition}).`
              );
            }
            // All semantic/lifecycle preconditions are checked before the Git
            // merge. A receipt recovery skips the side effect and only resumes
            // the durable record/event reconciliation below.
            const receipt = priorReceipt ?? await deliverRunBranch(claimed, deliveryRequest);
            const at = receipt.completedAt ?? new Date().toISOString();
            const nextStatus = claimed.status === "needs_delivery" || claimed.status === "failed_delivery"
              ? disposition
              : claimed.status;
            const saved = await updateRunForOperation(id, lease, (current) => {
              const manifest = current.finalArtifactManifest;
              if (
                manifest === undefined ||
                manifest.manifestId !== parsed.data.manifestId ||
                manifest.finalSha !== parsed.data.finalSha
              ) {
                throw new RunLifecycleError(
                  "The final artifact changed during delivery; its receipt was preserved for reconciliation."
                );
              }
              return {
                ...current,
                status: nextStatus,
                updatedAt: at,
                ...(nextStatus === "completed" ? { completedAt: at } : {}),
                deliveryOutcome: "delivered",
                finalArtifactManifest: { ...manifest, deliveryDisposition: "delivered" }
              };
            });
            await appendStatusAndRunEventsOrRollback(
              claimed,
              saved,
              [
                {
                  eventId: `delivery-completed:${id}:${receipt.deliveryId}`,
                  actor: "human",
                  at,
                  type: "run.delivery.completed",
                  payload: {
                    manifestId: parsed.data.manifestId,
                    finalSha: parsed.data.finalSha,
                    deliveryId: receipt.deliveryId,
                    targetBranch: receipt.targetBranch,
                    targetHead: receipt.targetHeadAfter
                  }
                },
                ...(claimed.status !== "completed" && nextStatus === "completed"
                  ? [{
                      eventId: `run-completed-by-delivery:${id}:${parsed.data.manifestId}`,
                      actor: "system" as const,
                      at,
                      type: "run.completed" as const,
                      payload: { status: "success" as const }
                    }]
                  : [])
              ],
              { at, actor: "human", lease }
            );
            return NextResponse.json({ ok: true, mergedInto: receipt.targetBranch, receipt });
          } finally {
            await releaseRunOperation(id, lease);
          }
        }
        throw new DeliveryError("La confirmación de delivery está incompleta; refrescá el estado del target y confirmá nuevamente.");
      }
      case "discard": {
        await discardRunBranch(run);
        return NextResponse.json({ ok: true });
      }
      case "cleanup": {
        const result = await cleanupRunArtifacts(run);
        return NextResponse.json({ ok: true, ...result });
      }
      case "reveal": {
        const target = await resolveRunRevealTarget(run);
        if (target === undefined) {
          return NextResponse.json({ error: "Este run no tiene una carpeta local para abrir." }, { status: 400 });
        }
        await revealInFileExplorer(target);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function isDeliveryPersisted(run: RunRecord, manifestId: string, finalSha: string): boolean {
  const manifest = run.finalArtifactManifest;
  return (
    run.deliveryOutcome === "delivered" &&
    manifest?.manifestId === manifestId &&
    manifest.finalSha === finalSha &&
    manifest.deliveryDisposition === "delivered" &&
    run.status !== "needs_delivery" &&
    run.status !== "failed_delivery"
  );
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof DeliveryError) {
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
