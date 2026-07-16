import { describe, expect, it } from "vitest";
import { assertTransition, canRestart } from "@/lib/server/runs/lifecycle";
import { RunLifecycleError } from "@/lib/server/runs/errors";

describe("interrupted lifecycle transitions", () => {
  it("allows generating → interrupted", () => {
    expect(() => assertTransition("generating", "interrupted")).not.toThrow();
  });

  it("allows running → interrupted", () => {
    expect(() => assertTransition("running", "interrupted")).not.toThrow();
  });

  it("allows interrupted → generating", () => {
    expect(() => assertTransition("interrupted", "generating")).not.toThrow();
  });

  it("allows interrupted → running", () => {
    expect(() => assertTransition("interrupted", "running")).not.toThrow();
  });

  it("allows interrupted → approved (restart bridges an execution-interrupted run back into execution)", () => {
    // The restart route resumes execution from an `interrupted` run by first
    // moving it to `approved` (the execution pipeline's own approved → running
    // step). `failed → approved` is already allowed for the symmetric case; a
    // run interrupted during execution must restart the same way, otherwise it
    // wedges with "Illegal status transition: interrupted → approved" and can
    // never be resumed (observed E2E 2026-07-06).
    expect(() => assertTransition("interrupted", "approved")).not.toThrow();
  });

  it("rejects interrupted → completed", () => {
    expect(() => assertTransition("interrupted", "completed")).toThrowError(RunLifecycleError);
  });

  it("canRestart is true for interrupted, failed and failed_artifact", () => {
    expect(canRestart("interrupted")).toBe(true);
    expect(canRestart("failed")).toBe(true);
    expect(canRestart("failed_artifact")).toBe(true);
    expect(canRestart("generating")).toBe(false);
    expect(canRestart("completed")).toBe(false);
  });
});
