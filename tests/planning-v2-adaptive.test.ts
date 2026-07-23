import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTIVE_GRANULARITY_FORMULA_VERSION, compileGraphRevision, type GraphCompilerInput } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * Vertical slice for gate G3: the productive planning pipeline must invoke the
 * adaptive C_task policy between the semantic Planner and the Graph Compiler,
 * persist the per-node evidence as a domain event, and survive replay.
 */

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-adaptive-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("adaptive granularity in the productive planning pipeline", () => {
  it("assesses C_task between plan() and compile(), persists it, and replay explains every node", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const compile = vi.fn((input: GraphCompilerInput) => compileGraphRevision(input, compilerDependencies));

    const result = await runPlanningV2({
      runId: "run-adaptive",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-23T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("needs_approval");

    // 1. The event is persisted in the canonical journal.
    const persisted = await events.load("run-adaptive");
    const types = persisted.map((event) => event.type);
    expect(types).toContain("planning.granularity_assessed");
    expect(types.indexOf("planning.granularity_assessed")).toBeGreaterThan(types.indexOf("planning.completed"));
    expect(types.indexOf("planning.granularity_assessed")).toBeLessThan(types.indexOf("graph.compiled"));

    // 2. The Graph Compiler consumed the adaptive breakdown (same canonical
    //    WorkUnit tree type — no parallel model).
    expect(compile).toHaveBeenCalledTimes(1);
    const compiledBreakdown = compile.mock.calls[0]![0].breakdown;
    expect(compiledBreakdown.root.key).toBe("booking");

    // 3. Replay from the journal reconstructs the explanation per node.
    const replayed = foldRun(persisted);
    expect(replayed.granularity?.formulaVersion).toBe(ADAPTIVE_GRANULARITY_FORMULA_VERSION);
    const graphCompiled = persisted.find((event) => event.type === "graph.compiled");
    const nodeIds = graphCompiled?.type === "graph.compiled" ? Object.keys(graphCompiled.payload.graph.nodes as Record<string, unknown>) : [];
    expect(nodeIds.length).toBeGreaterThan(0);
    for (const nodeId of nodeIds) {
      const assessment = replayed.granularity?.assessments[nodeId];
      expect(assessment, `node ${nodeId} must have a persisted C_task assessment`).toBeDefined();
      expect(assessment?.rationale.length).toBeGreaterThan(0);
      expect(["leaf", "composite"]).toContain(assessment?.decision);
    }

    // 4. The snapshot projection carries the same explanation (UI surface).
    const snapshotState = await snapshots.loadOrRebuild("run-adaptive", authority);
    expect(snapshotState.granularity?.formulaVersion).toBe(ADAPTIVE_GRANULARITY_FORMULA_VERSION);

    // 5. The structural thesis metrics are persisted as a diagnostic artifact
    //    keyed by run, without governing lifecycle.
    const metricsRaw = await readFile(path.join(directory, "run-adaptive.granularity-metrics.json"), "utf8");
    const metrics = JSON.parse(metricsRaw) as Record<string, unknown>;
    expect(metrics.runId).toBe("run-adaptive");
    expect(metrics.formulaVersion).toBe(ADAPTIVE_GRANULARITY_FORMULA_VERSION);
    expect((metrics.metrics as Record<string, unknown>).totalLeafCount).toBe(3);
  });
});
