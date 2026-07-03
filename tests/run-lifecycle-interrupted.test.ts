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

  it("rejects interrupted → completed", () => {
    expect(() => assertTransition("interrupted", "completed")).toThrowError(RunLifecycleError);
  });

  it("canRestart is true for interrupted and failed", () => {
    expect(canRestart("interrupted")).toBe(true);
    expect(canRestart("failed")).toBe(true);
    expect(canRestart("generating")).toBe(false);
    expect(canRestart("completed")).toBe(false);
  });
});
