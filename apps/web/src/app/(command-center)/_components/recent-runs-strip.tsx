import Link from "next/link";
import type { RunPreview } from "@/lib/api-types";
import { granularityLabelForMode } from "@/lib/granularity";
import { runUiStatus } from "@/lib/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Signal } from "@/components/ui/signal";

interface RecentRunsStripProps {
  runs: RunPreview[];
  compact?: boolean;
}

export function RecentRunsStrip({ runs, compact = false }: RecentRunsStripProps): React.ReactElement {
  return (
    <section
      style={{
        maxWidth: compact ? "none" : 880,
        margin: compact ? 0 : "72px auto 0",
        border: compact ? "1px solid var(--rule)" : "none",
        background: compact ? "rgba(24,26,28,0.62)" : "transparent",
        borderRadius: compact ? "var(--r-lg)" : 0,
        padding: compact ? 16 : 0
      }}
    >
      <Header compact={compact} />
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Describe a software task above and generate the first task graph to see it here."
          compact
        />
      ) : (
        <div role="list" style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 0 }}>
          {runs.map((run) => (
            <RecentRunRow key={run.id} run={run} compact={compact} />
          ))}
        </div>
      )}
    </section>
  );
}

function Header({ compact }: { compact: boolean }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: compact ? 12 : 8 }}>
      <span className="mh-coord" style={{ color: compact ? "var(--copper-hi)" : undefined }}>
        recent runs
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
        local run history
      </span>
    </div>
  );
}

function RecentRunRow({ run, compact }: { run: RunPreview; compact: boolean }): React.ReactElement {
  const repo = run.workspaceName ?? run.workspaceId.slice(0, 8);
  const meta = [repo, run.nodeCount !== undefined ? `${run.nodeCount} nodes` : null]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <Link
      href={run.href}
      role="listitem"
      aria-label={`Open graph for ${run.title}`}
      className="mh-recent-row"
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: compact ? 8 : 16,
        padding: compact ? "12px 10px" : "14px 12px",
        borderBottom: "1px solid var(--rule-soft)",
        borderRadius: "var(--r-md)"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          className="mh-serif"
          style={{
            fontSize: compact ? 14 : 15,
            color: "var(--text)",
            letterSpacing: "-0.003em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {run.title}
        </div>
        <div
          className="mh-mono"
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {meta}
        </div>
      </div>

      <div
        className="mh-recent-row__meta"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: compact ? "space-between" : "flex-end",
          gap: compact ? 12 : 20,
          flexShrink: 0
        }}
      >
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {granularityLabelForMode(run.granularity)}
        </span>
        <Signal status={runUiStatus(run.status)} label={run.status.replace(/_/g, " ")} />
        <span style={{ fontSize: 12, color: "var(--text-2)", minWidth: 72, textAlign: "right" }}>
          {formatTimestamp(run.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}
