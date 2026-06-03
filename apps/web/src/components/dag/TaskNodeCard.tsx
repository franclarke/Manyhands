"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GraphNodeStatus, GraphRiskLevel } from "@/lib/graph-view-model";
import { nodeUiStatus, riskColor } from "@/lib/status";
import { nodeKindLabel, riskLabel } from "@/lib/run-presentation";
import { StatusBadge } from "@/components/ui/status-badge";

export interface TaskNodeData {
  title: string;
  description: string;
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
  actionHint?: string;
  relationship?: "selected" | "ancestor" | "dependency" | "child";
  [key: string]: unknown;
}

function TaskNodeCardImpl({ data, selected }: NodeProps): React.ReactElement {
  const node = data as TaskNodeData;
  const expanded = selected === true;
  const isRunning = node.status === "running" || node.status === "generating";
  const isReady = node.status === "ready" || node.status === "approved";
  const selectedShadow = "0 0 0 1px var(--copper), 0 0 0 4px rgba(180, 113, 72, 0.14)";
  const relationshipColor = relationshipAccent(node.relationship);
  const handleVisible = selected === true || relationshipColor !== undefined;
  const riskBorder = node.riskLevel === "high" || node.riskLevel === "blocking"
    ? riskColor(node.riskLevel)
    : undefined;
  const readyBorder = isReady ? "var(--status-ready-border)" : undefined;
  const borderColor = selected ? "transparent" : relationshipColor ?? riskBorder ?? readyBorder ?? "var(--rule)";
  const restingShadow = relationshipColor !== undefined
    ? "0 0 0 3px rgba(241,234,216,0.060)"
    : isReady
      ? "0 0 0 3px rgba(127,166,216,0.10)"
      : "none";

  return (
    <div
      className={isRunning ? "coral-pulse" : undefined}
      style={{
        width: 292,
        minHeight: expanded ? 202 : 136,
        background: selected
          ? "rgba(180,113,72,0.06)"
          : isReady
            ? "linear-gradient(180deg, rgba(127,166,216,0.10), rgba(24,26,28,0.96) 34%)"
            : "rgba(24,26,28,0.96)",
        border: `1px solid ${borderColor}`,
        borderRadius: 7,
        boxShadow: selected ? selectedShadow : restingShadow,
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
        opacity: node.status === "blocked" ? 0.78 : 1
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: selected === true ? "var(--copper-hi)" : relationshipColor ?? "transparent",
          width: 6,
          height: 6,
          border: "none",
          opacity: handleVisible ? 0.86 : 0
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: selected === true ? "var(--copper-hi)" : relationshipColor ?? "transparent",
          width: 6,
          height: 6,
          border: "none",
          opacity: handleVisible ? 0.86 : 0
        }}
      />

      <div style={{ padding: "12px 13px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <TypeBadge kind={node.kind} />
          <StatusBadge status={nodeUiStatus(node.status, { integrator: node.integrator === true })} />
        </div>

        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.22,
              color: "var(--text)",
              fontWeight: 700,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {node.title}
          </h3>
          {expanded ? (
            <p
              style={{
                margin: "7px 0 0",
                color: "var(--text-2)",
                fontSize: 12.5,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden"
              }}
            >
              {node.description}
            </p>
          ) : null}
        </div>

        {expanded ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MiniMetric label="deps" value={String(node.dependencyCount ?? 0)} />
            <MiniMetric label="paths" value={String(node.expectedFilesCount ?? 0)} />
            {node.traceCount !== undefined && node.traceCount > 0 ? (
              <MiniMetric label="trace" value={String(node.traceCount)} />
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {node.riskLevel !== undefined ? (
            <RiskBadge level={node.riskLevel} />
          ) : (
            <span className="mh-mono" style={{ color: "var(--text-2)", fontSize: 11.5 }}>
              Risk none
            </span>
          )}
          {node.integrator ? <Signal color="var(--copper-hi)" label="integration" /> : null}
          {node.gateRequired ? <Signal color="var(--status-review-fg)" label="review gate" /> : null}
          {isReady ? <Signal color="var(--status-ready-fg)" label="ready now" /> : null}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--rule-soft)",
            paddingTop: 8,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center"
          }}
        >
          <span className="mh-mono" style={{ color: "var(--text-2)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>
            {node.taskId}
          </span>
          <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            {node.actionHint ?? "Review contract"}
          </span>
        </div>

        {node.blockedReason ? (
          <div
            style={{
              color: "var(--status-blocked-fg)",
              fontSize: 12,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {node.blockedReason}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypeBadge({ kind }: { kind: string }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 26,
        padding: "0 9px",
        borderRadius: 999,
        border: "1px solid var(--rule-strong)",
        color: kind === "leaf" ? "var(--copper-hi)" : "var(--text-2)",
        background: "rgba(241,234,216,0.045)",
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      {nodeKindLabel(kind)}
    </span>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        color: "var(--text-2)",
        fontSize: 11.5
      }}
    >
      <strong style={{ color: "var(--text)" }}>{value}</strong>
      {label}
    </span>
  );
}

function RiskBadge({ level }: { level: GraphRiskLevel }): React.ReactElement {
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: riskColor(level),
        fontSize: 11.5
      }}
    >
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      {riskLabel(level)}
    </span>
  );
}

function Signal({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontSize: 11.5 }}>
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      <span className="mh-mono">{label}</span>
    </span>
  );
}

function relationshipAccent(relationship: TaskNodeData["relationship"]): string | undefined {
  switch (relationship) {
    case "selected":
      return "var(--copper)";
    case "ancestor":
      return "var(--status-integrated-fg)";
    case "dependency":
      return "var(--status-ready-fg)";
    case "child":
      return "var(--status-review-fg)";
    default:
      return undefined;
  }
}

export const TaskNodeCard = memo(TaskNodeCardImpl);
