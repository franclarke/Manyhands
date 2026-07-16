/**
 * Start an immediate, self-scheduling poll loop. The next timer is created only
 * after the previous request settles, so a slow development server can never
 * accumulate overlapping `/api/runs` requests. Failed probes back off
 * exponentially and a successful probe returns to the normal cadence.
 */
export function startSingleFlightPoller({
  poll,
  intervalMs,
  maxIntervalMs,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (handle) => clearTimeout(handle),
  onError = () => undefined
}) {
  if (typeof poll !== "function") throw new TypeError("poll must be a function");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("intervalMs must be a positive finite number");
  }
  if (!Number.isFinite(maxIntervalMs) || maxIntervalMs < intervalMs) {
    throw new RangeError("maxIntervalMs must be finite and >= intervalMs");
  }

  let stopped = false;
  let timer = null;
  let consecutiveFailures = 0;

  async function tick() {
    if (stopped) return;
    let succeeded = false;
    try {
      succeeded = (await poll()) !== false;
    } catch (error) {
      onError(error);
    }
    if (stopped) return;

    if (succeeded) consecutiveFailures = 0;
    else consecutiveFailures += 1;
    const delayMs = succeeded
      ? intervalMs
      : Math.min(maxIntervalMs, intervalMs * 2 ** consecutiveFailures);
    timer = schedule(() => {
      timer = null;
      void tick();
    }, delayMs);
  }

  void tick();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    }
  };
}
