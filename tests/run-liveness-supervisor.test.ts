import { describe, expect, it, vi } from "vitest";

import { superviseRunLiveness } from "@/lib/server/runs/liveness-supervisor";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

/**
 * Stage 5 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * The product decides for itself that a run was abandoned, and ends it through
 * the same verified cancellation path a human would — not a second way to
 * finish a run.
 */

const MINUTE = 60_000;
const NOW = "2026-08-07T12:00:00.000Z";

function at(minutesAgo: number): string {
  return new Date(Date.parse(NOW) - minutesAgo * MINUTE).toISOString();
}

function run(overrides: Record<string, unknown> = {}) {
  const record = makeRunRecordV2({
    lifecycle: "running",
    activeOperation: {
      operationId: "11111111-1111-4111-8111-111111111111",
      kind: "execution",
      fencingToken: 1,
      acquiredAt: at(60),
      heartbeatAt: at(60)
    },
    ...overrides
  });
  return record;
}

function deps(input: { ownerPresent: boolean; cancel?: ReturnType<typeof vi.fn> }) {
  const cancel = input.cancel ?? vi.fn(async () => undefined);
  return {
    cancel,
    options: {
      hasLiveProcesses: async () => input.ownerPresent,
      cancelRun: cancel,
      staleAfterMs: 10 * MINUTE,
      now: () => NOW
    }
  };
}

describe("run liveness supervisor", () => {
  it("ends an abandoned run through the verified cancellation path", async () => {
    const { cancel, options } = deps({ ownerPresent: false });

    const verdict = await superviseRunLiveness(run(), options);

    expect(verdict.kind).toBe("owner_absent");
    expect(cancel).toHaveBeenCalledTimes(1);
    const [runId, reason] = cancel.mock.calls[0]!;
    expect(runId).toBe(run().runId);
    // The reason has to be attributable: which operation, and silent how long.
    expect(reason).toContain("11111111-1111-4111-8111-111111111111");
    expect(reason).toMatch(/60|silent/iu);
  });

  /**
   * The asymmetry that matters. A busy executor that has not written a
   * heartbeat is still working, and cancelling it would destroy the work.
   */
  it("never cancels a run whose owner process is still alive", async () => {
    const { cancel, options } = deps({ ownerPresent: true });

    const verdict = await superviseRunLiveness(run(), options);

    expect(verdict.kind).toBe("owner_silent");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("leaves a healthy run untouched without asking the operating system", async () => {
    const probe = vi.fn(async () => false);
    const cancel = vi.fn(async () => undefined);

    const verdict = await superviseRunLiveness(
      run({ activeOperation: { operationId: "11111111-1111-4111-8111-111111111111", kind: "execution" as const, fencingToken: 1, acquiredAt: at(1), heartbeatAt: at(1) } }),
      { hasLiveProcesses: probe, cancelRun: cancel, staleAfterMs: 10 * MINUTE, now: () => NOW }
    );

    expect(verdict.kind).toBe("alive");
    expect(cancel).not.toHaveBeenCalled();
    // Inspecting the process table costs a subprocess; a fresh heartbeat is
    // already proof of life, so the probe must not run at all.
    expect(probe).not.toHaveBeenCalled();
  });

  it("leaves a run parked for a human untouched", async () => {
    const { cancel, options } = deps({ ownerPresent: false });
    const parked = makeRunRecordV2({ lifecycle: "needs_approval" });

    expect((await superviseRunLiveness(parked, options)).kind).toBe("parked");
    expect(cancel).not.toHaveBeenCalled();
  });

  /**
   * A cancellation that fails must not be reported as a completed one, or the
   * supervisor would claim it tidied a run it left running.
   */
  it("surfaces a failed cancellation instead of reporting success", async () => {
    const cancel = vi.fn(async () => { throw new Error("lease lost"); });
    const { options } = deps({ ownerPresent: false, cancel });

    await expect(superviseRunLiveness(run(), options)).rejects.toThrow(/lease lost/u);
  });
});
