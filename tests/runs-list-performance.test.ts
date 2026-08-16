import type { ProductRunDefinition, RunProjection } from "@manyhands/run-coordinator";
import { beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/server/daemon/productive-client", () => ({ listProductRuns: daemon.list }));
vi.mock("@/lib/server/workspaces", () => ({
  getWorkspaceRepository: () => ({ indexById: async () => new Map() })
}));

import { GET as GET_RUNS } from "@/app/api/runs/route";

beforeEach(() => daemon.list.mockReset());

describe("GET /api/runs daemon projection path", () => {
  it("requests the bounded recent-run slice without touching the legacy cache", async () => {
    daemon.list.mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => projection(index)));
    const response = await GET_RUNS(new Request("http://localhost/api/runs?limit=5"));
    expect(response.status).toBe(200);
    expect((await response.json()).runs).toHaveLength(5);
    expect(daemon.list).toHaveBeenCalledWith({ includeArchived: false, limit: 5 });
  });

  it("ignores retired diagnostics flags while querying only the daemon", async () => {
    daemon.list.mockResolvedValueOnce([]);
    expect((await GET_RUNS(new Request("http://localhost/api/runs?diagnostics=refresh"))).status).toBe(200);
    expect(daemon.list).toHaveBeenCalledTimes(1);
  });
});

function projection(index: number): RunProjection {
  const definition: ProductRunDefinition = {
    schemaVersion: 1, workspaceId: "missing-workspace", userPrompt: `run-${index}`,
    acceptanceCriteria: [], title: `run-${index}`,
    planningSelection: { executorId: "fake", model: "fake" },
    executionSelection: { executorId: "fake", model: "fake" },
    repairSelection: { executorId: "fake", model: "fake" }, executionConfig: {}, targetContext: {}
  };
  return {
    runId: `run-${index}`, goal: definition.userPrompt, definition, lifecycle: "completed", sequence: 1,
    createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    appliedEventIds: [], commandReceipts: {}, commandEnvelopes: {}, effectIntents: {},
    physicalEffectReceipts: {}, effectTerminals: {}, decisions: {}, humanReviews: {},
    readiness: { readyNodeIds: [], pendingDecisionIds: [] }, selectedWaves: [], attempts: {},
    adoptedArtifacts: {}, nodeEvidenceMatrixIds: {}, integrations: {}, recoveryHistory: [],
    evidenceMatrices: [], evidenceMatrixSummaries: {},
    outcomes: { execution: "succeeded", artifact: "verified", delivery: "not_started" }
  };
}
