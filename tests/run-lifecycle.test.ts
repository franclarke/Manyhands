import { describe, expect, it } from "vitest";
import {
  assertTransition,
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
  ["failed", "approved"]
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
});
