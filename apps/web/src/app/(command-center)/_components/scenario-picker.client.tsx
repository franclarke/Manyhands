"use client";

import { useId } from "react";
import type { GranularityMode } from "@/lib/server/runs/schema";
import { SCENARIOS, getScenario } from "@/lib/scenarios";

interface ScenarioPickerProps {
  value: string;
  onChange: (scenarioId: string) => void;
  granularity: GranularityMode;
}

export function ScenarioPicker({ value, onChange, granularity }: ScenarioPickerProps): React.ReactElement {
  const labelId = useId();
  const scenario = value.length > 0 ? SCENARIOS.find((entry) => entry.id === value) : undefined;
  const supports = scenario === undefined || granularity === "auto" || scenario.supportedGranularities.includes(granularity);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <label
        htmlFor={labelId}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--text-2)"
        }}
      >
        Scenario
      </label>
      <select
        id={labelId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: 36,
          padding: "0 28px 0 10px",
          border: "1px solid var(--rule-control)",
          background: "var(--surface)",
          color: "var(--text)",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          appearance: "none",
          cursor: "pointer"
        }}
      >
        <option value="">Prompt-only planner</option>
        {SCENARIOS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} / {entry.benchmarkId}
          </option>
        ))}
      </select>
      {!supports ? (
        <span
          title={`Scenario ${scenario?.id ?? "unknown"} does not support granularity ${granularity}.`}
          style={{
            fontSize: 12,
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
            fontSize: 12.5,
            color: "var(--text-2)",
            fontFamily: "var(--font-sans)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {scenario?.description ?? "Use the live planner for the prompt above."}
        </span>
      )}
    </div>
  );
}

export function getDefaultScenarioId(): string {
  return "";
}

export { getScenario };
