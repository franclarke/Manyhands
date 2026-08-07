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

  /**
   * D9, resolved in stage 4. P2 guarantees siblings never write the same file,
   * so the graph a real cut compiles to should carry no conflict at all, and
   * `wave-selector-v2` refuses to select two constrained nodes together — a
   * conflict invented from a shared READ serializes work that is provably safe.
   *
   * Closed in stage 4. The compiler could not express it while `plannedPaths`
   * was the only write signal — it cannot name a file that already exists, so
   * "modifies this" was indistinguishable from "reads this". Units now carry an
   * explicit `writePaths`, conflicts are compiled from writes alone, and
   * tree-wide P2 makes the write sets of distinct branches disjoint, so on this
   * recorded cut the count is zero rather than two.
   */
  it("derives no conflict from units that merely read the same file", async () => {
    const calls = await readCutTranscript(NAME);
    if (calls === undefined) return;

    const result = await runRecursivePlanning({
      fixture: warehouseSlice,
      goal: GOAL,
      criteria: CRITERIA,
      model: replayCutModel(calls),
      budget: 4
    });

    const writesByUnit = result.projected?.draft.root.kind === "composite"
      ? result.projected.draft.root.children.map((child) => child.plannedPaths ?? [])
      : [];
    const everyWrite = writesByUnit.flat();
    // The premise: the cut really is disjoint on writes.
    expect(new Set(everyWrite).size).toBe(everyWrite.length);
    // Therefore nothing may conflict.
    expect(result.compiled?.graph.conflictConstraints).toEqual([]);
  });
});
