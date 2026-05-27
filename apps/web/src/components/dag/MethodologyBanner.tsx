export function MethodologyBanner(): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid rgba(201,164,92,0.45)",
        background: "rgba(201,164,92,0.06)",
        padding: "10px 14px",
        borderRadius: "var(--r-md)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        fontSize: 12.5,
        color: "var(--ready)",
        lineHeight: 1.5
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0.7,
          padding: "2px 7px",
          background: "rgba(201,164,92,0.18)",
          border: "1px solid rgba(201,164,92,0.55)",
          textTransform: "uppercase",
          color: "var(--ready)",
          flexShrink: 0,
          marginTop: 1,
          borderRadius: 4
        }}
      >
        Lab mode
      </span>
      <div style={{ color: "var(--text-2)" }}>
        <strong style={{ color: "var(--ready)" }}>Mock execution only.</strong>{" "}
        No real agents, no real git worktrees, no real test runs, no SQLite persistence.{" "}
        Blocking risk and gate decisions are deterministic orchestration signals — they are not proof of real merge conflicts or human review.
      </div>
    </div>
  );
}
