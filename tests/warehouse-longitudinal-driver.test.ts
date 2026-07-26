import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findExecutorModel,
  isExecutorSelection,
  usageSourceForSelection
} from "../packages/shared/src/executor-registry";
import {
  advanceVerifiedBase,
  assertOraclePassed,
  buildLongitudinalPlan,
  evaluatePreflight,
  forkVerifiedChainState,
  seedIdentityMatches,
  STUDY_SELECTION,
  studyStageSelections
} from "../docs/tesis/evidence/scripts/lib/warehouse-longitudinal.mjs";

const valid = {
  freeBytes: 30 * 1024 ** 3,
  minimumFreeBytes: 25 * 1024 ** 3,
  manyHandsDirty: false,
  targetDirty: false,
  targetHead: "a".repeat(40),
  expectedBase: "a".repeat(40),
  seedMatches: true,
  promptHashesMatch: true,
  oracleHashesMatch: true,
  distHasPolicyMarker: true,
  commitMatches: true,
  toolchainMatches: true,
  modelMatches: true
};

describe("Warehouse longitudinal driver", () => {
  it("builds a mutation-free eight-cell dry-run plan", () => {
    const plan = buildLongitudinalPlan({ mode: "pilot", baseSha: "a".repeat(40), targetRepo: "C:/target" });
    expect(plan).toHaveLength(8);
    expect(plan.map((cell) => cell.increment)).toEqual(["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]);
    expect(plan.every((cell) => cell.dryRun === true)).toBe(true);
  });

  it("plans only the remaining increments when resuming a verified chain", () => {
    const plan = buildLongitudinalPlan({ mode: "pilot", baseSha: "b".repeat(40), targetRepo: "C:/target", startAt: 1 });
    expect(plan.map((cell) => cell.increment)).toEqual(["W2", "W3", "W4", "W5", "W6", "W7", "W8"]);
    expect(plan[0]).toMatchObject({ base: "b".repeat(40) });
  });

  it.each([
    ["disk_insufficient", { freeBytes: 24 * 1024 ** 3 }],
    ["target_dirty", { targetDirty: true }],
    ["seed_hash_mismatch", { seedMatches: false }],
    ["prompt_hash_mismatch", { promptHashesMatch: false }],
    ["dist_stale", { distHasPolicyMarker: false }]
  ])("rejects %s before execution", (code, override) => {
    expect(evaluatePreflight({ ...valid, ...override })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code })
    ]));
  });

  it("does not adopt a commit when the external oracle fails", () => {
    expect(() => assertOraclePassed({ outcome: "fail", increment: "W3" })).toThrow(/oracle W3 failed/iu);
  });

  it("adopts the verified delivery as the next increment base", () => {
    expect(advanceVerifiedBase({ currentBase: "a".repeat(40), deliveredSha: "b".repeat(40), oracleOutcome: "pass" }))
      .toBe("b".repeat(40));
  });

  it("forks only the verified prefix of a prior longitudinal chain", () => {
    const fork = forkVerifiedChainState({
      schemaVersion: 1,
      currentBase: "b".repeat(40),
      completed: [{ increment: "W1", baseSha: "a".repeat(40), deliveredSha: "b".repeat(40), oracleId: "warehouse-w1-v1", stateHash: "sha256:state" }],
      manyHandsCommits: ["c".repeat(40)]
    });

    expect(fork).toMatchObject({ currentBase: "b".repeat(40), completed: [{ increment: "W1" }] });
    expect(fork).not.toBe(fork.completed);
  });

  it("verifies a cloned seed by Git objects instead of checkout line endings", () => {
    expect(seedIdentityMatches({
      tree: "a".repeat(40),
      expectedTree: "a".repeat(40),
      lockfileGitBlob: "b".repeat(40),
      expectedLockfileGitBlob: "b".repeat(40)
    })).toBe(true);
  });
});

/**
 * Cost and tokens are primary variables of the study. An executor whose CLI
 * cannot report them turns both into lower bounds — G5 already carries one cell
 * with a missing attempt, so its token total is a floor and not a measurement.
 * The declared study executor must be able to report what the study claims.
 */
describe("Warehouse study executor selection", () => {
  it("declares a selection the executor registry knows", () => {
    expect(isExecutorSelection(STUDY_SELECTION)).toBe(true);
    expect(findExecutorModel(STUDY_SELECTION)).toBeDefined();
  });

  /**
   * The study first required a reporting executor so cost would be measurable.
   * Capacity then turned out to bind harder than telemetry, and the selection
   * moved back to Codex, which reports nothing. That trade is allowed — but it
   * may never be silent: if the declared executor cannot report usage, the
   * module that declares it has to say so, because the thesis then reports
   * tokens as a floor and cost as unavailable.
   */
  it("states the telemetry consequence whenever the executor cannot report usage", async () => {
    const usage = usageSourceForSelection(STUDY_SELECTION);
    if (usage === "reported") return;

    const source = await readFile(path.resolve("docs/tesis/evidence/scripts/lib/warehouse-longitudinal.mjs"), "utf8");
    const declaration = source.slice(0, source.indexOf("export const STUDY_SELECTION"));

    expect(declaration).toMatch(/unavailable/u);
    expect(declaration).toMatch(/lower bound|floor/u);
  });

  it("carries a reasoning effort only when the model exposes one", () => {
    const model = findExecutorModel(STUDY_SELECTION);

    if (model?.efforts === null) {
      expect(STUDY_SELECTION).not.toHaveProperty("effort");
    } else {
      expect(model?.efforts).toContain(STUDY_SELECTION.effort);
    }
  });

  it("uses one identical selection for planning, execution and repair", () => {
    expect(studyStageSelections()).toEqual({
      planningSelection: STUDY_SELECTION,
      executionSelection: STUDY_SELECTION,
      repairSelection: STUDY_SELECTION
    });
  });
});
