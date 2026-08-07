import { describe, expect, it } from "vitest";

import { hasLiveRunProcesses } from "@/lib/server/runs/process-evidence";

/**
 * Stage 5 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * The read-only half of the liveness supervisor: is a process of this run
 * verifiably alive? It decides whether an expired heartbeat means an abandoned
 * run or a busy one, so its errors are asymmetric. Saying "present" when the
 * run is dead leaves it hanging a while longer; saying "absent" when it is
 * alive destroys work in progress. Every uncertain case therefore answers
 * present.
 */

const REGISTERED_AT = "2026-08-07T12:00:00.000Z";
const REGISTERED_MS = Date.parse(REGISTERED_AT);

function deps(input: {
  open?: Array<{ pid?: number; registeredAt?: string }>;
  table?: Array<{ pid: number; createdAtMs?: number }> | "unavailable";
  live?: number[];
}) {
  return {
    journal: {
      listOpen: async () => (input.open ?? []).map((record, index) => ({
        pid: record.pid,
        registeredAt: record.registeredAt ?? REGISTERED_AT,
        label: `proc-${index}`
      }))
    },
    inspector: {
      snapshot: async () => {
        if (input.table === "unavailable") throw new Error("no process table");
        return new Map((input.table ?? []).map((entry) => [entry.pid, {
          pid: entry.pid,
          ...(entry.createdAtMs === undefined ? {} : { createdAtMs: entry.createdAtMs })
        }]));
      }
    },
    isAlive: (pid: number) => (input.live ?? []).includes(pid),
    skewMs: 5_000
  };
}

describe("run process presence", () => {
  it("reports absent when the run never registered a process", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({ open: [] }))).toBe(false);
  });

  it("reports absent when the registered pid is gone from the process table", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({ open: [{ pid: 4242 }], table: [] }))).toBe(false);
  });

  it("reports present for a registered pid that is still in the table", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: [{ pid: 4242, createdAtMs: REGISTERED_MS - 1_000 }]
    }))).toBe(true);
  });

  /**
   * A pid the OS handed to somebody else after ours died. Its creation time
   * postdates our registration, so the process we registered is provably gone —
   * counting it as present would keep an abandoned run alive forever on the
   * strength of an unrelated program.
   */
  it("reports absent when the pid was recycled into another process", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: [{ pid: 4242, createdAtMs: REGISTERED_MS + 60_000 }]
    }))).toBe(false);
  });

  it("tolerates clock skew rather than calling a live process recycled", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: [{ pid: 4242, createdAtMs: REGISTERED_MS + 2_000 }]
    }))).toBe(true);
  });

  /**
   * Without a process table the identity check is impossible, so a pid that is
   * still alive might be ours or might be a recycled stranger. Uncertainty
   * answers present: invariant 8 forbids treating absence of evidence as
   * evidence of absence.
   */
  it("reports present for a live pid it cannot identify", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: "unavailable",
      live: [4242]
    }))).toBe(true);
  });

  /**
   * A pid that is gone is gone, table or no table — that is evidence of
   * absence, not the lack of it. Refusing to conclude here would make an
   * abandoned run undetectable on any host whose process table cannot be read.
   */
  it("reports absent for a dead pid even without a process table", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: "unavailable",
      live: []
    }))).toBe(false);
  });

  /**
   * Identity that cannot be confirmed is not identity that was refuted. The
   * kill path refuses to kill such a pid for the same reason.
   */
  it("reports present for a pid whose creation time the OS would not give", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 4242 }],
      table: [{ pid: 4242 }]
    }))).toBe(true);
  });

  it("reports present when any one of several registered processes is alive", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({
      open: [{ pid: 1 }, { pid: 2 }],
      table: [{ pid: 2, createdAtMs: REGISTERED_MS - 1_000 }]
    }))).toBe(true);
  });

  it("ignores a record that never captured a pid", async () => {
    expect(await hasLiveRunProcesses("run-1", deps({ open: [{}], table: [] }))).toBe(false);
  });
});
