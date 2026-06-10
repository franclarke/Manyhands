import { describe, expect, it } from "vitest";
import { nodeUiStatus, runUiStatus, statusMeta } from "@/lib/status";

describe("status presentation", () => {
  it("maps node statuses to the unified visual vocabulary", () => {
    expect(nodeUiStatus("planned")).toBe("pending");
    expect(nodeUiStatus("ready")).toBe("ready");
    expect(nodeUiStatus("running")).toBe("running");
    expect(nodeUiStatus("blocked")).toBe("blocked");
    expect(nodeUiStatus("needs_review")).toBe("needs_review");
    expect(nodeUiStatus("done")).toBe("completed");
    expect(nodeUiStatus("failed")).toBe("failed");
    expect(nodeUiStatus("integrated")).toBe("integrated");
  });

  it("surfaces approved runs as ready rather than review", () => {
    expect(runUiStatus("approved")).toBe("ready");
  });

  it("defines labels for ready and integrated states", () => {
    expect(statusMeta("ready").label).toBe("Listo");
    expect(statusMeta("integrated").label).toBe("Integrado");
  });
});
