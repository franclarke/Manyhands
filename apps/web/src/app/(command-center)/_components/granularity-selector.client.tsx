"use client";

import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import {
  GRANULARITY_DISPLAY_OPTIONS,
  granularityImpactForLevel,
  granularityOption,
  isGranularityLevel,
  type GranularityDisplayId,
  type GranularityLevel
} from "@/lib/granularity";

interface GranularitySelectorProps {
  value: GranularityLevel;
  onChange: (value: GranularityLevel) => void;
}

const OPTIONS: ReadonlyArray<SegmentedOption<GranularityDisplayId>> = GRANULARITY_DISPLAY_OPTIONS.map(
  (option) => ({
    value: option.id,
    label: option.label,
    ...(option.disabled === true ? { disabled: true } : {}),
    title: option.disabledReason ?? option.impact
  })
);

export function GranularitySelector({ value, onChange }: GranularitySelectorProps): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", minWidth: 0 }}>
      <SegmentedControl
        ariaLabel="Granularity"
        options={OPTIONS}
        value={value}
        fluid
        onChange={(id) => {
          if (isGranularityLevel(id)) onChange(id);
        }}
      />
      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--text-3)",
          maxWidth: 520
        }}
      >
        <span style={{ color: "var(--text-2)" }}>{granularityOption(value).detail}</span>
        {" — "}
        {granularityImpactForLevel(value)}
      </p>
    </div>
  );
}
