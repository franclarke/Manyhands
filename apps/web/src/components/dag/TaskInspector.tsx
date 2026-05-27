"use client";

import { useState } from "react";
import type { InspectorView } from "@/lib/graph-view-model";

interface TaskInspectorProps {
  view: InspectorView | null;
  onClose: () => void;
  editableRunId?: string;
  onEdited?: () => void;
}

type TabId = "overview" | "contract" | "risks" | "trace" | "validation" | "diff";

interface TabSpec {
  id: TabId;
  label: string;
  count?: number;
}

const smallHeaderButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-2)",
  fontSize: 11,
  padding: "2px 8px",
  cursor: "pointer",
  borderRadius: 4,
  fontFamily: "var(--font-mono)"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  background: "var(--bg-1)",
  color: "var(--text)",
  borderRadius: 5,
  padding: "9px 10px",
  fontSize: 13,
  outline: "none"
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.45,
  fontFamily: "var(--font-sans)"
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-2)",
  borderRadius: 5,
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 12
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--coral)",
  background: "rgba(204,120,92,0.14)",
  color: "var(--coral-hi)",
  borderRadius: 5,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
};

export function TaskInspector({ view, onClose, editableRunId, onEdited }: TaskInspectorProps): React.ReactElement {
  const [tab, setTab] = useState<TabId>("overview");
  const [isEditing, setIsEditing] = useState(false);

  if (view === null) {
    return (
      <aside
        style={{
          width: 380,
          minWidth: 380,
          height: 760,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          borderRadius: "var(--r-lg)",
          padding: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-3)",
          fontSize: 13,
          textAlign: "center",
          lineHeight: 1.6,
          boxShadow: "var(--shadow-lift)"
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 10
            }}
          >
            inspector
          </div>
          <p className="mh-serif" style={{ margin: 0, fontSize: 17, color: "var(--text-2)" }}>
            Select a node to inspect its contract, risk evidence, trace events and mock diff.
          </p>
        </div>
      </aside>
    );
  }

  const tabs: TabSpec[] = [
    { id: "overview",   label: "Overview" },
    { id: "contract",   label: "Contract",   ...(view.contract ? {} : { count: 0 }) },
    { id: "risks",      label: "Risks",      count: view.riskEvidence.length + view.staticSignals.length },
    { id: "trace",      label: "Trace",      count: view.traceEvents.length },
    { id: "validation", label: "Validation", count: view.validation?.checks.length ?? 0 },
    { id: "diff",       label: "Diff",       count: view.runResult?.diff !== undefined ? 1 : 0 }
  ];

  return (
    <>
    <aside
      style={{
        width: 380,
        minWidth: 380,
        height: 760,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "var(--shadow-lift)"
      }}
    >
      <InspectorHeader
        view={view}
        onClose={onClose}
        {...(editableRunId !== undefined ? { onEdit: () => setIsEditing(true) } : {})}
      />

      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 0,
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border)",
          padding: "0 6px",
          overflowX: "auto",
          flexShrink: 0
        }}
      >
        {tabs.map((spec) => (
          <button
            key={spec.id}
            type="button"
            role="tab"
            aria-selected={tab === spec.id}
            onClick={() => setTab(spec.id)}
            style={{
              height: 34,
              padding: "0 10px",
              border: "none",
              background: "transparent",
              borderBottom: tab === spec.id ? "2px solid var(--coral)" : "2px solid transparent",
              color: tab === spec.id ? "var(--text)" : "var(--text-2)",
              fontWeight: tab === spec.id ? 600 : 500,
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap"
            }}
          >
            {spec.label}
            {spec.count !== undefined ? (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--text-3)"
                }}
              >
                {spec.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 24px" }}>
        {tab === "overview" && <OverviewTab view={view} />}
        {tab === "contract" && <ContractTab view={view} />}
        {tab === "risks" && <RisksTab view={view} />}
        {tab === "trace" && <TraceTab view={view} />}
        {tab === "validation" && <ValidationTab view={view} />}
        {tab === "diff" && <DiffTab view={view} />}
      </div>
    </aside>
    {editableRunId !== undefined && isEditing ? (
      <TaskEditDialog
        runId={editableRunId}
        view={view}
        onCancel={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onEdited?.();
        }}
      />
    ) : null}
    </>
  );
}

