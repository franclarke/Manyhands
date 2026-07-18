import { describe, expect, it } from "vitest";

import { nodeUiStatus, runUiStatus, statusMeta } from "@/lib/status";

describe("canonical status presentation", () => {
  it("maps node execution facts to the compact visual vocabulary", () => {
    expect(nodeUiStatus("pending")).toBe("pending");
    expect(nodeUiStatus("ready")).toBe("ready");
    expect(nodeUiStatus("running")).toBe("running");
    expect(nodeUiStatus("waiting")).toBe("attention");
    expect(nodeUiStatus("succeeded")).toBe("completed");
    expect(nodeUiStatus("failed")).toBe("failed");
    expect(nodeUiStatus("stale")).toBe("skipped");
  });

  it("maps canonical run lifecycle without legacy aliases", () => {
    expect(runUiStatus("needs_approval")).toBe("attention");
    expect(runUiStatus("result_ready")).toBe("ready");
    expect(runUiStatus("completed")).toBe("completed");
    expect(statusMeta("ready").label).toBe("Listo");
  });
});
