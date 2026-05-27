"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GraphNodeStatus, GraphRiskLevel } from "@/lib/graph-view-model";

export interface TaskNodeData {
  title: string;
  taskId: string;
  kind: string;
  status: GraphNodeStatus;
  riskLevel?: GraphRiskLevel;
  expectedFilesCount?: number;
  expectedFilesPreview?: string[];
  dependencyCount?: number;
  traceCount?: number;
  durationMs?: number;
  costUsd?: number;
  gateRequired?: boolean;
  authoredBy?: "ai" | "human";
  manual?: boolean;
  integrator?: boolean;
  selected?: boolean;
  blockedReason?: string;
  [key: string]: unknown;
}

interface StatusStyle {
  dot: string;
  label: string;
  border: string;
}

const STATUS_COLOR: Record<GraphNodeStatus, StatusStyle> = {
  planned:      { dot: "var(--planned)",  label: "var(--text-2)",   border: "var(--border)" },
  ready:        { dot: "var(--ready)",    label: "var(--ready)",    border: "rgba(201,164,92,0.55)" },
  running:      { dot: "var(--running)",  label: "var(--coral-hi)", border: "var(--coral)" },
  gated:        { dot: "var(--gated)",    label: "var(--gated)",    border: "rgba(201,164,92,0.55)" },
  done:         { dot: "var(--done)",     label: "var(--done)",     border: "rgba(107,142,107,0.55)" },
  failed:       { dot: "var(--error)",    label: "var(--error)",    border: "rgba(194,91,84,0.65)" },
  blocked:      { dot: "var(--blocked)",  label: "var(--blocked)",  border: "var(--border)" },
  generating:   { dot: "var(--coral)",    label: "var(--coral-hi)", border: "var(--coral)" },
  needs_review: { dot: "var(--ready)",    label: "var(--ready)",    border: "rgba(201,164,92,0.55)" },
  approved:     { dot: "var(--done)",     label: "var(--done)",     border: "rgba(107,142,107,0.55)" },
  integrated:   { dot: "var(--done)",     label: "var(--done)",     border: "rgba(107,142,107,0.65)" }
};

const RISK_BORDER: Record<GraphRiskLevel, string> = {
  low:      "rgba(107,142,107,0.45)",
  medium:   "rgba(201,164,92,0.55)",
  high:     "rgba(194,91,84,0.55)",
  blocking: "rgba(184,128,74,0.65)"
};

function TaskNodeCardImpl({ data, selected }: NodeProps): React.ReactElement {
  const node = data as TaskNodeData;
  const statusStyle = STATUS_COLOR[node.status];
  const isRunning = node.status === "running" || node.status === "generating";
  const isConflict = node.riskLevel === "blocking" || node.riskLevel === "high";
  const borderColor = isConflict ? RISK_BORDER[node.riskLevel ?? "high"] : statusStyle.border;

  const baseShadow = selected
    ? "0 0 0 1.5px var(--selected), 0 0 0 5px rgba(91,122,153,0.20), 0 4px 14px rgba(0,0,0,0.30)"
    : "0 1px 0 rgba(255,255,255,0.02) inset, 0 1px 4px rgba(0,0,0,0.20)";

  return (
    <div
      className={isRunning ? "coral-pulse" : undefined}
      style={{
        width: 264,
        background: "var(--surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: 9,
        padding: "10px 12px 11px",
        boxShadow: baseShadow,
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
        position: "relative"
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "var(--text-3)", width: 5, height: 5, border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "var(--text-3)", width: 5, height: 5, border: "none" }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="mh-serif"
            style={{
              fontSize: 14.5,
              lineHeight: 1.25,
              color: "var(--text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {node.title}
          </div>
          <div
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-3)",
              minWidth: 0
            }}
          >
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 170
              }}
              title={node.taskId}
            >
              {node.taskId}
            </span>
            <span style={{ color: "var(--text-3)" }}>·</span>
            <span style={{ color: "var(--text-3)" }}>{node.kind}</span>
          </div>
        </div>
        <StatusPill status={node.status} style={statusStyle} />
      </div>

      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
        {node.riskLevel ? (
          <MetaTag
            color={RISK_BORDER[node.riskLevel]}
            label={`risk · ${node.riskLevel}`}
          />
        ) : null}
        {node.gateRequired ? (
          <MetaTag color="var(--gated)" label="gate required" />
        ) : null}
        {node.integrator ? (
          <MetaTag color="var(--selected)" label="integrator" />
        ) : null}
        {node.authoredBy !== undefined ? (
          <MetaTag
            color={node.manual ? "var(--coral)" : "var(--text-3)"}
            label={node.manual ? "manual" : "ai"}
          />
        ) : null}
      </div>

      {(node.expectedFilesCount ?? 0) > 0 ? (
        <div
          style={{
            marginTop: 8,
            padding: "7px 8px",
            background: "var(--bg-1)",
            border: "1px solid var(--border-soft)",
            borderRadius: 5
          }}
        >
          {(node.expectedFilesPreview ?? []).slice(0, 2).map((file, idx) => (
            <div
              key={`${file}-${idx}`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                lineHeight: 1.5,
                color: "var(--text-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "flex",
                alignItems: "center",
                gap: 5
              }}
              title={file}
            >
              <span style={{ color: "var(--text-3)" }}>—</span>
              {file}
            </div>
          ))}
          {(node.expectedFilesCount ?? 0) > 2 ? (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)"
              }}
            >
              + {(node.expectedFilesCount ?? 0) - 2} more
            </div>
          ) : null}
        </div>
      ) : null}

      {node.blockedReason ? (
        <div
          style={{
            marginTop: 8,
            padding: "6px 8px",
            background: "rgba(194,91,84,0.06)",
            border: "1px solid rgba(194,91,84,0.30)",
            borderRadius: 5,
            fontSize: 11,
            color: "var(--error)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}
        >
          {node.blockedReason}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--text-3)"
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {(node.dependencyCount ?? 0) > 0 ? (
            <span title="dependencies">↳ {node.dependencyCount}</span>
          ) : null}
          {(node.traceCount ?? 0) > 0 ? (
            <span title="trace events">◆ {node.traceCount}</span>
          ) : null}
          {(node.dependencyCount ?? 0) === 0 && (node.traceCount ?? 0) === 0 ? (
            <span>—</span>
          ) : null}
        </span>
        <span>
          {node.durationMs !== undefined ? formatDuration(node.durationMs) : "—"}
          {node.costUsd !== undefined ? ` · ${formatCost(node.costUsd)}` : ""}
        </span>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  style
}: {
  status: GraphNodeStatus;
  style: StatusStyle;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 20,
        padding: "0 7px",
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: `color-mix(in oklab, ${style.dot} 12%, var(--surface))`,
        color: style.label,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: 0.3,
        whiteSpace: "nowrap"
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 999, background: style.dot }}
      />
      {status}
    </span>
  );
}

function MetaTag({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 7px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
        fontSize: 10,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        fontFamily: "var(--font-mono)"
      }}
    >
      {label}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export const TaskNodeCard = memo(TaskNodeCardImpl);
