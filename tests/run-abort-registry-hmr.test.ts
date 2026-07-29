import { afterEach, describe, expect, it, vi } from "vitest";

import {
  globalSingleton,
  resetGlobalSingleton
} from "@/lib/server/global-singleton";

afterEach(() => {
  resetGlobalSingleton("run-abort-registry");
  resetGlobalSingleton("run-abort-registry:v2");
  vi.resetModules();
});

describe("run abort registry HMR migration", () => {
  it("does not interpret a legacy AbortController entry as operation-aware state", async () => {
    resetGlobalSingleton("run-abort-registry");
    resetGlobalSingleton("run-abort-registry:v2");
    globalSingleton(
      "run-abort-registry",
      () => new Map([["legacy-run", new AbortController()]])
    );
    vi.resetModules();

    const registry = await import("@/lib/server/runs/run-abort-registry");

    expect(registry.abortRun("legacy-run")).toBe(false);
    const current = registry.createRunAbort("current-run", "operation-current");
    expect(registry.abortRun("current-run")).toBe(true);
    expect(current.signal.aborted).toBe(true);
  });
});
