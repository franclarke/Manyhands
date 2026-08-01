import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { initializeRunCanonicalEvents } from "../apps/web/src/lib/server/runs/v2/initialize-run";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-create-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("run creation canonical event", () => {
  it("makes run.created durable before the caller can read the run", async () => {
    await initializeRunCanonicalEvents({
      directory,
      runId: "run-before-response",
      goal: "Build notes"
    });

    const events = await new JsonlRunEventStore({ directory }).load("run-before-response");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sequence: 1,
      type: "run.created",
      payload: { goal: "Build notes" }
    });
  });
});
