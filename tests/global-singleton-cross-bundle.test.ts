/**
 * Cross-bundle singleton sharing.
 *
 * Next.js instantiates module-level state once per route bundle (and again per
 * dev recompile), so an EventEmitter map declared at module scope fragments:
 * the pipeline publishes run-model events on one instance while the
 * `/run-events` SSE route subscribes on another, and the workspace never
 * receives live frames during planning. `globalSingleton` anchors that state
 * on `globalThis`. Two module instances are simulated here with
 * `vi.resetModules()` + dynamic import — exactly the duplication Next produces.
 */
import { describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/lib/run-model/types";

type RunModelEventBus = typeof import("@/lib/server/runs/run-model-event-bus");
type RunnerState = typeof import("@/lib/server/runs/runner-state");

async function importTwice<T>(specifier: string): Promise<[T, T]> {
  vi.resetModules();
  const first = (await import(specifier)) as T;
  vi.resetModules();
  const second = (await import(specifier)) as T;
  expect(first).not.toBe(second); // genuinely two module instances
  return [first, second];
}

describe("global-singleton — state shared across module instances", () => {
  it("run-model bus delivers events published from another module instance", async () => {
    const [busA, busB] = await importTwice<RunModelEventBus>(
      "@/lib/server/runs/run-model-event-bus"
    );

    const received: RunEvent[] = [];
    const unsubscribe = busA.subscribeRunModelEvents("run-cross-bundle", (event) =>
      received.push(event)
    );
    const event: RunEvent = {
      seq: 1,
      at: new Date().toISOString(),
      runId: "run-cross-bundle",
      actor: "system",
      type: "plan.node.proposed",
      payload: { nodeId: "root", parentId: null, role: "root", title: "t", goal: "g", depth: 0 }
    };
    busB.publishRunModelBusEvent("run-cross-bundle", event);
    unsubscribe();

    expect(received).toEqual([event]);
  });

  it("runner-state marks are visible from another module instance", async () => {
    const [stateA, stateB] = await importTwice<RunnerState>(
      "@/lib/server/runs/runner-state"
    );

    stateA.markRunnerActive("run-cross-bundle");
    expect(stateB.isRunnerActive("run-cross-bundle")).toBe(true);
    stateB.markRunnerInactive("run-cross-bundle");
    expect(stateA.isRunnerActive("run-cross-bundle")).toBe(false);
  });
});
