import type { Workspace } from "@/lib/api-types";
import type { DecompositionScenario } from "@/lib/scenarios";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

interface RunHeaderProps {
  run: RunRecord;
  workspace: Workspace | null;
  scenario: DecompositionScenario | null;
  liveStatus: RunStatus;
}

function providerBadge(run: RunRecord): { label: string; tone: "accent" | "warning" } | null {
  const decomposition = run.decomposition;
  if (decomposition === undefined) return null;
  if (decomposition.provider === "anthropic" && !decomposition.fallbackUsed) {
    return { label: `LLM · ${decomposition.model}`, tone: "accent" };
  }
  const reason = decomposition.fallbackReason ?? "unknown";
  return { label: `fallback · ${reason}`, tone: "warning" };
}

const STATUS_TONE: Record<RunStatus, { fg: string; bg: string; border: string; label: string }> = {
  created:      { fg: "var(--text-2)",  bg: "var(--surface-2)",        border: "var(--border)",          label: "created" },
  generating:   { fg: "var(--coral)",   bg: "rgba(204,120,92,0.10)",  border: "rgba(204,120,92,0.55)",  label: "generating" },
  paused:       { fg: "var(--ready)",   bg: "rgba(201,164,92,0.10)",  border: "rgba(201,164,92,0.55)",  label: "paused" },
  needs_review: { fg: "var(--ready)",   bg: "rgba(201,164,92,0.10)",  border: "rgba(201,164,92,0.55)",  label: "needs review" },
  approved:     { fg: "var(--done)",    bg: "rgba(107,142,107,0.10)", border: "rgba(107,142,107,0.55)", label: "approved" },
  running:      { fg: "var(--coral)",   bg: "rgba(204,120,92,0.10)",  border: "rgba(204,120,92,0.55)",  label: "running" },
  completed:    { fg: "var(--done)",    bg: "rgba(107,142,107,0.10)", border: "rgba(107,142,107,0.55)", label: "completed" },
  failed:       { fg: "var(--error)",   bg: "rgba(194,91,84,0.10)",   border: "rgba(194,91,84,0.55)",   label: "failed" },
  interrupted:  { fg: "var(--ready)",   bg: "rgba(201,164,92,0.10)",  border: "rgba(201,164,92,0.55)",  label: "interrupted" }
};

export function RunHeader({ run, workspace, scenario, liveStatus }: RunHeaderProps): React.ReactElement {
  const tone = STATUS_TONE[liveStatus];
  const badge = providerBadge(run);
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "var(--shadow-lift)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill tone="accent">Run</Pill>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
          {workspace?.name ?? run.workspaceId}
        </span>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
          {scenario?.name ?? run.scenarioId}
        </span>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
          {run.granularity}
        </span>
        <span style={{ flex: 1 }} />
        {badge !== null ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 9px",
              fontSize: 10.5,
              fontFamily: "var(--font-mono)",
              color: badge.tone === "accent" ? "var(--coral)" : "var(--ready)",
              background: badge.tone === "accent" ? "rgba(204,120,92,0.10)" : "rgba(201,164,92,0.10)",
              border: `1px solid ${badge.tone === "accent" ? "rgba(204,120,92,0.45)" : "rgba(201,164,92,0.45)"}`,
              borderRadius: 999,
              letterSpacing: 0.4
            }}
          >
            {badge.label}
          </span>
        ) : null}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            border: `1px solid ${tone.border}`,
            background: tone.bg,
            color: tone.fg,
            borderRadius: 999,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: 0.4
          }}
        >
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: tone.fg }} />
          {tone.label}
        </span>
      </div>
      <h1
        className="mh-serif"
        style={{
          margin: 0,
          fontSize: 24,
          color: "var(--text)",
          lineHeight: 1.2,
          letterSpacing: "-0.01em"
        }}
      >
        {run.title || scenario?.name || "Run"}
      </h1>
      {run.userPrompt.length > 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-2)",
            lineHeight: 1.5
          }}
        >
          {run.userPrompt}
        </p>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-3)"
        }}
      >
        <span>
          <span style={{ color: "var(--text-3)" }}>run</span>{" "}
          <span style={{ color: "var(--text-2)" }}>{run.runId.slice(0, 8)}</span>
        </span>
        <span>
          <span style={{ color: "var(--text-3)" }}>model</span>{" "}
          <span style={{ color: "var(--text-2)" }}>{run.model}</span>
        </span>
        <span>
          <span style={{ color: "var(--text-3)" }}>created</span>{" "}
          <span style={{ color: "var(--text-2)" }}>{formatDate(run.createdAt)}</span>
        </span>
        {run.errorMessage !== undefined ? (
          <span style={{ color: "var(--error)" }}>{run.errorMessage}</span>
        ) : null}
      </div>
      <p
        style={{
          margin: 0,
          marginTop: 4,
          fontSize: 11.5,
          color: "var(--text-3)",
          lineHeight: 1.5
        }}
      >
        En esta fase, el escenario seleccionado determina el plan determinístico. Tu prompt queda
        guardado como objetivo del run.
      </p>
    </section>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "accent" }): React.ReactElement {
  void tone;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--coral)",
        background: "rgba(204,120,92,0.10)",
        border: "1px solid rgba(204,120,92,0.45)",
        borderRadius: 999,
        letterSpacing: 0.5,
        textTransform: "uppercase"
      }}
    >
      {children}
    </span>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}
