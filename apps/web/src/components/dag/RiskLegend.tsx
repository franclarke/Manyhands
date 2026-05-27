interface LegendItem {
  label: string;
  swatch: React.ReactNode;
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 28,
        height: 0,
        borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`
      }}
    />
  );
}

function Dot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: 999,
        background: color
      }}
    />
  );
}

const ITEMS: LegendItem[] = [
  { label: "Dependency edge", swatch: <Swatch color="var(--text-3)" /> },
  { label: "Risk edge", swatch: <Swatch color="var(--risk-high)" dashed /> },
  { label: "Gate edge", swatch: <Swatch color="var(--gated)" dashed /> },
  { label: "Risk · low",      swatch: <Dot color="var(--risk-low)" /> },
  { label: "Risk · medium",   swatch: <Dot color="var(--risk-medium)" /> },
  { label: "Risk · high",     swatch: <Dot color="var(--risk-high)" /> },
  { label: "Risk · blocking", swatch: <Dot color="var(--risk-blocking)" /> },
  { label: "Gate required",   swatch: <Dot color="var(--gated)" /> }
];

export function RiskLegend(): React.ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        zIndex: 5,
        padding: "10px 14px",
        background: "rgba(35,34,32,0.92)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        backdropFilter: "blur(6px)"
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-3)",
          marginBottom: 8,
          fontFamily: "var(--font-mono)"
        }}
      >
        Legend
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 20px"
        }}
      >
        {ITEMS.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-2)"
            }}
          >
            {item.swatch}
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
