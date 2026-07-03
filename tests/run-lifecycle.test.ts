import { describe, expect, it } from "vitest";
import {
  allowedStatusesForAction,
  assertTransition,
  assertRunActionAllowed,
  canPause,
  isTerminalStatus
} from "@/lib/server/runs/lifecycle";
import { RUN_STATUS_VALUES, type RunStatus } from "@/lib/server/runs/schema";
import { RunLifecycleError } from "@/lib/server/runs/errors";

const LEGAL: ReadonlyArray<[RunStatus, RunStatus]> = [
  ["created", "generating"],
  ["created", "failed"],
  ["generating", "paused"],
  ["generating", "needs_review"],
  ["generating", "interrupted"],
  ["generating", "failed"],
  ["paused", "generating"],
  ["paused", "running"],
  ["paused", "needs_review"],
  ["paused", "interrupted"],
  ["paused", "failed"],
  ["needs_review", "approved"],
  ["needs_review", "failed"],
  ["approved", "running"],
  ["approved", "needs_review"],
  ["approved", "failed"],
  ["running", "paused"],
  ["running", "completed"],
  ["running", "completed_with_accepted"],
  ["running", "interrupted"],
  ["running", "failed"],
  ["interrupted", "generating"],
  ["interrupted", "running"],
  ["interrupted", "failed"],
  // Re-open a finished run for post-completion review actions (Fase C).
  ["completed", "approved"],
  ["completed_with_accepted", "approved"],
  ["failed", "approved"],
  ["failed", "generating"]
];

describe("run lifecycle", () => {
  it("accepts every legal transition", () => {
    for (const [from, to] of LEGAL) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("accepts no-op transitions", () => {
    for (const status of RUN_STATUS_VALUES) {
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });

  it("rejects every transition not in the legal set", () => {
    const legalSet = new Set(LEGAL.map(([from, to]) => `${from}→${to}`));
    for (const from of RUN_STATUS_VALUES) {
      for (const to of RUN_STATUS_VALUES) {
        if (from === to) continue;
        if (legalSet.has(`${from}→${to}`)) continue;
        expect(() => assertTransition(from, to)).toThrowError(RunLifecycleError);
      }
    }
  });

  it("canPause is true only for generating and running", () => {
    expect(canPause("generating")).toBe(true);
    expect(canPause("running")).toBe(true);
    expect(canPause("created")).toBe(false);
    expect(canPause("paused")).toBe(false);
    expect(canPause("needs_review")).toBe(false);
    expect(canPause("approved")).toBe(false);
    expect(canPause("completed")).toBe(false);
    expect(canPause("failed")).toBe(false);
  });

  it("isTerminalStatus identifies completed, completed_with_accepted and failed", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("completed_with_accepted")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("needs_review")).toBe(false);
  });

  it("defines lifecycle control-plane actions with explicit allowed statuses", () => {
    expect(allowedStatusesForAction("start")).toEqual(["approved"]);
    expect(allowedStatusesForAction("pause")).toEqual(["generating", "running"]);
    expect(allowedStatusesForAction("resume")).toEqual(["paused"]);
    expect(allowedStatusesForAction("cancel")).toEqual(["generating", "running", "paused"]);
    expect(allowedStatusesForAction("restart")).toEqual(["interrupted", "failed"]);
    expect(allowedStatusesForAction("fork")).not.toContain("running");
    expect(allowedStatusesForAction("fork")).not.toContain("generating");
  });

  it("rejects invalid lifecycle actions before callers mutate a run", () => {
    expect(() => assertRunActionAllowed("completed", "pause")).toThrowError(RunLifecycleError);
    expect(() => assertRunActionAllowed("running", "resume")).toThrowError(RunLifecycleError);
    expect(() => assertRunActionAllowed("approved", "restart")).toThrowError(RunLifecycleError);
    expect(() => assertRunActionAllowed("running", "fork")).toThrowError(RunLifecycleError);
    expect(() => assertRunActionAllowed("paused", "resume")).not.toThrow();
  });
});
