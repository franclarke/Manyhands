import { describe, expect, it } from "vitest";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { computeTopologicalLevels, type GraphRevision } from "@manyhands/task-graph";
import { compileGraphRevision } from "@manyhands/decomposer";

import { bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { bookingBreakdown } from "./helpers/target-planning-fixtures";

/**
 * Stage 4 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * A wave stopped being a mechanism and survives as a derived fact: the
 * topological level of a node, its longest path from the start of the run. It
 * is presentational — the flow layout bands by it — and the runtime never
 * synchronises on it. That is the whole difference from the barrier it
 * replaced.
 */

function graph(input: {
  nodes: Array<{ id: string; parentId?: string | null; kind?: "root" | "composite" | "leaf" }>;
  requirements?: Array<{ producer: string; consumer: string }>;
}): GraphRevision {
  return {
    schemaVersion: 2,
    graphId: "g",
    revision: 1,
    rootId: input.nodes[0]!.id,
    baseCommit: "1".repeat(40),
    repositorySnapshotId: "sha256:snap",
    nodes: Object.fromEntries(input.nodes.map((node) => [node.id, {
      id: node.id,
      parentId: node.parentId ?? null,
      kind: node.kind ?? "leaf",
      title: node.id,
      goal: node.id
    }])),
    artifactRequirements: (input.requirements ?? []).map(({ producer, consumer }) => ({
      id: `req-${producer}-${consumer}`,
      artifactContract: { id: `artifact:${producer}`, revision: "r1" },
      producerNodeId: producer,
      consumerNodeId: consumer,
      requiredFor: "execution" as const
    })),
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: [],
    createdAt: "2026-08-07T00:00:00.000Z"
  } as GraphRevision;
}

describe("topological level", () => {
  it("puts everything that can start at once on level zero", () => {
    const levels = computeTopologicalLevels(graph({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }]
    }));

    expect(levels).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("places a consumer one level past the producer it waits for", () => {
    const levels = computeTopologicalLevels(graph({
      nodes: [{ id: "domain" }, { id: "api" }, { id: "ui" }],
      requirements: [{ producer: "domain", consumer: "api" }, { producer: "api", consumer: "ui" }]
    }));

    expect(levels).toEqual({ domain: 0, api: 1, ui: 2 });
  });

  /**
   * The longest path, not the shortest: a node is only reachable once its
   * slowest predecessor chain has completed, and banding by the shortest path
   * would draw it as available earlier than it can ever be.
   */
  it("uses the longest path when a node has predecessors of different depths", () => {
    const levels = computeTopologicalLevels(graph({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      requirements: [
        { producer: "a", consumer: "b" },
        { producer: "b", consumer: "c" },
        { producer: "a", consumer: "c" },
        { producer: "c", consumer: "d" }
      ]
    }));

    expect(levels.c).toBe(2);
    expect(levels.d).toBe(3);
  });

  /**
   * A composite is ready once its children are adopted, so containment orders
   * it just as a dependency does. Ignoring it would band a parent alongside — or
   * before — the children it integrates.
   */
  it("places a composite after the children it integrates", () => {
    const levels = computeTopologicalLevels(graph({
      nodes: [
        { id: "root", parentId: null, kind: "root" },
        { id: "left", parentId: "root" },
        { id: "right", parentId: "root" }
      ],
      requirements: [{ producer: "left", consumer: "right" }]
    }));

    expect(levels.left).toBe(0);
    expect(levels.right).toBe(1);
    expect(levels.root).toBe(2);
  });

  /**
   * The compiler's critics reject a cycle, but this runs on any graph it is
   * handed. Looping forever on a malformed one would turn a presentational
   * detail into a hang, so it refuses instead.
   */
  it("refuses a cyclic graph rather than looping", () => {
    expect(() => computeTopologicalLevels(graph({
      nodes: [{ id: "a" }, { id: "b" }],
      requirements: [{ producer: "a", consumer: "b" }, { producer: "b", consumer: "a" }]
    }))).toThrow(/cycle/iu);
  });
});

describe("topological level as a compiled, inert fact", () => {
  it("is persisted on every compiled node", () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );

    const levels = Object.values(compiled.graph.nodes).map((node) => node.topologicalLevel);
    expect(levels.every((level) => typeof level === "number")).toBe(true);
    // The root integrates everything below it, so nothing may share its band.
    const rootLevel = compiled.graph.nodes[compiled.graph.rootId]!.topologicalLevel!;
    expect(Math.max(...levels as number[])).toBe(rootLevel);
  });

  /**
   * The acceptance clause of stage 4, enforced rather than asserted in prose:
   * the runtime must never synchronise on the level. A wave that decides
   * anything is the barrier we removed, and it would come back as a read.
   */
  it("is read by nothing that schedules, dispatches or decides", async () => {
    // Whole packages rather than a hand-listed set of files, so a new runtime
    // module is covered the day it is written instead of the day someone
    // remembers to add it here.
    const runtimePackages = ["scheduler", "orchestrator-graph", "run-coordinator", "execution-core"];
    const offenders: string[] = [];

    for (const name of runtimePackages) {
      const root = path.join(process.cwd(), "packages", name, "src");
      for (const file of await sourceFilesUnder(root)) {
        if ((await readFile(file, "utf8")).includes("topologicalLevel")) {
          offenders.push(path.relative(process.cwd(), file).replaceAll("\\", "/"));
        }
      }
    }

    expect(offenders, "the runtime must never synchronise on a wave").toEqual([]);
  });
});

async function sourceFilesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  }));
  return files.flat();
}
