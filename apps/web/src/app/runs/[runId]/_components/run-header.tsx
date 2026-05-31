import type { Workspace } from "@/lib/api-types";
import { granularityDetailForMode, granularityLabelForMode } from "@/lib/granularity";
import type { OperationalMetrics } from "@/lib/run-presentation";
import type { DecompositionScenario } from "@/lib/scenarios";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";
import { runUiStatus } from "@/lib/status";
import { StatusBadge } from "@/components/ui/status-badge";

type MetricTone = "ready" | "running" | "blocked" | "review" | "failed" | "integrated";

interface RunHeaderProps {
  run: RunRecord;
  workspace: Workspace | null;
  scenario: DecompositionScenario | null;
  liveStatus: RunStatus;
  summary: {
    nodes: number;
    leaves: number;
    depth: number;
    metrics: OperationalMetrics;
  } | null;
}

export function RunHeader({
  run,
  workspace,
  scenario,
  liveStatus,
  summary
}: RunHeaderProps): React.ReactElement {
  const mode = modeLabel(run, scenario);
  const metrics = summary?.metrics ?? emptyMetrics();
  const branch = workspace?.defaultBranch ?? run.provisioned?.baseBranch ?? "main";
  const repo = workspace?.repoPath ?? workspace?.name ?? run.workspaceId;

  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        background: "linear-gradient(180deg, rgba(229,222,204,0.035), rgba(19,20,22,0.76))",
        borderRadius: "var(--r-xl)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="mh-coord" style={{ color: "var(--copper)" }}>
              run workspace
            </span>
            <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
              {run.runId.slice(0, 8)}
            </span>
            <StatusBadge status={runUiStatus(liveStatus)} label={liveStatus.replace("_", " ")} />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              color: "var(--text)",
              lineHeight: 1.15,
              maxWidth: 980
            }}
          >
            {run.title || scenario?.name || "Untitled run"}
          </h1>
          {run.userPrompt.length > 0 ? (
            <p
              style={{
                margin: "9px 0 0",
                maxWidth: 980,
                fontSize: 13.5,
                color: "var(--text-2)",
                lineHeight: 1.55
              }}
            >
              {run.userPrompt}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end" }}>
          <ModeSignal label={mode} />
          <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
            updated {formatDate(run.updatedAt)}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10
        }}
      >
        <Info label="Repo" value={repo} mono />
        <Info label="Branch" value={branch} mono />
        <Info label="Granularity" value={`${granularityLabelForMode(run.granularity)} - ${granularityDetailForMode(run.granularity)}`} />
        <Info label="Execution mode" value={mode} />
        <Info label="Current phase" value={phaseLabel(liveStatus)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))",
          gap: 8
        }}
      >
        <Metric label="Total nodes" value={metrics.totalNodes} />
        <Metric label="Ready" value={metrics.ready} tone="ready" />
        <Metric label="Running" value={metrics.running} tone="running" />
        <Metric label="Blocked" value={metrics.blocked} tone="blocked" />
        <Metric label="Needs review" value={metrics.needsReview} tone="review" />
        <Metric label="Failed" value={metrics.failed} tone="failed" />
        <Metric label="Integrated" value={metrics.integrated} tone="integrated" />
        <Metric label="High risk" value={metrics.highRisk} tone="failed" />
        <Metric label="Parallel batches" value={metrics.parallelBatches} />
      </div>
    </section>
  );
}

function Info({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div style={{ minWidth: 0, borderTop: "1px solid var(--rule-soft)", paddingTop: 8 }}>
      <div className="mh-coord" style={{ fontSize: 9.5 }}>{label}</div>
      <div
        style={{
          marginTop: 4,
          color: "var(--text)",
          fontSize: 12,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
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

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: MetricTone;
}): React.ReactElement {
  const color = metricColor(tone);
  return (
    <div
      style={{
        border: "1px solid var(--rule-soft)",
        background: "rgba(15,16,18,0.38)",
        borderRadius: "var(--r-md)",
        padding: "8px 9px",
        minWidth: 0
      }}
    >
      <div className="mh-mono" style={{ fontSize: 20, color, lineHeight: 1 }}>
        {value}
      </div>
      <div className="mh-coord" style={{ marginTop: 6, fontSize: 8.5, whiteSpace: "normal" }}>
        {label}
      </div>
    </div>
  );
}

function ModeSignal({ label }: { label: string }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 9px",
        border: "1px solid var(--rule-strong)",
        borderRadius: 999,
        color: "var(--copper-hi)",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </span>
  );
}

function modeLabel(run: RunRecord, scenario: DecompositionScenario | null): string {
  if (scenario !== null) return "Lab fixture";
  if (run.repoSpec !== undefined || run.provisioned !== undefined) return "Codex execution after approval";
  return "Plan and review";
}

function phaseLabel(status: RunStatus): string {
  switch (status) {
    case "created":
    case "generating":
      return "Plan generated";
    case "needs_review":
      return "Review plan";
    case "approved":
      return "Execute agents";
    case "running":
    case "paused":
    case "interrupted":
      return "Execute agents";
    case "completed":
      return "Integrate";
    case "failed":
      return "Failed";
  }
}

function metricColor(tone: MetricTone | undefined): string {
  switch (tone) {
    case "ready":
      return "var(--status-ready-fg)";
    case "running":
      return "var(--status-running-fg)";
    case "blocked":
      return "var(--status-blocked-fg)";
    case "review":
      return "var(--status-review-fg)";
    case "failed":
      return "var(--status-failed-fg)";
    case "integrated":
      return "var(--status-integrated-fg)";
    default:
      return "var(--text)";
  }
}

function emptyMetrics(): OperationalMetrics {
  return {
    totalNodes: 0,
    ready: 0,
    running: 0,
    blocked: 0,
    needsReview: 0,
    failed: 0,
    integrated: 0,
    highRisk: 0,
    parallelBatches: 0
  };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}
