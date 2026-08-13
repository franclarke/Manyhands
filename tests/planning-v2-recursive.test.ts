import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecursivePlanner, compileGraphRevision, type CutRequest } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * Stage 3C of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * The productive host plans by cutting one unit at a time. A resolved unit is
 * the durable node fact the journal already records, so the redesigned path
 * reuses it instead of inventing a second way to say the same thing; only a
 * unit that could not be cut needed a new event.
 */

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };
const BASE = { repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-recursive-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

/** Every source path the booking snapshot indexes, which is what the root reads. */
function snapshotPaths(): string[] {
  return (bookingSnapshot().index?.files ?? []).map((file) => file.path);
}

function plannerFor(script: Record<string, unknown>, budget: number) {
  const seen: CutRequest[] = [];
  const planner = new RecursivePlanner({
    model: {
      async proposeCut(request) {
        seen.push(request);
        const answer = script[request.unit.key];
        if (answer === undefined) throw new Error(`no scripted cut for ${request.unit.key}`);
        return JSON.stringify(answer);
      }
    },
    budget: { maxScopePaths: budget },
    maxAttemptsPerUnit: 2
  });
  return { planner, seen };
}

async function planWith(runId: string, script: Record<string, unknown>, budget: number) {
  const events = new JsonlRunEventStore({ directory });
  const snapshots = new RunSnapshotStore({ directory, events });
  const { planner, seen } = plannerFor(script, budget);
  const state = await runPlanningV2({ ...BASE, runId, goal: "Add booking cancellation" }, {
    events, snapshots,
    inspect: async () => bookingSnapshot(),
    recursivePlanner: planner,
    compile: (input) => compileGraphRevision(input, compilerDependencies),
    now: () => "2026-07-17T01:00:00.000Z"
  }).catch((error: unknown) => error as Error);
  const journal = await events.load(runId);
  return { state, seen, journal, types: journal.map((entry) => entry.type) };
}

describe("productive planning with the recursive planner", () => {
  it("cuts the root, records every resolved unit and compiles the graph", async () => {
    const paths = snapshotPaths();
    expect(paths.length).toBeGreaterThan(2);
    const { state, seen, types, journal } = await planWith("run-recursive-ok", {
      root: {
        rationale: "Domain and its exposure are separately verifiable",
        children: [
          { key: "domain", objective: "Cancel a booking in the domain", criterion: "The domain cancels a booking", reads: [paths[0]!], writes: ["test/domain-cancel.test.ts"] },
          { key: "surface", objective: "Expose cancellation", criterion: "The surface exposes cancellation", reads: [paths[1]!], writes: ["test/surface-cancel.test.ts"] }
        ]
      }
    }, 2);

    expect(state).not.toBeInstanceOf(Error);
    expect(seen.map((request) => request.unit.key)).toEqual(["root"]);
    expect(types).toContain("planning.node_discovered");
    expect(types).toContain("planning.completed");
    expect(types).toContain("graph.compiled");
    expect(types).not.toContain("planning.unit_unresolved");

    const discovered = journal
      .filter((entry) => entry.type === "planning.node_discovered")
      .map((entry) => (entry.payload as { node: { key: string; kind: string; parentKey: string | null } }).node);
    expect(discovered.map((node) => node.key)).toEqual(["root", "domain", "surface"]);
    expect(discovered[0]).toMatchObject({ kind: "composite", parentKey: null });
    expect(discovered[1]).toMatchObject({ kind: "leaf", parentKey: "root" });
  });

  /**
   * The root arrives with reads and no writes, so it proves nothing on its own
   * no matter how generous the budget is. Accepting it as a leaf would compile
   * a plan whose single unit promises no output, and the run could only end in
   * "leaf produced no diff".
   */
  it("cuts the root even under a budget it fits, because the root proves nothing", async () => {
    const paths = snapshotPaths();
    const { state, seen, types } = await planWith("run-recursive-generous-budget", {
      root: {
        rationale: "The goal still needs units that can prove it",
        children: [
          { key: "domain", objective: "Cancel in the domain", criterion: "The domain cancels", reads: [paths[0]!], writes: ["test/domain-cancel.test.ts"] },
          { key: "surface", objective: "Expose cancellation", criterion: "The surface exposes it", reads: [paths[1]!], writes: ["test/surface-cancel.test.ts"] }
        ]
      }
    }, 500);

    expect(state).not.toBeInstanceOf(Error);
    expect(seen.map((request) => request.unit.key)).toEqual(["root"]);
    expect(types).toContain("planning.completed");
  });

  /**
   * Stage 3D. The utility formula keeps being measured — it is what lets the
   * thesis say why a scalar could not decide granularity — but it no longer
   * decides anything. The tree that compiles is the one the fixpoint produced.
   */
  it("persists a granularity assessment and applies it to the plan that compiles", async () => {
    const paths = snapshotPaths();
    const { journal, types } = await planWith("run-recursive-observed", {
      root: {
        rationale: "Domain and its exposure are separately verifiable",
        children: [
          { key: "domain", objective: "Cancel in the domain", criterion: "The domain cancels", reads: [paths[0]!], writes: ["test/domain-cancel.test.ts"] },
          { key: "surface", objective: "Expose cancellation", criterion: "The surface exposes it", reads: [paths[1]!], writes: ["test/surface-cancel.test.ts"] }
        ]
      }
    }, 2);

    expect(types).toContain("planning.granularity_strategy_selected");
    const assessed = journal.find((entry) => entry.type === "planning.granularity_strategy_selected")!
      .payload as { assessments: { unitKey: string }[]; policyVersion: string };
    expect(assessed.policyVersion).toContain("granularity/");
    expect(assessed.assessments.map((item) => item.unitKey).sort()).toEqual(["domain", "root", "surface"]);

    // The compiled graph is the fixpoint's tree, whatever the formula scored:
    // node ids are derived from the planner's keys.
    const compiled = journal.find((entry) => entry.type === "graph.compiled")!.payload as unknown as {
      graph: { nodes: Record<string, unknown> };
    };
    expect(Object.keys(compiled.graph.nodes).sort()).toEqual(["node-domain", "node-root", "node-surface"]);
  });

  it("records the repair diagnostics the validator produced, verbatim", async () => {
    const paths = snapshotPaths();
    const { journal, seen } = await planWith("run-recursive-repair", {
      // Two children writing one path: P2 rejects the cut and the repair carries
      // the exact reason back to the model.
      root: {
        rationale: "Both children own the same test",
        children: [
          { key: "domain", objective: "Cancel in the domain", criterion: "The domain cancels", reads: [paths[0]!], writes: ["test/shared.test.ts"] },
          { key: "surface", objective: "Expose cancellation", criterion: "The surface exposes it", reads: [paths[1]!], writes: ["test/shared.test.ts"] }
        ]
      }
    }, 2);

    const failures = journal.filter((entry) => entry.type === "planning.attempt_failed");
    expect(failures.length).toBeGreaterThan(0);
    expect((failures[0]!.payload as { reason: string }).reason).toContain("P2");
    expect(seen[1]!.repairIssues.join(" ")).toContain("test/shared.test.ts");
  });

  it("records the unit it could not cut, in place, with the blocking property", async () => {
    const { journal } = await planWith("run-recursive-unresolved", {
      root: { rationale: "no", children: "not an array" }
    }, 2);

    const unresolved = journal.filter((entry) => entry.type === "planning.unit_unresolved");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.payload).toMatchObject({ key: "root", parentKey: null, depth: 0 });
    expect((unresolved[0]!.payload as { diagnostics: string[] }).diagnostics.join(" ")).toContain("children");
    // The run does not pretend to have a plan it could not build.
    expect(journal.map((entry) => entry.type)).not.toContain("graph.compiled");
    expect(journal.map((entry) => entry.type)).toContain("planning.failed");
  });
});
