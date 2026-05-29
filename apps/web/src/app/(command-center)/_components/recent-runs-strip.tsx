import Link from "next/link";
import type { RunGranularityKey, RunPreview, RunStatusKey } from "@/lib/api-types";

interface RecentRunsStripProps {
  runs: RunPreview[];
}

const STATUS_COLOR: Record<RunStatusKey, string> = {
  created: "var(--planned)",
  generating: "var(--running)",
  paused: "var(--ready)",
  needs_review: "var(--ready)",
  approved: "var(--done)",
  running: "var(--running)",
  completed: "var(--done)",
  failed: "var(--error)",
  interrupted: "var(--ready)"
};

const GRANULARITY_LABEL: Record<RunGranularityKey, string> = {
  auto: "Auto",
  coarse: "G3",
  balanced: "G6",
  fine: "G9"
};

export function RecentRunsStrip({ runs }: RecentRunsStripProps): React.ReactElement {
  return (
    <section style={{ maxWidth: 760, margin: "88px auto 0" }}>
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
          No recent runs yet. Describe a software task above and generate the first DAG.
        </div>
      ) : (
        <div>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 10
      }}
    >
      <span className="mh-coord">beta / recent runs</span>
      <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
        persisted locally
      </span>
    </div>
  );
}

function RecentRunRow({ run }: { run: RunPreview }): React.ReactElement {
  const mode = run.scenarioId !== undefined ? "mock" : "planning";
  return (
    <Link
      href={run.href}
      aria-label={`Open ${run.title}`}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto auto auto",
        gap: 18,
        alignItems: "center",
        padding: "14px 0",
        borderBottom: "1px solid var(--rule-soft)"
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span
          className="mh-serif"
          style={{
            display: "block",
            fontSize: 15,
            color: "var(--text)",
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {run.title}
        </span>
        <span className="mh-mono" style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>
          {run.workspaceName ?? run.workspaceId.slice(0, 8)}
        </span>
      </span>
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
        {GRANULARITY_LABEL[run.granularity]}
      </span>
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
        {mode}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)", fontSize: 11 }}>
        <span className="mh-dot" style={{ color: STATUS_COLOR[run.status] }} />
        {run.status.replace("_", " ")}
      </span>
      <span className="mh-mono" style={{ minWidth: 92, textAlign: "right", fontSize: 10.5, color: "var(--text-3)" }}>
        {formatTimestamp(run.updatedAt)}
      </span>
    </Link>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}
