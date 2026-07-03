import { getRunRepository } from "./store";

const PAUSE_POLL_MS = 80;

export async function waitWhilePlainPaused(
  runId: string,
  phase: "generating" | "running",
  signal?: AbortSignal
): Promise<void> {
  while (signal?.aborted !== true) {
    const current = await getRunRepository()
      .get(runId)
      .catch(() => null);
    if (current === null) return;
    const plainPaused =
      current.status === "paused" &&
      current.pausedDuring === phase &&
      current.pendingDecision === undefined &&
      current.pendingQuestion === undefined &&
      current.pendingReplan === undefined;
    if (!plainPaused) return;
    await sleep(PAUSE_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