function InspectorHeader({
  view,
  onClose,
  onEdit
}: {
  view: InspectorView;
  onClose: () => void;
  onEdit?: () => void;
}): React.ReactElement {
  const isRunning = view.status === "running";
  return (
    <header
      style={{
        padding: "14px 18px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusPill status={view.status} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-3)"
            }}
          >
            depth {view.depth ?? 0} · {view.kind}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onEdit !== undefined ? (
            <button type="button" onClick={onEdit} style={smallHeaderButtonStyle}>
              Edit
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            style={smallHeaderButtonStyle}
          >
            ✕
          </button>
        </div>
      </div>
      <h3
        className="mh-serif"
        style={{
          margin: 0,
          fontSize: 19,
          color: "var(--text)",
          lineHeight: 1.25,
          letterSpacing: "-0.01em"
        }}
      >
        {view.title}
      </h3>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-2)",
          wordBreak: "break-all"
        }}
        title={view.taskId}
      >
        task_id <span style={{ color: "var(--text)" }}>{view.taskId}</span>
      </div>
      {view.gateRequired ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            border: "1px solid rgba(201,164,92,0.55)",
            background: "rgba(201,164,92,0.10)",
            color: "var(--gated)",
            fontSize: 11,
            borderRadius: 999,
            alignSelf: "flex-start",
            fontFamily: "var(--font-mono)",
            letterSpacing: 0.4
          }}
        >
          gate required
        </div>
      ) : null}
      {isRunning ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            border: "1px solid var(--coral)",
            background: "rgba(204,120,92,0.10)",
            color: "var(--coral-hi)",
            fontSize: 11,
            borderRadius: 999,
            alignSelf: "flex-start",
            fontFamily: "var(--font-mono)"
          }}
          className="coral-pulse"
        >
          running · mock
        </div>
      ) : null}
    </header>
  );
}

