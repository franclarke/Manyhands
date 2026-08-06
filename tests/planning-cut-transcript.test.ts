import { afterAll, describe, expect, it } from "vitest";
import { warehouseSlice } from "./fixtures/planning/warehouse-slice";
import {
  liveCutModel,
  readCutTranscript,
  releaseFixtures,
  replayCutModel,
  runRecursivePlanning,
  writeCutTranscript
} from "./helpers/planning-harness";

/**
 * Does a real model answer the five-field cut contract?
 *
 * Every other test in the redesign uses a hand-written stub, so the central
 * claim — that the old contract was unpayable for a small model and this one is
 * not — was still a hypothesis. This records what Claude Haiku actually answers
 * and replays it offline afterwards.
 *
 * Record with:  MANYHANDS_HARNESS_LIVE=1 pnpm vitest run tests/planning-cut-transcript.test.ts
 */

afterAll(releaseFixtures);

const NAME = "warehouse-slice-backorders";
const GOAL = "Record a backorder when an order exceeds available stock and expose it through the API.";
const CRITERIA = [{ id: "criterion-1", description: GOAL, required: true }];
const LIVE = process.env.MANYHANDS_HARNESS_LIVE === "1";

describe("the cut contract against a real model", () => {
  it.runIf(LIVE)("records what Claude Haiku answers", async () => {
    const model = liveCutModel("haiku");
    const result = await runRecursivePlanning({
      fixture: warehouseSlice,
      goal: GOAL,
      criteria: CRITERIA,
      model,
      budget: 4
    });

    const target = await writeCutTranscript(NAME, model.calls);
    // Diagnostics first: a failed recording must say why, not just fail.
    for (const call of model.calls) {
      process.stdout.write(`\n[cut ${call.unitKey} attempt ${call.attempt}]\n${call.response}\n`);
    }
    for (const node of result.plan.unresolved) {
      process.stdout.write(`\n[unresolved ${node.unit.key}]\n- ${node.diagnostics.join("\n- ")}\n`);
    }
    process.stdout.write(`\ntranscript: ${target}\n`);

    expect(model.calls.length).toBeGreaterThan(0);
  }, 300_000);

  it("replays the recorded transcript and reaches a compiled graph", async () => {
    const calls = await readCutTranscript(NAME);
    if (calls === undefined) {
      // No transcript yet: the claim is untested rather than false, and saying
      // so is more useful than a green test that exercised nothing.
      expect(LIVE).toBe(false);
      return;
    }

    const result = await runRecursivePlanning({
      fixture: warehouseSlice,
      goal: GOAL,
      criteria: CRITERIA,
      model: replayCutModel(calls),
      budget: 4
    });

    expect(result.plan.unresolved).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(Object.keys(result.compiled?.graph.nodes ?? {}).length).toBeGreaterThanOrEqual(3);
  });
});
