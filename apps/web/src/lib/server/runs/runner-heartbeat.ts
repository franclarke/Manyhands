import { getRunRepository } from "./store";

const HEARTBEAT_INTERVAL_MS = 4_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startHeartbeat(runId: string): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    while (!stopped) {
      await sleep(HEARTBEAT_INTERVAL_MS);
      if (stopped) return;
      try {
        const repo = getRunRepository();
        await repo.update(runId, (current) => ({ ...current, heartbeatAt: new Date().toISOString() }));
      } catch {
        // best-effort; sweeper will handle persistent failures
      }
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}