function TaskEditDialog({
  runId,
  view,
  onCancel,
  onSaved
}: {
  runId: string;
  view: InspectorView;
  onCancel: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const contract = view.contract;
  const initialObjective = contract?.objective ?? view.intent;
  const [title, setTitle] = useState(view.title);
  const [objective, setObjective] = useState(initialObjective);
  const [allowedPaths, setAllowedPaths] = useState(textFromLines(contract?.allowedPaths ?? []));
  const [forbiddenPaths, setForbiddenPaths] = useState(textFromLines(contract?.forbiddenPaths ?? []));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    textFromLines(contract?.acceptanceCriteria ?? [])
  );
  const [manual, setManual] = useState(view.manual);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const body: {
      title?: string;
      objective?: string;
      allowedPaths?: string[];
      forbiddenPaths?: string[];
      acceptanceCriteria?: string[];
      manual?: boolean;
    } = {};
    const nextTitle = title.trim();
    const nextObjective = objective.trim();
    const nextAllowedPaths = linesFromText(allowedPaths);
    const nextForbiddenPaths = linesFromText(forbiddenPaths);
    const nextAcceptanceCriteria = linesFromText(acceptanceCriteria);

    if (nextTitle !== view.title) body.title = nextTitle;
    if (nextObjective !== initialObjective) body.objective = nextObjective;
    if (contract !== undefined && !arraysEqual(nextAllowedPaths, contract.allowedPaths)) {
      body.allowedPaths = nextAllowedPaths;
    }
    if (contract !== undefined && !arraysEqual(nextForbiddenPaths, contract.forbiddenPaths)) {
      body.forbiddenPaths = nextForbiddenPaths;
    }
    if (contract !== undefined && !arraysEqual(nextAcceptanceCriteria, contract.acceptanceCriteria)) {
      body.acceptanceCriteria = nextAcceptanceCriteria;
    }
    if (manual !== view.manual) body.manual = manual;

    if (Object.keys(body).length === 0) {
      setError("No changes to save.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(view.taskId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      if (!response.ok) {
        setError(await errorMessageFromResponse(response));
        return;
      }
      onSaved();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(12,12,10,0.58)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 560,
          maxWidth: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-lift)",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
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
              edit task
            </div>
            <div
              className="mh-serif"
              style={{ marginTop: 3, color: "var(--text)", fontSize: 20, lineHeight: 1.2 }}
            >
              {view.taskId}
            </div>
          </div>
          <button type="button" onClick={onCancel} style={smallHeaderButtonStyle}>
            Close
          </button>
        </div>

        <DialogField label="Title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} />
        </DialogField>

        <DialogField label="Objective / intent">
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            rows={4}
            style={textareaStyle}
          />
        </DialogField>

        {contract !== undefined ? (
          <>
            <DialogField label="Allowed paths">
              <textarea
                value={allowedPaths}
                onChange={(event) => setAllowedPaths(event.target.value)}
                rows={4}
                style={textareaStyle}
              />
            </DialogField>
            <DialogField label="Forbidden paths">
              <textarea
                value={forbiddenPaths}
                onChange={(event) => setForbiddenPaths(event.target.value)}
                rows={3}
                style={textareaStyle}
              />
            </DialogField>
            <DialogField label="Acceptance criteria">
              <textarea
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
                rows={4}
                style={textareaStyle}
              />
            </DialogField>
          </>
        ) : null}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--text-2)",
            fontSize: 12.5
          }}
        >
          <input
            type="checkbox"
            checked={manual}
            onChange={(event) => setManual(event.target.checked)}
          />
          Manual task
        </label>

        {error !== null ? (
          <div
            style={{
              border: "1px solid rgba(194,91,84,0.35)",
              background: "rgba(194,91,84,0.08)",
              color: "var(--error)",
              borderRadius: "var(--r-md)",
              padding: "9px 10px",
              fontSize: 12,
              lineHeight: 1.45
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="submit" disabled={isSaving} style={primaryButtonStyle}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DialogField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          color: "var(--text-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.14em"
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function linesFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function textFromLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function errorMessageFromResponse(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // fall through to the status text
  }
  return response.statusText || `Request failed with ${response.status}`;
}

function OverviewTab({ view }: { view: InspectorView }): React.ReactElement {
  const runResult = view.runResult;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Summary">
        <KvGrid
          rows={[
            { label: "Status", value: view.status, mono: false },
            { label: "Kind", value: view.kind, mono: false },
            { label: "Depth", value: String(view.depth ?? 0), mono: true },
            { label: "Risk", value: highestRisk(view) ?? "none", mono: false },
            { label: "Gate", value: view.gateRequired ? "required" : "—", mono: false },
            { label: "Author", value: view.authoredBy ?? "unknown", mono: false },
            { label: "Manual", value: view.manual ? "yes" : "no", mono: false },
            { label: "Dependencies", value: String(view.contract?.dependencies.length ?? 0), mono: true },
            { label: "Risk pairs", value: String(view.riskEvidence.length), mono: true },
            { label: "Static signals", value: String(view.staticSignals.length), mono: true },
            { label: "Trace events", value: String(view.traceEvents.length), mono: true }
          ]}
        />
      </Section>

      {runResult ? (
        <Section title="Mock execution">
          <KvGrid
            rows={[
              { label: "Success", value: runResult.success ? "yes" : "no", mono: false },
              { label: "Worktree", value: runResult.worktree, mono: true },
              { label: "Branch", value: runResult.branch, mono: true },
              { label: "Duration", value: `${runResult.durationMs}ms`, mono: true },
              { label: "Cost", value: `$${runResult.costUsd.toFixed(3)}`, mono: true },
              { label: "Changed files", value: String(runResult.changedFiles.length), mono: true },
              { label: "Scope violations", value: String(runResult.scopeViolations.length), mono: true }
            ]}
          />
        </Section>
      ) : (
        <EmptyHint>
          No mock execution result. Task may be composite, blocked, or not yet executed.
        </EmptyHint>
      )}

      {view.blockedReason ? (
        <Section title="Blocked">
          <div style={{ color: "var(--error)", fontSize: 12.5, lineHeight: 1.55 }}>
            {view.blockedReason}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function ContractTab({ view }: { view: InspectorView }): React.ReactElement {
  if (view.contract === undefined) {
    return (
      <EmptyHint>
        This node does not carry an <span style={{ fontFamily: "var(--font-mono)" }}>AgentTaskContract</span> — likely a composite parent. Inspect a leaf child for contract details.
      </EmptyHint>
    );
  }

  const contract = view.contract;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Objective">
        <Prose>{contract.objective}</Prose>
      </Section>
      <Section title="Definition of done">
        <Prose>{contract.definitionOfDone}</Prose>
      </Section>
      <Section title={`Acceptance criteria · ${contract.acceptanceCriteria.length}`}>
        <ProseList items={contract.acceptanceCriteria} empty="none declared" />
      </Section>
      <Section title="Limits">
        <KvGrid
          rows={[
            { label: "Max duration", value: `${contract.maxDurationMs}ms`, mono: true },
            { label: "Max cost", value: `$${contract.maxCostUsd.toFixed(3)}`, mono: true }
          ]}
        />
      </Section>
      <Section title={`Allowed paths · ${contract.allowedPaths.length}`}>
        <MonoList items={contract.allowedPaths} empty="none declared" />
      </Section>
      <Section title={`Forbidden paths · ${contract.forbiddenPaths.length}`}>
        <MonoList items={contract.forbiddenPaths} empty="none declared" />
      </Section>
      <Section title={`Expected files · ${contract.expectedFiles.length}`}>
        <MonoList items={contract.expectedFiles} empty="none" />
      </Section>
      <Section title={`Produced symbols · ${contract.producedSymbols.length}`}>
        <MonoList items={contract.producedSymbols} empty="none" />
      </Section>
      <Section title={`Consumed symbols · ${contract.consumedSymbols.length}`}>
        <MonoList items={contract.consumedSymbols} empty="none" />
      </Section>
      <Section title={`Dependencies · ${contract.dependencies.length}`}>
        <MonoList items={contract.dependencies} empty="none" />
      </Section>
      <Section title={`Known risks · ${contract.knownRisks.length}`}>
        <ProseList items={contract.knownRisks} empty="none declared" />
      </Section>
    </div>
  );
}

function RisksTab({ view }: { view: InspectorView }): React.ReactElement {
  if (view.riskEvidence.length === 0 && view.staticSignals.length === 0) {
    return <EmptyHint>No conflict predictions or static signals reference this task.</EmptyHint>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title={`Risk evidence · ${view.riskEvidence.length}`}>
        {view.riskEvidence.length === 0 ? (
          <EmptyHint>No conflict predictions involve this task.</EmptyHint>
        ) : (
          view.riskEvidence.map((entry, idx) => (
            <Card key={`${entry.pairTaskId}-${idx}`}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 6,
                  gap: 8
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--coral)",
                    wordBreak: "break-all"
                  }}
                >
                  {entry.pairTaskId}
                </span>
                <Tag
                  tone={entry.level === "blocking" || entry.level === "high" ? "danger" : "warning"}
                >
                  {entry.level} · {entry.recommendation}
                </Tag>
              </div>
              <Prose>{entry.explanation}</Prose>
              {entry.sharedFiles.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <Caption>shared files</Caption>
                  <MonoList items={entry.sharedFiles} empty="—" />
                </div>
              ) : null}
              {entry.sharedSymbols.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <Caption>shared symbols</Caption>
                  <MonoList items={entry.sharedSymbols} empty="—" />
                </div>
              ) : null}
            </Card>
          ))
        )}
      </Section>

      <Section title={`Static signals · ${view.staticSignals.length}`}>
        {view.staticSignals.length === 0 ? (
          <EmptyHint>No static conflict signals reference this task.</EmptyHint>
        ) : (
          view.staticSignals.map((signal) => (
            <Card key={signal.id}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text)"
                  }}
                >
                  {signal.type}
                </span>
                <Tag
                  tone={signal.severity === "blocking" || signal.severity === "high" ? "danger" : "warning"}
                >
                  {signal.severity}
                </Tag>
              </div>
              <Prose>{signal.detail}</Prose>
              {signal.pairTaskId ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10.5,
                    color: "var(--text-3)",
                    fontFamily: "var(--font-mono)"
                  }}
                >
                  pair · {signal.pairTaskId}
                </div>
              ) : null}
            </Card>
          ))
        )}
      </Section>
    </div>
  );
}

