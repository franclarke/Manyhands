import Link from "next/link";
import type { RunPreview } from "@/lib/api-types";
import { granularityLabelForMode } from "@/lib/granularity";
import { runUiStatus } from "@/lib/status";
import { StatusBadge } from "@/components/ui/status-badge";

interface RecentRunsStripProps {
  runs: RunPreview[];
}

export function RecentRunsStrip({ runs }: RecentRunsStripProps): React.ReactElement {
  return (
    <section style={{ maxWidth: 980, margin: "64px auto 0" }}>
      <Header />
      {runs.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--rule-strong)",
            borderRadius: "var(--r-lg)",
            padding: 18,
            color: "var(--text-3)",
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          No recent runs yet. Describe a software task above and generate the first task graph.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12
          }}
        >
          {runs.map((run) => (
            <RecentRunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}

function Header(): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 12
      }}
    >
      <span className="mh-coord">recent runs</span>
      <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
        local run history
      </span>
    </div>
  );
}

function RecentRunCard({ run }: { run: RunPreview }): React.ReactElement {
  const repo = run.workspaceName ?? run.workspaceId.slice(0, 8);
  return (
    <Link
      href={run.href}
      aria-label={`Open graph for ${run.title}`}
      style={{
        minHeight: 172,
        border: "1px solid var(--rule)",
        background: "rgba(19,20,22,0.74)",
        borderRadius: "var(--r-lg)",
        padding: 15,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              color: "var(--text)",
              lineHeight: 1.28,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {run.title}
          </h2>
          <div className="mh-mono" style={{ marginTop: 6, fontSize: 10.5, color: "var(--text-3)" }}>
            {repo}
          </div>
        </div>
        <StatusBadge status={runUiStatus(run.status)} label={run.status.replace("_", " ")} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 12px",
          marginTop: "auto"
        }}
      >
        <Meta label="Granularity" value={granularityLabelForMode(run.granularity)} />
        <Meta label="Nodes" value={run.nodeCount !== undefined ? String(run.nodeCount) : "-"} />
        <Meta label="Progress" value={progressLabel(run)} />
        <Meta label="Date" value={formatTimestamp(run.updatedAt)} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 2
        }}
      >
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>
          {run.scenarioId !== undefined ? "Lab fixture" : "Prompt run"}
        </span>
        <span style={{ color: "var(--copper-hi)", fontSize: 12, fontWeight: 700 }}>
          Open graph
        </span>
      </div>
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mh-coord" style={{ fontSize: 9.5 }}>{label}</div>
      <div
        style={{
          marginTop: 3,
          color: "var(--text)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function progressLabel(run: RunPreview): string {
  if (run.status === "completed") return "Integrated";
  if (run.status === "failed") return "Failed";
  if (run.status === "needs_review") return "Plan review";
  if (run.status === "approved") return "Ready to run";
  if (run.status === "running") {
    const agents = run.agentCount ?? 0;
    const nodes = run.nodeCount ?? 0;
    return nodes > 0 ? `${agents}/${nodes} agents` : "Agents running";
  }
  if (run.status === "generating") return "Planning";
  return run.nodeCount !== undefined ? `${run.nodeCount} nodes planned` : "Graph pending";
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}
