import { describe, expect, it } from "vitest";

import {
  abortRun,
  createRunAbort,
  disposeRunAbort
} from "@/lib/server/runs/run-abort-registry";
import {
  runWithProcessSupervision,
  supervisedExecFile
} from "@/lib/server/runs/process-supervision";

describe("operation-aware run abort authority", () => {
  it("does not let superseded cleanup remove the takeover controller", () => {
    const runId = "run-abort-takeover";
    const old = createRunAbort(runId, "operation-old");
    const successor = createRunAbort(runId, "operation-new");

    disposeRunAbort(runId, "operation-old");
    expect(abortRun(runId)).toBe(true);
    expect(old.signal.aborted).toBe(false);
    expect(successor.signal.aborted).toBe(true);

    disposeRunAbort(runId, "operation-new");
  });

  it("refuses to spawn a supervised effect after its operation was aborted", async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(runWithProcessSupervision({
      runId: "run-aborted-dispatch",
      operationId: "operation-old",
      label: "delivery-v2",
      signal: abort.signal
    }, async () => supervisedExecFile("__manyhands_must_not_spawn__", []))).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});
