"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GraphNodeStatus, GraphRiskLevel } from "@/lib/graph-view-model";
import { graphStatusColor, riskColor } from "@/lib/status";

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

function TaskNodeCardImpl({ data, selected }: NodeProps): React.ReactElement {
  const node = data as TaskNodeData;
  const statusColor = graphStatusColor(node.status);
  const isRunning = node.status === "running" || node.status === "generating";
  const selectedShadow = "0 0 0 1px var(--copper), 0 0 0 4px rgba(180, 113, 72, 0.12)";
  const borderColor = selected
    ? "transparent"
    : node.riskLevel !== undefined && (node.riskLevel === "high" || node.riskLevel === "blocking")
      ? riskColor(node.riskLevel)
      : "var(--rule)";

  return (
    <div
      className={isRunning ? "coral-pulse" : undefined}
      style={{
        width: 248,
        background: selected ? "rgba(180,113,72,0.04)" : "var(--bg-1)",
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        boxShadow: selected ? selectedShadow : "none",
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
        opacity: node.status === "blocked" ? 0.72 : 1
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderBottom: "1px solid var(--rule-soft)"
        }}
      >
        <TypeGlyph kind={node.kind} />
        <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-2)" }}>
          {node.taskId}
        </span>
        <span className="mh-mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          / {node.kind}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mh-dot" style={{ color: statusColor }} />
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <div
          className="mh-serif"
          style={{
            fontSize: 15,
            lineHeight: 1.22,
            color: "var(--text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}
        >
          {node.title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, minHeight: 16 }}>
          <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
            {(node.expectedFilesCount ?? 0) > 0
              ? `${node.expectedFilesCount} path${node.expectedFilesCount === 1 ? "" : "s"}`
              : "no paths"}
          </span>
          {(node.dependencyCount ?? 0) > 0 ? (
            <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              deps {node.dependencyCount}
            </span>
          ) : null}
          {(node.traceCount ?? 0) > 0 ? (
            <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              trace {node.traceCount}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-2)" }}>
            {node.status.replace("_", " ")}
          </span>
        </div>

        {node.riskLevel !== undefined || node.gateRequired || node.integrator ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {node.riskLevel !== undefined ? (
              <Signal color={riskColor(node.riskLevel)} label={`risk ${node.riskLevel}`} />
            ) : null}
            {node.gateRequired ? <Signal color="var(--gated)" label="gate" /> : null}
            {node.integrator ? <Signal color="var(--copper)" label="integration" /> : null}
          </div>
        ) : null}

        {node.blockedReason ? (
          <div
            style={{
              marginTop: 8,
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
      </div>
    </div>
  );
}

function TypeGlyph({ kind }: { kind: string }): React.ReactElement {
  const letter = kind === "composite"
    ? "C"
    : kind === "leaf"
      ? "L"
      : kind === "integration"
        ? "I"
        : kind === "validation"
          ? "V"
          : kind.slice(0, 1).toUpperCase();
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 2,
        border: "1px solid var(--rule-strong)",
        color: kind === "leaf" ? "var(--copper)" : "var(--text-2)",
        fontSize: 9,
        lineHeight: 1
      }}
    >
      {letter}
    </span>
  );
}

function Signal({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontSize: 10.5 }}>
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      <span className="mh-mono">{label}</span>
    </span>
  );
}

export const TaskNodeCard = memo(TaskNodeCardImpl);
