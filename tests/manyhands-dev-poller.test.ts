import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const pollerUrl = pathToFileURL(path.resolve("scripts/manyhands-dev-poller.mjs")).href;

async function loadPoller(): Promise<{
  startSingleFlightPoller: (options: {
    poll: () => Promise<boolean | void>;
    intervalMs: number;
    maxIntervalMs: number;
    schedule?: (callback: () => void, delayMs: number) => unknown;
    cancel?: (handle: unknown) => void;
  }) => { stop: () => void };
}> {
  return (await import(pollerUrl)) as never;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("manyhands dev single-flight poller", () => {
  it("never schedules the next poll until the current request settles", async () => {
    const { startSingleFlightPoller } = await loadPoller();
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    let release: ((value: boolean) => void) | undefined;
    let active = 0;
    let maxActive = 0;
    const poll = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const result = await new Promise<boolean>((resolve) => {
        release = resolve;
      });
      active -= 1;
      return result;
    });

    const controller = startSingleFlightPoller({
      poll,
      intervalMs: 2_000,
      maxIntervalMs: 30_000,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return callback;
      },
      cancel: () => undefined
    });

    await flush();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(scheduled).toEqual([]);

    release?.(true);
    await flush();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([2_000]);

    scheduled.shift()?.callback();
    await flush();
    expect(poll).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    controller.stop();
  });

  it("backs off failed probes and resets after a successful response", async () => {
    const { startSingleFlightPoller } = await loadPoller();
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const results = [false, false, false, true];
    const controller = startSingleFlightPoller({
      poll: async () => results.shift() ?? true,
      intervalMs: 2_000,
      maxIntervalMs: 10_000,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return callback;
      },
      cancel: () => undefined
    });

    for (let index = 0; index < 4; index += 1) {
      await flush();
      if (index < 3) scheduled[index]?.callback();
    }

    expect(scheduled.map((entry) => entry.delayMs)).toEqual([4_000, 8_000, 10_000, 2_000]);
    controller.stop();
  });
});
