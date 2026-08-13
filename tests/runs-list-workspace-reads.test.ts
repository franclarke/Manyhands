import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ list: vi.fn(), indexById: vi.fn(async () => new Map()) }));
vi.mock("@/lib/server/daemon/productive-client", () => ({ listProductRuns: state.list }));
vi.mock("@/lib/server/workspaces", () => ({
  getWorkspaceRepository: () => ({ indexById: state.indexById })
}));

import { GET as GET_RUNS } from "@/app/api/runs/route";

describe("GET /api/runs workspace reads", () => {
  it("performs one workspace index read for a daemon-backed listing", async () => {
    state.list.mockResolvedValueOnce([]);
    const response = await GET_RUNS(new Request("http://localhost/api/runs?limit=5"));
    expect(response.status).toBe(200);
    expect(state.indexById).toHaveBeenCalledTimes(1);
  });
});
