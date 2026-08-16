import { describe, expect, it } from "vitest";

import { buildRunModel } from "@/lib/run-model/reducer";
import { eventPresentation, objectiveHeadline, showsExecutionCounters } from "@/lib/run-model/presentation";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";

const at = "2026-08-15T00:00:00.000Z";

function seed(lifecycle: RunSeed["lifecycle"]): RunSeed {
  return { id: "run-1", title: "T", goal: "Build it", lifecycle, eventSequence: 0 };
}

function event(seq: number, type: string, payload: Record<string, unknown> = {}): RunEvent {
  return { eventId: `e${seq}`, seq, at, runId: "run-1", actor: "system", type, payload };
}

/**
 * Three things the workspace said that were not true.
 *
 * A run that failed planning twelve hours earlier rendered a node badged
 * `RUNNING` reading "Diseñando la solución", under a heading in the present
 * tense — "Construyendo el grafo · 1 nodo identificado" — beside three zeroed
 * counters. Every one of those came from a component filling a gap with a
 * plausible value instead of leaving it empty.
 */
describe("What the objective panel claims", () => {
  it("says the planning never produced a graph when that is what happened", () => {
    expect(objectiveHeadline({
      lifecycle: "failed",
      graphPhase: "provisional",
      nodeCount: 1,
      executableCount: 0,
      completedExecutables: 0
    })).toBe("La planificación se detuvo antes de compilar el grafo");
  });

  it("does not describe planning in the present tense once the run is over", () => {
    // `cancelled` is not a lifecycle this system has; a cancel ends at
    // `interrupted`, and `cancelling` was the state that still read as
    // present-tense planning.
    for (const lifecycle of ["failed", "completed", "cancelling", "interrupted"] as const) {
      expect(objectiveHeadline({
        lifecycle,
        graphPhase: "provisional",
        nodeCount: 2,
        executableCount: 0,
        completedExecutables: 0
      })).not.toContain("Construyendo");
    }
  });

  it("counts identified units while planning is genuinely running", () => {
    expect(objectiveHeadline({
      lifecycle: "planning",
      graphPhase: "provisional",
      nodeCount: 3,
      executableCount: 0,
      completedExecutables: 0
    })).toBe("Planificando · 3 unidades identificadas");
  });

  it("reports progress against the compiled graph", () => {
    expect(objectiveHeadline({
      lifecycle: "completed",
      graphPhase: "compiled",
      nodeCount: 3,
      executableCount: 2,
      completedExecutables: 2
    })).toBe("2 de 2 ejecutables con resultado");
  });

  it("hides the execution counters until there is a compiled graph to count", () => {
    // Three zeros read as "nothing happened" when the truth is "it failed
    // before there was anything to count".
    expect(showsExecutionCounters({ graphPhase: null })).toBe(false);
    expect(showsExecutionCounters({ graphPhase: "provisional" })).toBe(false);
    expect(showsExecutionCounters({ graphPhase: "compiled" })).toBe(true);
  });
});

describe("The graph a run without a plan shows", () => {
  it("draws no unit when planning ended before naming one", () => {
    // The placeholder root is invented by the view — `planning-root:<id>`,
    // titled "Diseñando la solución". On a run that is still planning it
    // stands for work about to be named. On a run that stopped, it stands for
    // nothing, and drawing it claims a unit that never existed.
    const model = buildRunModel(seed("failed"), [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "planning.failed", { reason: "schema_invalid: units" })
    ]);

    expect(model.nodes).toEqual([]);
    expect(model.graph).toBeNull();
  });

  it("keeps the units planning did name, even when it then failed", () => {
    const model = buildRunModel(seed("failed"), [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "planning.attempt_started", { attempt: 1 }),
      event(3, "planning.node_discovered", {
        attempt: 1,
        node: {
          nodeId: "unit:a",
          parentNodeId: null,
          key: "a",
          parentKey: null,
          kind: "composite",
          title: "A",
          objective: "Do A",
          siblingIndex: 0,
          siblingCount: 1
        }
      }),
      event(4, "planning.failed", { reason: "schema_invalid: units" })
    ]);

    // These came from the journal, so they are shown; the failure is reported
    // beside them rather than by erasing them.
    expect(model.nodes.map(({ id }) => id)).toEqual(["unit:a"]);
    expect(model.nodes[0]?.status).toBe("failed");
  });

  it("still shows the placeholder while planning is genuinely under way", () => {
    const model = buildRunModel(seed("planning"), [event(1, "run.created", { goal: "Build it" })]);

    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0]?.status).toBe("running");
  });
});

/**
 * The activity feed printed the effect protocol at the operator: "Effect ·
 * requested", "Effect · observed", "Effect · completed", "Command · accepted"
 * — English, internal, and three lines for one thing happening.
 */
describe("What the activity feed says", () => {
  it.each([
    "effect.requested",
    "effect.observed",
    "effect.completed",
    "effect.failed",
    "command.accepted"
  ])("keeps %s out of the operational narrative", (type) => {
    const presentation = eventPresentation(type);
    expect(presentation.diagnostic).toBe(true);
    expect(presentation.label).not.toContain("Effect");
    expect(presentation.label).not.toContain("Command");
  });

  it("labels every protocol event in the interface language", () => {
    for (const type of ["effect.requested", "effect.completed", "command.accepted"]) {
      expect(eventPresentation(type).label).toMatch(/^[A-ZÁÉÍÓÚÑ]/u);
    }
  });
});
