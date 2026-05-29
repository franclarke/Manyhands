"use client";

import type { ReactNode } from "react";
import type { RunSummary } from "@/lib/run-summary";
import { MetricStat } from "@/components/ui/metric-stat";
import { EmptyState } from "@/components/ui/empty-state";

interface RunSummaryPanelProps {
  summary: RunSummary;
}

/**
 * Run Summary — the "done" mode of the Run Workspace. Operational evidence, not
 * a dashboard: pre-execution structure (real, from the DAG) plus execution
 * outcomes (from agent run results). Integration-level metrics are shown as an
 * explicit pending state until the execution core (Etapa 1) produces them.
 */
export function RunSummaryPanel({ summary }: RunSummaryPanelProps): React.ReactElement {
  const { pre, post } = summary;

  return (
    <section
      className="mh-tick-frame"
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-subtle)",
        borderRadius: "var(--r-lg)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 16
      }}
    >
      <Group label="decomposition">
        <Row>
          <MetricStat value={pre.depth} label="depth" />
          <MetricStat value={pre.leafCount} label="leaves" />
          <MetricStat value={pre.compositeCount} label="composites" />
          <MetricStat value={pre.dependencyCount} label="dependencies" />
          <MetricStat value={pre.avgLeafDepth.toFixed(1)} label="avg leaf depth" />
          <MetricStat value={pre.avgAcceptanceCriteriaPerLeaf.toFixed(1)} label="avg criteria/leaf" />
        </Row>
      </Group>

      <Group label="execution">
        {post.executed ? (
          <Row>
            <MetricStat value={pct(post.leafSuccessRate)} label="leaf success" />
            <MetricStat value={pct(post.testsPassedRate)} label="tests passed" />
            <MetricStat value={duration(post.totalDurationMs)} label="duration" />
            <MetricStat value={cost(post.totalCostUsd)} label="cost" />
            <MetricStat value={post.changedFilesCount ?? 0} label="files changed" />
            <MetricStat
              value={post.scopeViolationCount ?? 0}
              label="scope violations"
              muted={(post.scopeViolationCount ?? 0) === 0}
            />
          </Row>
        ) : (
          <EmptyState
            compact
            tone="pending"
            title="No execution results yet"
            description="Leaf success, tests, duration and cost appear once nodes run (AgentExecutionResult)."
          />
        )}
      </Group>

      <Group label="integration">
        <EmptyState
          compact
          tone="pending"
          title="Integration metrics pending"
          description="Integration success rate and conflict rate are derived from IntegrationResult, produced by the execution core (Etapa 1)."
        />
      </Group>
    </section>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="mh-coord" style={{ color: "var(--color-accent)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 32px" }}>
      {children}
    </div>
  );
}

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function cost(usd: number | undefined): string {
  return usd === undefined ? "—" : `$${usd.toFixed(4)}`;
}
