import { describe, expect, it } from "vitest";
import { checkProbeOutput } from "../docs/tesis/evidence/warehouse/oracles/oracle-core.mjs";
import {
  CAPABILITY_CHAIN,
  capabilitiesFor,
  referenceProbeOutput
} from "../docs/tesis/evidence/warehouse/oracles/probe-specimen.mjs";

const increments = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);

/** Mutations of a valid probe output that the oracle MUST reject. */
function mutationsFor(increment: string): Array<{ label: string; mutate: (output: any) => void }> {
  const capabilities = capabilitiesFor(increment);
  return [
    {
      label: "capability hoisted out of `capabilities` (the W1 series-2 failure)",
      mutate: (output) => {
        const [first] = capabilities;
        output[first] = output.capabilities[first];
        delete output.capabilities[first];
      }
    },
    {
      label: "stateHash without the sha256: prefix",
      mutate: (output) => {
        output.stateHash = output.stateHash.replace("sha256:", "");
      }
    },
    {
      label: "stateHash with uppercase hex",
      mutate: (output) => {
        output.stateHash = output.stateHash.toUpperCase().replace("SHA256:", "sha256:");
      }
    },
    {
      label: "wrong schemaVersion",
      mutate: (output) => {
        output.schemaVersion = 2;
      }
    },
    {
      label: "wrong increment",
      mutate: (output) => {
        output.increment = "W9";
      }
    },
    {
      label: "wrong scenario",
      mutate: (output) => {
        output.scenario = "other-scenario";
      }
    },
    {
      label: "a required capability removed",
      mutate: (output) => {
        delete output.capabilities[capabilities.at(-1) as string];
      }
    },
    {
      label: "a capability replaced by a truthy non-object",
      mutate: (output) => {
        output.capabilities[capabilities[0]] = "present";
      }
    }
  ];
}

describe("Warehouse oracle conformance", () => {
  it("chains capabilities cumulatively from W1 to W8", () => {
    expect(capabilitiesFor("W1")).toEqual(["layout", "inventory"]);
    expect(capabilitiesFor("W4")).toEqual(["layout", "inventory", "visual", "orders", "simulation"]);
    expect(capabilitiesFor("W8")).toEqual(CAPABILITY_CHAIN);
    for (let index = 1; index < increments.length; index += 1) {
      const previous = capabilitiesFor(increments[index - 1]);
      expect(capabilitiesFor(increments[index]).slice(0, previous.length)).toEqual(previous);
    }
  });

  it.each(increments)("accepts the reference specimen for %s", (increment) => {
    expect(checkProbeOutput(increment, referenceProbeOutput(increment))).toEqual([]);
  });

  it.each(increments)("accepts extra capabilities beyond the chain required by %s", (increment) => {
    if (increment === "W8") return;
    const next = increments[increments.indexOf(increment) + 1];
    const output = referenceProbeOutput(next);
    output.increment = increment;
    expect(checkProbeOutput(increment, output)).toEqual([]);
  });

  describe.each(increments)("mutation battery for %s", (increment) => {
    it.each(mutationsFor(increment).map((m) => [m.label, m.mutate] as const))(
      "rejects: %s",
      (_label, mutate) => {
        const output = referenceProbeOutput(increment);
        mutate(output);
        expect(checkProbeOutput(increment, output).length).toBeGreaterThan(0);
      }
    );
  });

  it("rejects every capability field one unit below its declared minimum", () => {
    const boundaries: Array<[string, string, number]> = [
      ["W1", "layout.zones", 3],
      ["W1", "layout.bins", 12],
      ["W1", "inventory.skus", 3],
      ["W1", "inventory.totalUnits", 1],
      ["W2", "visual.svgElements", 1],
      ["W2", "visual.heatmapCells", 12],
      ["W2", "visual.textLabels", 3],
      ["W3", "orders.accepted", 1],
      ["W3", "orders.rejected", 1],
      ["W4", "simulation.events", 4],
      ["W5", "routing.pickStops", 2],
      ["W5", "routing.distance", 1],
      ["W6", "congestion.waves", 2],
      ["W7", "persistence.timelineEvents", 4],
      ["W8", "analytics.alerts", 1]
    ];

    for (const [increment, dottedPath, minimum] of boundaries) {
      const [capability, field] = dottedPath.split(".");
      const atMinimum = referenceProbeOutput(increment);
      atMinimum.capabilities[capability][field] = minimum;
      expect(checkProbeOutput(increment, atMinimum), `${dottedPath} at ${minimum}`).toEqual([]);

      const belowMinimum = referenceProbeOutput(increment);
      belowMinimum.capabilities[capability][field] = minimum - 1;
      expect(
        checkProbeOutput(increment, belowMinimum).length,
        `${dottedPath} below ${minimum}`
      ).toBeGreaterThan(0);
    }
  });

  it("rejects every declared boolean invariant when it is not exactly true", () => {
    const flags: Array<[string, string, string]> = [
      ["W3", "orders", "reservationConserved"],
      ["W4", "simulation", "playPauseStepReset"],
      ["W4", "simulation", "sseMonotonic"],
      ["W5", "routing", "overlayVisible"],
      ["W6", "congestion", "capacityEnforced"],
      ["W6", "congestion", "costInfluencesRoute"],
      ["W7", "persistence", "replayMatchesLive"],
      ["W7", "persistence", "snapshotRestores"],
      ["W8", "accessibility", "keyboardJourney"],
      ["W8", "accessibility", "reducedMotion"],
      ["W8", "accessibility", "statusNotColorOnly"]
    ];

    for (const [increment, capability, field] of flags) {
      for (const falsy of [false, "true", 1, null]) {
        const output = referenceProbeOutput(increment);
        output.capabilities[capability][field] = falsy;
        expect(
          checkProbeOutput(increment, output).length,
          `${capability}.${field} = ${JSON.stringify(falsy)}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("rejects non-finite analytics numbers instead of coercing them", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "12", null]) {
      const output = referenceProbeOutput("W8");
      output.capabilities.analytics.throughput = bad;
      expect(checkProbeOutput("W8", output).length, `throughput = ${String(bad)}`).toBeGreaterThan(0);
    }
  });

  it("names the offending field so a failed run is diagnosable without rerunning it", () => {
    const output = referenceProbeOutput("W5");
    output.capabilities.routing.pickStops = 0;
    expect(checkProbeOutput("W5", output).join(" ")).toContain("routing.pickStops");
  });
});
