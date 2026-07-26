/**
 * C — StatusPill status language: the dot speaks the same shape vocabulary as the
 * DAG node "Glyph dial". A not-started state (idle / pending / skipped) renders as a
 * HOLLOW dot ("empty = no arrancado"); every other state is a filled dot. This is the
 * one shape distinction that survives at the pill's 4–6px dot size; failed/conflict
 * stay filled (the rust colour + mandatory label carry them — a square doesn't read
 * that small). The mapping lives on STATUS_META so it is a single source of truth.
 */
import { describe, expect, it } from "vitest";
import { STATUS_META, type UiStatus } from "@/lib/status";

const NOT_STARTED: UiStatus[] = ["idle", "pending", "skipped"];

describe("StatusPill — hollow (not-started) dot language", () => {
  it("marks not-started states as hollow", () => {
    for (const status of NOT_STARTED) {
      expect(STATUS_META[status].hollow).toBe(true);
    }
  });

  it("marks every other state as a filled dot", () => {
    for (const key of Object.keys(STATUS_META) as UiStatus[]) {
      if (!NOT_STARTED.includes(key)) {
        expect(STATUS_META[key].hollow).toBe(false);
      }
    }
  });

  it("keeps failed and attention states filled (colour + label carry them, not shape)", () => {
    expect(STATUS_META.failed.hollow).toBe(false);
    expect(STATUS_META.attention.hollow).toBe(false);
  });
});
