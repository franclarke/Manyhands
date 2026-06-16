import type { Actor } from "@/lib/run-model/types";
import { publishRunEvent } from "./event-bus";
import { appendRunModelEvent, publishRunModelEvent } from "./run-model-event-log";
import { runControlForRun } from "./run-model-projection";
import type { RunRecord } from "./schema";

export async function appendRunStatusChanged(
  run: RunRecord,
  options: { at?: string; actor?: Actor } = {}
): Promise<void> {
  const at = options.at ?? run.updatedAt;
  publishRunEvent(run.runId, { kind: "status.changed", status: run.status, at });
  await appendRunModelEvent(run.runId, {
    actor: options.actor ?? "system",
    at,
    type: "run.status.changed",
    payload: runControlForRun(run)
  });
}

export function publishRunStatusChanged(
  run: RunRecord,
  options: { at?: string; actor?: Actor } = {}
): void {
  const at = options.at ?? run.updatedAt;
  publishRunEvent(run.runId, { kind: "status.changed", status: run.status, at });
  publishRunModelEvent(run.runId, {
    actor: options.actor ?? "system",
    at,
    type: "run.status.changed",
    payload: runControlForRun(run)
  });
}
