import Link from "next/link";
import type { RunGranularityKey, RunStatusKey } from "@/lib/api-types";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { getRunRepository } from "@/lib/server/runs";
import type { RunRecord } from "@/lib/server/runs/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExperimentRow {
  id: "G3" | "G6" | "G9";
  mode: Exclude<RunGranularityKey, "auto">;
  label: string;
  note: string;
}

const ROWS: ExperimentRow[] = [
  {
    id: "G3",
    mode: "coarse",
    label: "Coarse",
    note: "Few larger tasks. Less coordination overhead, less parallel surface."
  },
  {
    id: "G6",
    mode: "balanced",
    label: "Balanced",
    note: "Default research setting for most thesis demos."
  },
  {
    id: "G9",
    mode: "fine",
    label: "Fine",
    note: "Many atomic tasks. More parallelism and more integration surface."
  }
];

export default async function LabPage(): Promise<React.ReactElement> {
  const runs = await getRunRepository().list({ limit: 50 });
  const latestByGranularity = new Map<RunGranularityKey, RunRecord>();
  for (const run of runs) {
    if (!latestByGranularity.has(run.granularity)) {
      latestByGranularity.set(run.granularity, run);
    }
  }

  const hasRuns = runs.length > 0;

  return (
    <div style={{ maxWidth: 1100, margin: "34px auto 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <span className="mh-coord" style={{ color: "var(--copper)" }}>experiments / log</span>
        <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          Gemini CLI measurements appear only after execution
        </span>
      </div>

      <h1 className="mh-serif" style={{ fontSize: 34, color: "var(--text)", lineHeight: 1.08, margin: 0 }}>
        Compare granularities.
      </h1>
      <p style={{ marginTop: 10, maxWidth: 660, color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
        Track the same task across G3, G6 and G9. ManyHands keeps missing measurements
        explicit instead of filling the notebook with invented cloud data.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 28 }}>
        {ROWS.map((row) => {
          const run = latestByGranularity.get(row.mode);
          const metrics = run !== undefined ? metricsFor(run) : null;
          return <GranularityCard key={row.id} row={row} run={run} metrics={metrics} />;
        })}
      </div>

      <div style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <span className="mh-coord">measurements</span>
          <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>latest local runs</span>
        </div>
        <NotebookTable rows={ROWS.map((row) => ({ row, run: latestByGranularity.get(row.mode) }))} />
      </div>

      {!hasRuns ? (
        <div
          style={{
            marginTop: 28,
            padding: "16px 18px",
            border: "1px dashed var(--rule-strong)",
            borderRadius: 6,
            color: "var(--text-2)",
            lineHeight: 1.6
          }}
        >
          <div className="mh-serif" style={{ fontSize: 16, color: "var(--text)" }}>
            No comparison runs yet.
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            Run the same task under multiple granularities to compare results.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GranularityCard({
  row,
  run,
  metrics
}: {
  row: ExperimentRow;
  run: RunRecord | undefined;
  metrics: ReturnType<typeof metricsFor> | null;
}): React.ReactElement {
  return (
    <article
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 6,
        padding: "14px 16px 16px",
        background: "var(--bg-1)"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="mh-serif" style={{ fontSize: 28, color: "var(--text)", lineHeight: 1 }}>
          {row.id}
        </span>
        <span className="mh-coord">{row.label}</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-2)", margin: "10px 0 12px", lineHeight: 1.5 }}>
        {row.note}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <KV k="nodes" v={metrics?.nodes ?? "-"} />
        <KV k="leaves" v={metrics?.leaves ?? "-"} />
        <KV k="depth" v={metrics?.depth ?? "-"} />
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Status status={run?.status} />
        {run !== undefined ? (
          <Link className="mh-mono" href={`/runs/${run.runId}`} style={{ fontSize: 11, color: "var(--copper)" }}>
            Open run
          </Link>
        ) : (
          <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>no run</span>
        )}
      </div>
    </article>
  );
}

function NotebookTable({
  rows
}: {
  rows: Array<{ row: ExperimentRow; run: RunRecord | undefined }>;
}): React.ReactElement {
  const metrics = rows.map(({ run }) => (run !== undefined ? metricsFor(run) : null));
  const tableRows: Array<[string, string | number, string | number, string | number]> = [
    ["nodes", metrics[0]?.nodes ?? "-", metrics[1]?.nodes ?? "-", metrics[2]?.nodes ?? "-"],
    ["leaves", metrics[0]?.leaves ?? "-", metrics[1]?.leaves ?? "-", metrics[2]?.leaves ?? "-"],
    ["depth", metrics[0]?.depth ?? "-", metrics[1]?.depth ?? "-", metrics[2]?.depth ?? "-"],
    ["duration", metrics[0]?.duration ?? "-", metrics[1]?.duration ?? "-", metrics[2]?.duration ?? "-"],
    ["conflicts", metrics[0]?.conflicts ?? "-", metrics[1]?.conflicts ?? "-", metrics[2]?.conflicts ?? "-"],
    ["status", rows[0]?.run?.status ?? "-", rows[1]?.run?.status ?? "-", rows[2]?.run?.status ?? "-"]
  ];

  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 6, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          padding: "10px 16px",
          borderBottom: "1px solid var(--rule)",
          background: "rgba(229,222,204,0.025)"
        }}
      >
        <span className="mh-coord">metric</span>
        {ROWS.map((row) => (
          <span key={row.id} className="mh-coord" style={{ textAlign: "center" }}>
            {row.id} / {row.label}
          </span>
        ))}
      </div>
      {tableRows.map((values) => (
        <div
          key={values[0]}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            padding: "10px 16px",
            borderBottom: "1px solid var(--rule-soft)",
            alignItems: "center"
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>{values[0]}</span>
          {values.slice(1).map((value, index) => (
            <span key={index} className="mh-mono" style={{ fontSize: 13, textAlign: "center", color: value === "-" ? "var(--text-3)" : "var(--text)" }}>
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number }): React.ReactElement {
  return (
    <div>
      <div className="mh-coord">{k}</div>
      <div className="mh-mono" style={{ fontSize: 14, color: "var(--text)", marginTop: 3 }}>{v}</div>
    </div>
  );
}

function Status({ status }: { status: RunStatusKey | undefined }): React.ReactElement {
  if (status === undefined) {
    return <span style={{ color: "var(--text-3)", fontSize: 11 }}>no measurement</span>;
  }
  const color = status === "completed"
    ? "var(--done)"
    : status === "failed"
      ? "var(--error)"
      : status === "running" || status === "generating"
        ? "var(--running)"
        : "var(--ready)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)", fontSize: 11 }}>
      <span className="mh-dot" style={{ color }} />
      {status.replace("_", " ")}
    </span>
  );
}

function metricsFor(run: RunRecord): {
  nodes: number;
  leaves: number;
  depth: number;
  duration: string;
  conflicts: number;
} {
  const snapshot = projectRunRecordToSnapshot(run);
  if (snapshot === null) {
    return { nodes: 0, leaves: 0, depth: 0, duration: "-", conflicts: 0 };
  }
  const nodes = Object.values(snapshot.graphSnapshot.nodes);
  return {
    nodes: nodes.length,
    leaves: nodes.filter((node) => node.kind === "leaf").length,
    depth: Math.max(0, ...nodes.map((node) => node.depth)),
    duration: run.completedAt !== undefined && run.startedAt !== undefined
      ? formatDuration(Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt)))
      : "-",
    conflicts: snapshot.riskPredictions.length
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}
