"use client";

import { useId } from "react";
import type { DecompositionMode } from "@manyhands/core";
import { SCENARIOS, getScenario } from "@/lib/scenarios";

interface ScenarioPickerProps {
  value: string;
  onChange: (scenarioId: string) => void;
  granularity: DecompositionMode;
}

export function ScenarioPicker({ value, onChange, granularity }: ScenarioPickerProps): React.ReactElement {
  const labelId = useId();
  const scenario = SCENARIOS.find((entry) => entry.id === value) ?? SCENARIOS[0]!;
  const supports = scenario.supportedGranularities.includes(granularity);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <label
        htmlFor={labelId}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text-3)"
        }}
      >
        Scenario
      </label>
      <select
        id={labelId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 30,
          padding: "0 28px 0 10px",
          border: "1px solid var(--border)",
          background: "var(--bg-1)",
          color: "var(--text)",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          appearance: "none",
          cursor: "pointer"
        }}
      >
        {SCENARIOS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} · {entry.benchmarkId}
          </option>
        ))}
      </select>
      {!supports ? (
        <span
          title={`Scenario ${scenario.id} does not support granularity ${granularity}.`}
          style={{
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            color: "var(--error)",
            background: "rgba(194,91,84,0.10)",
            border: "1px solid rgba(194,91,84,0.45)",
            padding: "2px 7px",
            borderRadius: 999
          }}
        >
          granularity unsupported
        </span>
      ) : (
        <span
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            fontFamily: "var(--font-sans)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {scenario.description}
        </span>
      )}
    </div>
  );
}

export function getDefaultScenarioId(): string {
  return SCENARIOS[0]!.id;
}

export { getScenario };
