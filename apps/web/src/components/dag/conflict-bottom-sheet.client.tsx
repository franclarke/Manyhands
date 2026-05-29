"use client";

import { useState } from "react";
import type { ConflictListItem } from "@/lib/conflict-view-model";

interface ConflictBottomSheetProps {
  runId: string;
  conflicts: ConflictListItem[];
  error?: string;
  onChanged: () => void;
  onOpenNodes: (taskIds: [string, string]) => void;
}

type ConflictAction = "integrator" | "serialize" | "acknowledge";

export function ConflictBottomSheet({
  runId,
  conflicts,
  error,
  onChanged,
  onOpenNodes
}: ConflictBottomSheetProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activeCount = conflicts.filter((conflict) => !conflict.acknowledged).length;

  async function runAction(action: ConflictAction, conflict: ConflictListItem): Promise<void> {
    setBusy(`${action}:${conflict.pairKey}`);
    setMessage(null);
    try {
      const response = await fetch(endpointFor(action, runId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyFor(action, conflict))
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : `Request failed with ${response.status}`);
      }
      onChanged();
    } catch (actionError) {
      setMessage(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "absolute",
          right: 14,
          bottom: 14,
          zIndex: 5,
          border: "1px solid var(--rule)",
          background: "rgba(15,16,18,0.78)",
          color: activeCount > 0 ? "var(--ready)" : "var(--text-2)",
          borderRadius: 6,
          padding: "7px 11px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          boxShadow: "none",
          backdropFilter: "blur(10px)"
        }}
      >
        Conflict review / {activeCount}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Task conflicts"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            background: "rgba(12,12,10,0.38)",
            padding: 18
          }}
        >
          <section
            style={{
              width: "min(1120px, calc(100vw - 36px))",
              maxHeight: "min(620px, calc(100vh - 56px))",
              overflow: "hidden",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow-lift)",
              display: "flex",
              flexDirection: "column"
            }}
          >
            <header
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 12
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.16em"
                  }}
                >
                  advanced coordination
                </div>
                <h3 className="mh-serif" style={{ margin: 0, color: "var(--text)", fontSize: 20 }}>
                  Conflict review
                </h3>
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setOpen(false)} style={smallButtonStyle}>
                Close
              </button>
            </header>
            <div style={{ overflowY: "auto", padding: 16 }}>
              {error !== undefined ? (
                <EmptyState>
                  Conflict calculation failed: {error}
                </EmptyState>
              ) : conflicts.length === 0 ? (
                <EmptyState>No task conflicts detected in the current DAG.</EmptyState>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {conflicts.map((conflict) => {
                    const isBusy = busy?.endsWith(conflict.pairKey) ?? false;
                    return (
                      <article
                        key={conflict.pairKey}
                        style={{
                          border: "1px solid var(--border-soft)",
                          background: conflict.acknowledged ? "rgba(237,234,224,0.035)" : "var(--bg-1)",
                          opacity: conflict.acknowledged ? 0.62 : 1,
                          borderRadius: 7,
                          padding: 12,
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <RiskTag level={conflict.level} />
                            {conflict.acknowledged ? <MutedTag>Acknowledged</MutedTag> : null}
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
                              {conflict.pairKey}
                            </span>
                          </div>
                          <div style={{ marginTop: 7, color: "var(--text)", fontSize: 13, fontWeight: 600 }}>
                            {conflict.taskATitle} {"<->"} {conflict.taskBTitle}
                          </div>
                          <p style={{ margin: "6px 0 0", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.45 }}>
                            {conflict.reason}
                          </p>
                          <MetaLine label="shared files" values={conflict.sharedFiles} />
                          <MetaLine label="shared paths" values={conflict.sharedPaths} />
                          <MetaLine label="shared symbols" values={conflict.sharedSymbols} />
                          {conflict.acknowledgedReason !== undefined ? (
                            <p style={{ margin: "6px 0 0", color: "var(--text-3)", fontSize: 11.5 }}>
                              accepted: {conflict.acknowledgedReason}
                            </p>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button type="button" onClick={() => onOpenNodes([conflict.taskAId, conflict.taskBId])} style={smallButtonStyle}>
                            Open affected nodes
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runAction("integrator", conflict)}
                            style={primaryButtonStyle}
                          >
                            Create integration task
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runAction("serialize", conflict)}
                            style={smallButtonStyle}
                          >
                            Serialize
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || conflict.acknowledged}
                            onClick={() => void runAction("acknowledge", conflict)}
                            style={smallButtonStyle}
                          >
                            Mark acceptable risk
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {message !== null ? (
                <div style={{ marginTop: 10, color: "var(--error)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  {message}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function endpointFor(action: ConflictAction, runId: string): string {
  const encoded = encodeURIComponent(runId);
  if (action === "integrator") return `/api/runs/${encoded}/integrator`;
  if (action === "serialize") return `/api/runs/${encoded}/serialize`;
  return `/api/runs/${encoded}/risks/acknowledge`;
}

function bodyFor(action: ConflictAction, conflict: ConflictListItem): Record<string, unknown> {
  if (action === "integrator") {
    return {
      taskIds: [conflict.taskAId, conflict.taskBId],
      reason: truncate(conflict.reason, 900),
      title: `Integrate ${conflict.taskAId} + ${conflict.taskBId}`
    };
  }
  if (action === "serialize") {
    const dependency = conflict.suggestedDependency ?? {
      fromTaskId: conflict.taskAId,
      toTaskId: conflict.taskBId,
      reason: conflict.reason
    };
    return {
      fromTaskId: dependency.fromTaskId,
      toTaskId: dependency.toTaskId,
      rationale: truncate(dependency.reason, 900)
    };
  }
  return {
    taskIds: [conflict.taskAId, conflict.taskBId],
    reason: truncate(conflict.reason, 900)
  };
}

function MetaLine({ label, values }: { label: string; values: string[] }): React.ReactElement | null {
  if (values.length === 0) return null;
  return (
    <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
      {label}: <span style={{ color: "var(--text-2)" }}>{values.slice(0, 4).join(", ")}</span>
      {values.length > 4 ? ` +${values.length - 4}` : ""}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
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
      {children}
    </div>
  );
}

function RiskTag({ level }: { level: string }): React.ReactElement {
  const color = level === "blocking" || level === "high" ? "var(--error)" : "var(--ready)";
  return (
    <span style={{ ...tagStyle, color, borderColor: color }}>
      {level}
    </span>
  );
}

function MutedTag({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ ...tagStyle, color: "var(--text-3)", borderColor: "var(--border)" }}>{children}</span>;
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

const tagStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: 999,
  padding: "2px 7px",
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  textTransform: "uppercase"
};

const smallButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-2)",
  borderRadius: 5,
  padding: "6px 9px",
  cursor: "pointer",
  fontSize: 12
};

const primaryButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid var(--coral)",
  color: "var(--coral-hi)",
  background: "rgba(204,120,92,0.12)",
  fontWeight: 600
};
