import { describe, expect, it } from "vitest";
import { parseCodexOutcome } from "@manyhands/execution-core";

/**
 * Codex reports what a run consumed on its own stdout, but nothing read it, so
 * every attempt was journaled as `source: "unavailable"` and RQ2 — the cost
 * side of the granularity trade-off — had no data at all. The numbers were
 * there the whole time.
 *
 * The parser must be total: an output that does not carry the report leaves the
 * outcome untouched rather than inventing a zero, because a fabricated zero and
 * a measured zero would be indistinguishable downstream.
 */
const base = {
  exitCode: 0,
  durationMs: 1000,
  timedOut: false,
  stderr: "",
  stdout: ""
};

describe("Codex usage parsing", () => {
  it("reads the token total the CLI reports", () => {
    const parsed = parseCodexOutcome({
      ...base,
      stdout: ["codex", "Done.", "tokens used", "15,493", ""].join("\n")
    });

    expect(parsed.tokensIn).toBeUndefined();
    expect(parsed.tokensOut).toBeUndefined();
    expect(parsed.tokensTotal).toBe(15493);
  });

  it("reads a total reported on the same line", () => {
    const parsed = parseCodexOutcome({ ...base, stdout: "tokens used: 2048\n" });

    expect(parsed.tokensTotal).toBe(2048);
  });

  it("takes the last report when the CLI printed several", () => {
    // Codex prints a running total; the final one is the run's consumption.
    const parsed = parseCodexOutcome({
      ...base,
      stdout: ["tokens used", "100", "more work", "tokens used", "4,200"].join("\n")
    });

    expect(parsed.tokensTotal).toBe(4200);
  });

  it("leaves the outcome untouched when no usage was reported", () => {
    const outcome = { ...base, stdout: "codex\nDone.\n" };

    expect(parseCodexOutcome(outcome)).toEqual(outcome);
  });

  it("ignores a malformed report rather than guessing", () => {
    const outcome = { ...base, stdout: "tokens used\nlots\n" };

    expect(parseCodexOutcome(outcome).tokensTotal).toBeUndefined();
  });

  it("reads the report when the CLI wrote it to stderr", () => {
    // Observed in a real run: usage was journaled as unavailable because the
    // report did not arrive on stdout. Which stream carries it is the CLI's
    // choice, not a reason to lose the measurement.
    const parsed = parseCodexOutcome({ ...base, stderr: "tokens used\n8,192\n" });

    expect(parsed.tokensTotal).toBe(8192);
  });
});
