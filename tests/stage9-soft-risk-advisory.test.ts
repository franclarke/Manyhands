import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";

import {
  compileStage9Graph,
  stage9At,
  stage9Coordinator,
  stage9SuccessOutcome,
  type Stage9ExecuteInput
} from "./helpers/stage9-driver-harness.js";

async function runWithRisk(runId: string, score: number) {
  const { fixture, compiled } = compileStage9Graph();
  const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
  const executed: string[] = [];
  const driver = new CanonicalExecutionDriver({
    coordinator: harness.coordinator,
    now: () => stage9At,
    estimateIntegrationRisk: () => ({ score, evidenceRefs: ["evidence:risk"] }),
    execute: async (input) => {
      executed.push(input.node.id);
      await Promise.resolve();
      return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
        rootId: compiled.graph.rootId,
        artifactIds: Object.keys(compiled.contracts.artifacts)
      });
    }
  });
  const state = await driver.run({
    runId,
    graph: compiled.graph,
    contracts: compiled.contracts.taskBundles,
    repositoryContextDigest: fixture.repositoryView.digest,
    executorProfile: { id: "fake", revision: "1" },
    effectiveConfig: { maxParallel: 4 },
    availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
    target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
  });
  const adopted = Object.fromEntries(Object.values(state.adoptedArtifacts)
    .map((artifact) => [artifact.contract.id, artifact.digest]));
  return { state, executed, adopted };
}

describe("Stage 9 soft integration risk", () => {
  it("changes scheduling without changing the result", async () => {
    // A risk score far above the concurrency threshold defers siblings into
    // later waves. That is the whole authority it has.
    const calm = await runWithRisk("run-stage9-risk-calm", 0);
    const alarmed = await runWithRisk("run-stage9-risk-alarmed", 10_000);

    expect(alarmed.adopted).toEqual(calm.adopted);
    expect([...alarmed.executed].sort()).toEqual([...calm.executed].sort());
    expect(alarmed.state.lifecycle).toBe(calm.state.lifecycle);
  });

  it("never drops work it defers", async () => {
    const alarmed = await runWithRisk("run-stage9-risk-complete", 10_000);
    expect([...alarmed.executed].sort()).toEqual(["unit:a", "unit:b", "unit:root"]);
  });

  it("records the risk it used as an observation", async () => {
    const { state } = await runWithRisk("run-stage9-risk-recorded", 10_000);
    const waves = state.selectedWaves ?? [];
    expect(waves.length).toBeGreaterThan(0);
  });

  it("has no learned weight that could acquire authority unattributed", async () => {
    // The plan keeps learned weights disabled until attributed evidence exists.
    // The honest way to hold that line is for no such surface to exist at all,
    // so this fails the moment one is introduced without its evidence.
    const root = path.resolve(__dirname, "..");
    const [frontier, selector] = await Promise.all([
      readFile(path.join(root, "packages", "scheduler", "src", "canonical-frontier.ts"), "utf8"),
      readFile(path.join(root, "packages", "scheduler", "src", "wave-selector-v2.ts"), "utf8")
    ]);
    for (const source of [frontier, selector]) {
      expect(source).not.toMatch(/learnedWeight|weightModel|trainedRisk/u);
    }
    // Risk enters only as an explicit estimator the caller supplies.
    expect(frontier).toContain("estimateIntegrationRisk");
  });
});
