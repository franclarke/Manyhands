"use client";

import { useMemo } from "react";
import type { RunSnapshot } from "@manyhands/core";
import { mergeRunTimeline, type TimelineRunInput } from "@/lib/run-timeline";

interface RunTimelineProps {
  run: TimelineRunInput;
  snapshot: RunSnapshot;
  patches: readonly unknown[];
}

export function RunTimeline({ run, snapshot, patches }: RunTimelineProps): React.ReactElement {
  const entries = useMemo(
    () => mergeRunTimeline({ run, snapshot, patches }),
    [run, snapshot, patches]
  );

  return (
    <section
      style={{
        minHeight: 760,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-lift)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <header
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          alignItems: "center"
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-3)",
              letterSpacing: "0.16em",
              textTransform: "uppercase"
            }}
          >
            audit trail
          </div>
          <h3 className="mh-serif" style={{ margin: 0, color: "var(--text)", fontSize: 21 }}>
            Timeline
          </h3>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
          {entries.length} events
        </span>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px 22px" }}>
        {entries.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-soft)",
              background: "var(--bg-1)",
              borderRadius: 7,
              padding: 18,
              color: "var(--text-3)",
              fontSize: 13,
              textAlign: "center"
            }}
          >
            No timeline events have been recorded for this run yet.
          </div>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.id}
              style={{
                display: "grid",
                gridTemplateColumns: "150px 1fr",
                gap: 16,
                padding: "12px 0",
                borderBottom: "1px dashed var(--border-soft)"
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
                <div>{formatTimestamp(entry.timestamp)}</div>
                <div style={{ marginTop: 4, color: actorColor(entry.actor) }}>{entry.actor}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <KindTag kind={entry.kind} />
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>
                    {entry.title}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-3)", fontSize: 10.5 }}>
                    {entry.type}
                  </span>
                </div>
                {entry.summary !== undefined ? (
                  <p style={{ margin: "5px 0 0", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.45 }}>
                    {entry.summary}
                  </p>
                ) : null}
                {entry.taskIds.length > 0 ? (
                  <div style={{ marginTop: 7, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {entry.taskIds.map((taskId) => (
                      <span
                        key={taskId}
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--text-2)",
                          borderRadius: 999,
                          padding: "2px 7px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5
                        }}
                      >
                        {taskId}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function KindTag({ kind }: { kind: string }): React.ReactElement {
  const color = kind === "patch" ? "var(--coral)" : kind === "trace" ? "var(--ready)" : "var(--text-3)";
  return (
    <span
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 999,
        padding: "2px 7px",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        textTransform: "uppercase"
      }}
    >
      {kind}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function actorColor(actor: string): string {
  if (actor === "human") return "var(--coral)";
  if (actor === "agent") return "var(--ready)";
  return "var(--text-3)";
}