function TraceTab({ view }: { view: InspectorView }): React.ReactElement {
  if (view.traceEvents.length === 0) {
    return <EmptyHint>No trace events recorded for this task.</EmptyHint>;
  }

  return (
    <Section title={`Events · ${view.traceEvents.length}`}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.55,
          color: "var(--text-2)"
        }}
      >
        {view.traceEvents.map((event) => (
          <div
            key={event.id}
            style={{
              padding: "6px 0",
              borderBottom: "1px dashed var(--border-soft)"
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--text-3)" }}>
                {event.timestamp.split("T")[1]?.slice(0, 8) ?? event.timestamp}
              </span>
              <span style={{ color: "var(--text)" }}>{event.type}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>{event.actor}</span>
            </div>
            {event.summary ? (
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>{event.summary}</div>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

function ValidationTab({ view }: { view: InspectorView }): React.ReactElement {
  const validation = view.validation;
  if (validation === undefined) {
    return <EmptyHint>No validation result recorded for this task.</EmptyHint>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Tag tone={validation.passed ? "accent" : "danger"}>
          {validation.passed ? "passed" : "failed"}
        </Tag>
        <Tag>{validation.checks.length} checks</Tag>
        <Tag tone="default">mock validation</Tag>
      </div>
      {validation.checks.length === 0 ? (
        <EmptyHint>No validation checks recorded.</EmptyHint>
      ) : (
        <div style={{ fontSize: 12, lineHeight: 1.55 }}>
          {validation.checks.map((check, idx) => (
            <div
              key={`${check.kind}-${idx}`}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px dashed var(--border-soft)"
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: check.passed ? "var(--done)" : "var(--error)"
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--text)",
                  minWidth: 80
                }}
              >
                {check.kind}
              </span>
              <span style={{ color: "var(--text-2)", flex: 1 }}>{check.summary}</span>
              <span
                style={{
                  color: "var(--text-3)",
                  fontFamily: "var(--font-mono)"
                }}
              >
                {check.durationMs}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffTab({ view }: { view: InspectorView }): React.ReactElement {
  const runResult = view.runResult;
  if (runResult === undefined) {
    return <EmptyHint>No mock execution result. There is no diff to display.</EmptyHint>;
  }
  if (runResult.diff === undefined) {
    return (
      <EmptyHint>
        Mock execution recorded no diff payload.{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>changedFiles</span>:{" "}
        {runResult.changedFiles.length === 0 ? "none" : runResult.changedFiles.length}.
      </EmptyHint>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Tag tone="warning">simulated diff · not from real execution</Tag>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: "var(--bg-1)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--r-md)",
          color: "var(--text-2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.55,
          overflowX: "auto",
          maxHeight: 480,
          whiteSpace: "pre"
        }}
      >
        {runResult.diff}
      </pre>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h4
        style={{
          margin: 0,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--coral)",
          fontFamily: "var(--font-mono)"
        }}
      >
        {title}
      </h4>
      <div>{children}</div>
    </section>
  );
}

function KvGrid({
  rows
}: {
  rows: Array<{ label: string; value: string; mono?: boolean }>;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px 18px",
        fontSize: 12
      }}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}
        >
          <span style={{ color: "var(--text-3)" }}>{row.label}</span>
          <span
            style={{
              color: "var(--text)",
              fontFamily: row.mono ? "var(--font-mono)" : "var(--font-sans)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
            title={row.value}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function MonoList({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>
    );
  }
  const limit = 8;
  const displayed = showAll ? items : items.slice(0, limit);
  return (
    <div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 0,
          listStyle: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--text-2)",
          lineHeight: 1.55
        }}
      >
        {displayed.map((item, idx) => (
          <li key={`${item}-${idx}`} style={{ wordBreak: "break-word" }}>
            {item}
          </li>
        ))}
      </ul>
      {items.length > limit ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--coral)",
            fontSize: 11,
            fontFamily: "var(--font-mono)"
          }}
        >
          {showAll ? "show less" : `show ${items.length - limit} more`}
        </button>
      ) : null}
    </div>
  );
}

function ProseList({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: 16,
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.55
      }}
    >
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`}>{item}</li>
      ))}
    </ul>
  );
}

function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid var(--border-soft)",
        background: "var(--bg-1)",
        padding: "10px 12px",
        marginBottom: 8,
        borderRadius: "var(--r-md)"
      }}
    >
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--text-3)",
        fontStyle: "italic",
        padding: "10px 12px",
        border: "1px dashed var(--border-soft)",
        background: "var(--bg-1)",
        borderRadius: "var(--r-md)",
        lineHeight: 1.5
      }}
    >
      {children}
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12.5,
        color: "var(--text)",
        lineHeight: 1.6
      }}
    >
      {children}
    </p>
  );
}

function Caption({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        color: "var(--text-3)",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 3,
        fontFamily: "var(--font-mono)"
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }): React.ReactElement {
  const map: Record<string, { fg: string; border: string; bg: string }> = {
    planned: { fg: "var(--text-2)", border: "var(--border)", bg: "var(--surface-2)" },
    ready:   { fg: "var(--ready)",  border: "rgba(201,164,92,0.55)", bg: "rgba(201,164,92,0.10)" },
    running: { fg: "var(--coral)",  border: "var(--coral)", bg: "rgba(204,120,92,0.10)" },
    gated:   { fg: "var(--gated)",  border: "rgba(201,164,92,0.55)", bg: "rgba(201,164,92,0.10)" },
    done:    { fg: "var(--done)",   border: "rgba(107,142,107,0.55)", bg: "rgba(107,142,107,0.10)" },
    failed:  { fg: "var(--error)",  border: "rgba(194,91,84,0.55)",  bg: "rgba(194,91,84,0.10)" },
    blocked: { fg: "var(--blocked)", border: "var(--border)", bg: "var(--surface-2)" }
  };
  const tone = map[status] ?? map.planned!;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.fg,
        fontSize: 10.5,
        fontWeight: 500
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: tone.fg }} />
      {status}
    </span>
  );
}

function Tag({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "warning" | "danger";
}): React.ReactElement {
  const palette: Record<NonNullable<typeof tone>, { fg: string; bg: string; border: string }> = {
    default: { fg: "var(--text-2)", bg: "var(--surface-2)", border: "var(--border)" },
    accent:  { fg: "var(--coral)",  bg: "rgba(204,120,92,0.10)", border: "rgba(204,120,92,0.45)" },
    warning: { fg: "var(--ready)",  bg: "rgba(201,164,92,0.10)", border: "rgba(201,164,92,0.55)" },
    danger:  { fg: "var(--error)",  bg: "rgba(194,91,84,0.10)",  border: "rgba(194,91,84,0.55)" }
  };
  const color = palette[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        border: `1px solid ${color.border}`,
        background: color.bg,
        color: color.fg,
        fontFamily: "var(--font-mono)"
      }}
    >
      {children}
    </span>
  );
}

function highestRisk(view: InspectorView): string | undefined {
  const ranks = { low: 0, medium: 1, high: 2, blocking: 3 } as const;
  let best: keyof typeof ranks | undefined;
  for (const entry of view.riskEvidence) {
    if (best === undefined || ranks[entry.level] > ranks[best]) {
      best = entry.level;
    }
  }
  return best;
}
