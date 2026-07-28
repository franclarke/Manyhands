import { describe, expect, it } from "vitest";

import {
  drainRunBackgroundTasks,
  startRunBackgroundTask,
  startRunBackgroundTaskAfterCurrent
} from "@/lib/server/runs/runner-state";

describe("run background task handoff", () => {
  it("starts a successor only after the tasks that were active when it was scheduled settle", async () => {
    const runId = "run-background-handoff";
    const ordering: string[] = [];
    let releaseCurrent!: () => void;
    const currentCanFinish = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    let currentStarted!: () => void;
    const currentIsRunning = new Promise<void>((resolve) => {
      currentStarted = resolve;
    });

    startRunBackgroundTask(runId, "current", async () => {
      ordering.push("current:start");
      currentStarted();
      await currentCanFinish;
      ordering.push("current:end");
    });
    await currentIsRunning;

    startRunBackgroundTaskAfterCurrent(runId, "successor", async () => {
      ordering.push("successor:start");
    });
    await Promise.resolve();

    expect(ordering).toEqual(["current:start"]);

    releaseCurrent();
    await drainRunBackgroundTasks(runId);

    expect(ordering).toEqual(["current:start", "current:end", "successor:start"]);
  });
});
