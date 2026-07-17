import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectResultReadiness } from "@/lib/run-model/selectors";
import type { RunConfig, RunEvent } from "@/lib/run-model/types";

const config: RunConfig = { aggressiveness: "medium", planningModel: "m", executionSelection: { executorId: "e", model: "m" }, repairSelection: { executorId: "e", model: "m" } };
describe("result readiness", () => {
  it("shows uncovered criteria and blocks delivery approval", () => {
    const initial = createInitialRunModel({ id: "run-1", intent: "Build", workspaceId: "ws", config });
    const model = reduceRunEvents(initial, [event(1, "evidence.matrix_recorded", { matrix: { matrixId: "matrix-1", candidateCommit: "sha", validationContract: { id: "validation", revision: "r1" }, criteria: [{ criterionId: "booking-works", obligationId: "booking", status: "uncovered", justification: "No browser evidence", evidenceRefs: [] }], outcome: "unverified" } })]);
    const result = selectResultReadiness(model);
    expect(result.deliveryAllowed).toBe(false);
    expect(result.uncovered.map((criterion) => criterion.criterionId)).toEqual(["booking-works"]);
  });
});
function event(seq: number, type: string, payload: Record<string, unknown>): RunEvent { return { seq, at: "2026-07-17T00:00:00.000Z", runId: "run-1", actor: "system", type, payload }; }
