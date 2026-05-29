import type { Workspace } from "@/lib/api-types";
import type { DecompositionScenario } from "@/lib/scenarios";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";
import { runUiStatus } from "@/lib/status";
import { StatusBadge } from "@/components/ui/status-badge";

interface RunHeaderProps {
  run: RunRecord;
  workspace: Workspace | null;
  scenario: DecompositionScenario | null;
  liveStatus: RunStatus;
  summary: { nodes: number; leaves: number; depth: number; ready: number } | null;
}

export function RunHeader({
  run,
  workspace,
  scenario,
  liveStatus,
  summary
}: RunHeaderProps): React.ReactElement {
  const mode = modeLabel(run, scenario);
  const metrics = summary ?? { nodes: 0, leaves: 0, depth: 0, ready: 0 };
  return (
    <section
      style={{
        padding: "12px 4px 6px",
        display: "flex",
        alignItems: "flex-end",
        gap: 28,
        borderBottom: "1px solid var(--rule)",
        marginBottom: 2
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, flexWrap: "wrap" }}>
          <span className="mh-coord">run / alpha 01</span>
          <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {run.runId.slice(0, 8)}
          </span>
          <span style={{ color: "var(--text-4)" }}>/</span>
          <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
            {workspace?.name ?? run.workspaceId}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1
            className="mh-serif"
            style={{
              margin: 0,
              fontSize: 23,
              color: "var(--text)",
              lineHeight: 1.12,
              maxWidth: 760
            }}
          >
            {run.title || scenario?.name || "Run"}
          </h1>
          <ModeSignal label={mode} />
          <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
            {granularityLabel(run.granularity)}
          </span>
          <StatusBadge status={runUiStatus(liveStatus)} label={liveStatus.replace("_", " ")} />
        </div>
        {run.userPrompt.length > 0 ? (
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: 880,
              fontSize: 12.5,
              color: "var(--text-2)",
              lineHeight: 1.5
            }}
          >
            {run.userPrompt}
          </p>
        ) : null}
        <p className="mh-mono" style={{ margin: "7px 0 0", fontSize: 10.5, color: "var(--text-3)" }}>
          updated {formatDate(run.updatedAt)} / {scenario !== null ? "fixture-backed mock data" : "prompt-backed plan"}
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
        <Metric label="nodes" value={metrics.nodes} />
        <Metric label="leaves" value={metrics.leaves} />
        <Metric label="depth" value={metrics.depth} />
        <Metric label="ready" value={metrics.ready} color="var(--ready)" />
      </div>
    </section>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color?: string }): React.ReactElement {
  return (
    <div style={{ textAlign: "right", minWidth: 38 }}>
      <div className="mh-mono" style={{ fontSize: 22, color: color ?? "var(--text)", lineHeight: 1 }}>
        {value}
      </div>
      <div className="mh-coord" style={{ marginTop: 5 }}>
        {label}
      </div>
    </div>
  );
}

function ModeSignal({ label }: { label: string }): React.ReactElement {
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 8px",
        border: "1px solid var(--rule-strong)",
        borderRadius: 999,
        color: "var(--copper)",
        fontSize: 10.5,
        textTransform: "uppercase"
      }}
    >
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      {label}
    </span>
  );
}

function modeLabel(run: RunRecord, scenario: DecompositionScenario | null): string {
  if (scenario !== null) return "mock run";
  if (run.status === "approved") return "execution-ready";
  if (run.status === "running" || run.status === "completed" || run.startedAt !== undefined) {
    return "real execution";
  }
  return "planning mode";
}

function granularityLabel(value: RunRecord["granularity"]): string {
  if (value === "auto") return "Auto";
  if (value === "coarse") return "G3 coarse";
  if (value === "balanced") return "G6 balanced";
  return "G9 fine";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}
