import Link from "next/link";
import type { RunPreview } from "@/lib/api-types";
import { granularityLabelForMode } from "@/lib/granularity";
import { runUiStatus } from "@/lib/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Signal } from "@/components/ui/signal";

interface RecentRunsStripProps {
  runs: RunPreview[];
}

export function RecentRunsStrip({ runs }: RecentRunsStripProps): React.ReactElement {
  return (
    <section style={{ maxWidth: 880, margin: "72px auto 0" }}>
      <Header />
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Describe a software task above and generate the first task graph to see it here."
          compact
        />
      ) : (
        <div role="list">
          {runs.map((run) => (
            <RecentRunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}

function Header(): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
      <span className="mh-coord">recent runs</span>
      <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
        local run history
      </span>
    </div>
  );
}

function RecentRunRow({ run }: { run: RunPreview }): React.ReactElement {
  const repo = run.workspaceName ?? run.workspaceId.slice(0, 8);
  const source = run.scenarioId !== undefined ? "Lab fixture" : "Prompt run";
  const meta = [repo, run.nodeCount !== undefined ? `${run.nodeCount} nodes` : null, source]
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
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 16,
        padding: "14px 12px",
        borderBottom: "1px solid var(--rule-soft)",
        borderRadius: "var(--r-md)"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          className="mh-serif"
          style={{
            fontSize: 15,
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
            fontSize: 11,
            color: "var(--text-3)",
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
          justifyContent: "flex-end",
          gap: 20,
          flexShrink: 0
        }}
      >
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
          {granularityLabelForMode(run.granularity)}
        </span>
        <Signal status={runUiStatus(run.status)} label={run.status.replace(/_/g, " ")} />
        <span style={{ fontSize: 11, color: "var(--text-3)", minWidth: 66, textAlign: "right" }}>
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
