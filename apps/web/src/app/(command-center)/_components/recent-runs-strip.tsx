import Link from "next/link";
import type { RunPreview, RunStatusKey } from "@/lib/api-types";

interface RecentRunsStripProps {
  runs: RunPreview[];
}

const STATUS_TONE: Record<RunStatusKey, { fg: string; bg: string; border: string; label: string }> = {
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

export function RecentRunsStrip({ runs }: RecentRunsStripProps): React.ReactElement {
  if (runs.length === 0) {
    return (
      <section style={{ marginTop: 26 }}>
        <Header />
        <div
          style={{
            border: "1px dashed var(--border)",
            background: "var(--bg-1)",
            borderRadius: "var(--r-md)",
            padding: 18,
            color: "var(--text-3)",
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          No recent runs yet. Describe lo que quieras descomponer arriba y presioná{" "}
          <strong style={{ color: "var(--text-2)" }}>Iniciar descomposición</strong> para crear tu primer run.
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 26 }}>
      <Header />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12
        }}
      >
        {runs.map((run) => (
          <RecentRunCard key={run.id} run={run} />
        ))}
      </div>
    </section>
  );
}

function Header(): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginBottom: 12
      }}
    >
      <h2 className="mh-serif" style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>
        Ejecuciones recientes
      </h2>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-3)",
          letterSpacing: 0.5
        }}
      >
        persistidos en .manyhands/runs
      </span>
    </div>
  );
}

function RecentRunCard({ run }: { run: RunPreview }): React.ReactElement {
  const tone = STATUS_TONE[run.status];
  return (
    <Link href={run.href} aria-label={`Open ${run.title}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          border: "1px solid var(--border)",
          background: "var(--surface)",
          borderRadius: "var(--r-md)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          height: "100%",
          cursor: "pointer",
          transition: "border-color 150ms ease-out"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-3)",
              letterSpacing: 0.4
            }}
          >
            {run.workspaceName ?? run.workspaceId.slice(0, 8)}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${tone.border}`,
              background: tone.bg,
              color: tone.fg,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)"
            }}
          >
            {tone.label}
          </span>
        </div>
        <h3
          className="mh-serif"
          style={{
            margin: 0,
            fontSize: 16,
            color: "var(--text)",
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}
        >
          {run.title}
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-2)"
          }}
        >
          <span>
            <span style={{ color: "var(--text-3)" }}>granularity</span> {run.granularity}
          </span>
          {run.nodeCount !== undefined ? (
            <span>
              <span style={{ color: "var(--text-3)" }}>nodes</span> {run.nodeCount}
            </span>
          ) : null}
          <span>
            <span style={{ color: "var(--text-3)" }}>model</span> {run.model}
          </span>
          {run.agentCount !== undefined ? (
            <span>
              <span style={{ color: "var(--text-3)" }}>agents</span> {run.agentCount}
            </span>
          ) : null}
          {run.conflictCount !== undefined && run.conflictCount > 0 ? (
            <span>
              <span style={{ color: "var(--text-3)" }}>conflicts</span> {run.conflictCount}
            </span>
          ) : null}
          {run.durationLabel !== undefined ? (
            <span>
              <span style={{ color: "var(--text-3)" }}>duration</span> {run.durationLabel}
            </span>
          ) : null}
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-3)"
          }}
        >
          <span>{formatTimestamp(run.updatedAt)}</span>
          <span style={{ color: "var(--coral)" }}>Open run →</span>
        </div>
      </div>
    </Link>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}
