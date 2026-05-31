"use client";

import { useEffect, useState } from "react";
import type { InspectorIntegration, InspectorView } from "@/lib/graph-view-model";
import { nodeUiStatus } from "@/lib/status";
import { canNodeRunNow, nodeActionHint, nodeKindLabel, riskLabel } from "@/lib/run-presentation";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { RunPhase } from "@/lib/run-phase";

interface TaskInspectorProps {
  view: InspectorView | null;
  onClose: () => void;
  /** Run phase drives the default tab + which tabs are relevant. */
  phase?: RunPhase;
  editableRunId?: string;
  onEdited?: () => void;
}

type TabId = "overview" | "contract" | "execution" | "validation" | "trace" | "review";

const TAB_LABEL: Record<TabId, string> = {
  overview: "Overview",
  contract: "Contract",
  execution: "Execution",
  validation: "Validation",
  trace: "Trace",
  review: "Review"
};

function tabsForView(): TabId[] {
  return ["overview", "contract", "execution", "validation", "trace", "review"];
}

/** Default tab for a node given the run phase + what data it carries. */
function defaultTab(view: InspectorView, tabs: TabId[], phase: RunPhase | undefined): TabId {
  const has = (id: TabId): boolean => tabs.includes(id);
  if ((phase === "executing" || phase === "integrating" || phase === "done")) {
    if (phase === "done" && has("review")) return "review";
    if (view.runResult !== undefined && has("execution")) return "execution";
  }
  if (phase === "planning" && has("contract")) return "contract";
  return "overview";
}

const smallButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--rule)",
  color: "var(--text-2)",
  fontSize: 11,
  padding: "3px 8px",
  cursor: "pointer",
  borderRadius: 4,
  fontFamily: "var(--font-mono)"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--rule)",
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

export function TaskInspector({ view, onClose, phase, editableRunId, onEdited }: TaskInspectorProps): React.ReactElement {
  const [tab, setTab] = useState<TabId>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const selectedId = view?.taskId;

  // Reset to the phase-appropriate default tab when the selected node (or phase)
  // changes — so a leaf opens on Contract while a composite opens on Integration.
  useEffect(() => {
    if (view === null) {
      return;
    }
    setTab(defaultTab(view, tabsForView(), phase));
    // Keyed on identity (taskId) + phase, not the view object (new each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, phase]);

  if (view === null) {
    return (
      <aside
        className="mh-tick-frame"
        style={{
          width: 390,
          minWidth: 390,
          height: "min(820px, calc(100vh - 280px))",
          minHeight: 680,
          border: "1px solid var(--rule)",
          background: "rgba(19,20,22,0.74)",
          borderRadius: "var(--r-lg)",
          padding: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-3)",
          fontSize: 13,
          textAlign: "center",
          lineHeight: 1.6
        }}
      >
        <div>
          <div className="mh-coord" style={{ marginBottom: 10 }}>
            inspector
          </div>
          <p className="mh-serif" style={{ margin: 0, fontSize: 17, color: "var(--text-2)" }}>
            Select a node to inspect its contract, execution state, validation and trace.
          </p>
        </div>
      </aside>
    );
  }

  const tabs = tabsForView();

  return (
    <>
      <aside
        className="task-inspector-panel"
        style={{
          width: 390,
          minWidth: 390,
          height: "min(820px, calc(100vh - 280px))",
          minHeight: 680,
          border: "1px solid var(--rule)",
          background: "rgba(19,20,22,0.82)",
          borderRadius: "var(--r-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
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
            gap: 4,
            flexWrap: "wrap",
            borderBottom: "1px solid var(--rule)",
            padding: "8px",
            flexShrink: 0
          }}
        >
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              style={{
                flex: "1 1 31%",
                height: 28,
                padding: "0 6px",
                border: "1px solid var(--rule)",
                background: "transparent",
                borderColor: tab === id ? "var(--copper)" : "var(--rule)",
                borderRadius: 4,
                color: tab === id ? "var(--text)" : "var(--text-2)",
                fontWeight: tab === id ? 600 : 500,
                fontSize: 11.5,
                cursor: "pointer",
                whiteSpace: "nowrap"
              }}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 24px" }}>
          {tab === "overview" && <OverviewTab view={view} />}
          {tab === "contract" && <ContractTab view={view} />}
          {tab === "execution" && <ExecutionTab view={view} />}
          {tab === "validation" && <ValidationTab view={view} />}
          {tab === "trace" && <TraceTab view={view} />}
          {tab === "review" && <ReviewTab view={view} />}
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
  const risk = view.riskEvidence[0]?.level;
  return (
    <header
      style={{
        padding: "15px 18px 14px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <StatusBadge status={nodeUiStatus(view.status, { integrator: view.integrator })} />
          <Tag>{nodeKindLabel(view.kind)}</Tag>
          <Tag tone={risk === "high" || risk === "blocking" ? "danger" : risk !== undefined ? "warning" : "default"}>
            {riskLabel(risk)}
          </Tag>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onEdit !== undefined ? (
            <button type="button" onClick={onEdit} style={smallButtonStyle}>
              Edit
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close inspector" style={smallButtonStyle}>
            Close
          </button>
        </div>
      </div>
      <h3 style={{ margin: 0, fontSize: 20, color: "var(--text)", lineHeight: 1.25, fontWeight: 700 }}>
        {view.title}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 12px" }}>
        <HeaderMeta label="Depth" value={String(view.depth ?? 0)} mono />
        <HeaderMeta label="Agent" value={view.manual ? "Human" : view.integrator ? "Integration agent" : "Codex CLI"} />
        <HeaderMeta label="Node id" value={view.taskId} mono />
        <HeaderMeta label="Primary action" value={nodeActionHint(view)} />
      </div>
    </header>
  );
}

function HeaderMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mh-coord" style={{ fontSize: 8.5 }}>{label}</div>
      <div
        style={{
          marginTop: 3,
          color: "var(--text-2)",
          fontSize: 11.5,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function OverviewTab({ view }: { view: InspectorView }): React.ReactElement {
  const dependencies = view.contract?.dependencies ?? [];
  const expectedOutput = view.contract?.expectedFiles.length
    ? `${view.contract.expectedFiles.length} expected file${view.contract.expectedFiles.length === 1 ? "" : "s"}`
    : view.runResult !== undefined
      ? `${view.runResult.changedFiles.length} changed file${view.runResult.changedFiles.length === 1 ? "" : "s"}`
      : "No expected files declared";
  const risk = view.riskEvidence[0]?.level;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Goal">
        <Prose>{view.goal}</Prose>
      </Section>
      <Section title="Why this node exists">
        <Prose>
          {view.kind === "composite"
            ? "Groups related child nodes so their work can be reviewed and integrated together."
            : view.integrator
              ? "Integrates child outputs and resolves coordination work for this branch of the graph."
              : "Defines one executable unit of software work with scope, acceptance criteria and validation evidence."}
        </Prose>
      </Section>
      <Section title="Run readiness">
        <KvGrid
          rows={[
            { label: "Status", value: view.status.replace("_", " "), mono: false },
            { label: "Node type", value: view.kind, mono: false },
            { label: "Depth", value: String(view.depth ?? 0), mono: true },
            { label: "Dependencies", value: String(dependencies.length), mono: true },
            { label: "Can run now", value: canNodeRunNow(view) ? "yes" : "no", mono: false },
            { label: "Expected output", value: expectedOutput, mono: false },
            { label: "Risk", value: riskLabel(risk), mono: false },
            { label: "Gate", value: view.gateRequired ? "required" : "-", mono: false }
          ]}
        />
      </Section>
      <Section title="Dependencies">
        <MonoList items={dependencies} empty="No declared dependencies." />
      </Section>
      <Section title="Coordination signals">
        {view.riskEvidence.length === 0 && view.staticSignals.length === 0 ? (
          <EmptyHint>No conflict signals reference this task.</EmptyHint>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {view.riskEvidence.slice(0, 3).map((entry, idx) => (
              <Card key={`${entry.pairTaskId}-${idx}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <Tag tone={entry.level === "blocking" || entry.level === "high" ? "danger" : "warning"}>
                    {entry.level}
                  </Tag>
                  <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                    with {entry.pairTaskId}
                  </span>
                </div>
                <Prose>{entry.explanation}</Prose>
              </Card>
            ))}
            {view.staticSignals.slice(0, 2).map((signal) => (
              <Card key={signal.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <Tag tone={signal.severity === "blocking" || signal.severity === "high" ? "danger" : "warning"}>
                    {signal.severity}
                  </Tag>
                  <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                    {signal.type}
                  </span>
                </div>
                <Prose>{signal.detail}</Prose>
              </Card>
            ))}
          </div>
        )}
      </Section>
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
    return <EmptyHint>This composite node has no leaf contract. Inspect a leaf child for scope rules.</EmptyHint>;
  }

  const contract = view.contract;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Objective">
        <Card>
          <Prose>{contract.objective}</Prose>
        </Card>
      </Section>
      <Section title="Allowed paths">
        <MonoList items={contract.allowedPaths} empty="none declared" />
      </Section>
      <Section title="Forbidden paths">
        {contract.forbiddenPaths.length === 0 ? (
          <EmptyHint>No forbidden paths declared.</EmptyHint>
        ) : (
          <div
            style={{
              border: "1px solid var(--status-failed-border)",
              background: "var(--status-failed-bg)",
              borderRadius: "var(--r-md)",
              padding: "10px 12px"
            }}
          >
            <MonoList items={contract.forbiddenPaths} empty="none declared" />
          </div>
        )}
      </Section>
      <Section title="Acceptance criteria">
        <Checklist items={contract.acceptanceCriteria} empty="none declared" />
      </Section>
      <Section title="Definition of done">
        <Prose>{contract.definitionOfDone}</Prose>
      </Section>
      <Section title="Expected files">
        <MonoList items={contract.expectedFiles} empty="none declared" />
      </Section>
      <Section title="Dependencies">
        <LinkedNodeList items={contract.dependencies} empty="none declared" />
      </Section>
    </div>
  );
}

function ExecutionTab({ view }: { view: InspectorView }): React.ReactElement {
  const runResult = view.runResult;
  if (runResult === undefined) {
    const ready = view.status === "ready" || view.status === "approved";
    return (
      <EmptyState
        compact
        tone="pending"
        title={ready ? "Ready to run" : "No execution yet"}
        description="Agent, logs, changed files, validation, errors and duration appear after the node runs in its isolated worktree."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Agent run">
        <KvGrid
          rows={[
            { label: "Agent", value: view.integrator ? "Integration agent" : "Codex CLI", mono: false },
            { label: "Current step", value: nodeActionHint(view), mono: false },
            { label: "Success", value: runResult.success ? "yes" : "no", mono: false },
            { label: "Worktree", value: runResult.worktree, mono: true },
            { label: "Branch", value: runResult.branch, mono: true },
            { label: "Duration", value: `${runResult.durationMs}ms`, mono: true },
            { label: "Cost", value: `$${runResult.costUsd.toFixed(4)}`, mono: true },
            { label: "Changed files", value: String(runResult.changedFiles.length), mono: true },
            { label: "Scope violations", value: String(runResult.scopeViolations.length), mono: true }
          ]}
        />
      </Section>
      <Section title="Changed files">
        <MonoList items={runResult.changedFiles} empty="none" />
      </Section>
      {runResult.scopeViolations.length > 0 ? (
        <Section title="Errors">
          <MonoList items={runResult.scopeViolations} empty="none" />
        </Section>
      ) : null}
      <Section title="Tool calls and live logs">
        <EmptyHint>Detailed tool-call and live-log streams are not recorded for this node yet.</EmptyHint>
      </Section>
      {runResult.diff !== undefined ? (
        <Section title="Diff summary">
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "var(--bg-1)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-md)",
              color: "var(--text-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.55,
              overflowX: "auto",
              maxHeight: 320,
              whiteSpace: "pre"
            }}
          >
            {runResult.diff}
          </pre>
        </Section>
      ) : null}
    </div>
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
        <Tag tone={validation.passed ? "accent" : "danger"}>{validation.passed ? "passed" : "failed"}</Tag>
        <Tag>{validation.checks.length} checks</Tag>
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
                padding: "7px 0",
                borderBottom: "1px solid var(--rule-soft)"
              }}
            >
              <span className="mh-dot" style={{ color: check.passed ? "var(--done)" : "var(--error)" }} />
              <span className="mh-mono" style={{ color: "var(--text)", minWidth: 82 }}>
                {check.kind}
              </span>
              <span style={{ color: "var(--text-2)", flex: 1 }}>{check.summary}</span>
              <span className="mh-mono" style={{ color: "var(--text-3)" }}>
                {check.durationMs}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationResultDetail({
  result
}: {
  result: NonNullable<InspectorIntegration["result"]>;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <KvGrid
        rows={[
          { label: "Status", value: result.status.replace(/_/g, " "), mono: false },
          { label: "Repair attempted", value: result.repairAttempted ? "yes" : "no", mono: false },
          { label: "Commit", value: result.integrationCommitSha ?? "-", mono: true }
        ]}
      />
      {result.conflictDetails !== undefined ? (
        <div>
          <h4 className="mh-coord" style={{ margin: "0 0 6px", color: "var(--copper)" }}>
            Conflicting files
          </h4>
          <MonoList items={result.conflictDetails.files} empty="none" />
        </div>
      ) : null}
    </div>
  );
}

function ReviewTab({ view }: { view: InspectorView }): React.ReactElement {
  const result = view.runResult;
  const integration = view.integration;
  const hasEvidence = result !== undefined || integration !== undefined || view.riskEvidence.length > 0;

  if (!hasEvidence) {
    return (
      <EmptyState
        compact
        tone="pending"
        title="Review evidence pending"
        description="Summary, diff, tests and integration evidence appear here after the node runs or integrates child work."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Summary">
        <Prose>
          {result !== undefined
            ? result.success
              ? `Node completed with ${result.changedFiles.length} changed file${result.changedFiles.length === 1 ? "" : "s"}.`
              : `Node failed with ${result.scopeViolations.length} scope issue${result.scopeViolations.length === 1 ? "" : "s"}.`
            : integration !== undefined
              ? `Integration review for ${integration.children.length} child node${integration.children.length === 1 ? "" : "s"}.`
              : "Review the coordination signals before approving this node."}
        </Prose>
      </Section>

      {integration !== undefined ? (
        <Section title="Integration evidence">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <KvGrid
              rows={[
                { label: "Composite", value: integration.compositeTaskId, mono: true },
                { label: "Children", value: String(integration.children.length), mono: true },
                { label: "Executed", value: `${integration.children.filter((child) => child.executed).length}/${integration.children.length}`, mono: true }
              ]}
            />
            {integration.result === undefined ? (
              <EmptyHint>Cherry-pick, conflict and repair evidence is produced by the execution core.</EmptyHint>
            ) : (
              <IntegrationResultDetail result={integration.result} />
            )}
          </div>
        </Section>
      ) : null}

      {result?.diff !== undefined ? (
        <Section title="Diff">
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "var(--bg-1)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-md)",
              color: "var(--text-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.55,
              overflowX: "auto",
              maxHeight: 260,
              whiteSpace: "pre"
            }}
          >
            {result.diff}
          </pre>
        </Section>
      ) : null}

      <Section title="Tests">
        {view.validation === undefined ? (
          <EmptyHint>No validation result recorded.</EmptyHint>
        ) : (
          <ValidationTab view={view} />
        )}
      </Section>

      <Section title="Risks">
        {view.riskEvidence.length === 0 ? (
          <EmptyHint>No risk evidence references this node.</EmptyHint>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {view.riskEvidence.slice(0, 3).map((risk, idx) => (
              <Card key={`${risk.pairTaskId}-${idx}`}>
                <Tag tone={risk.level === "high" || risk.level === "blocking" ? "danger" : "warning"}>
                  {risk.level}
                </Tag>
                <Prose>{risk.explanation}</Prose>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Review actions">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ReviewButton label="Approve output" />
          <ReviewButton label="Rerun node" />
          <ReviewButton label="Request changes" />
        </div>
        <p style={{ margin: "8px 0 0", color: "var(--text-3)", fontSize: 11.5, lineHeight: 1.45 }}>
          Per-node review actions are shown for workflow clarity; backend actions are not connected in this MVP.
        </p>
      </Section>
    </div>
  );
}

function TraceTab({ view }: { view: InspectorView }): React.ReactElement {
  if (view.traceEvents.length === 0) {
    return <EmptyHint>No trace events recorded for this task.</EmptyHint>;
  }

  return (
    <Section title={`Events / ${view.traceEvents.length}`}>
      <div className="mh-mono" style={{ fontSize: 11, lineHeight: 1.55, color: "var(--text-2)" }}>
        {view.traceEvents.map((event) => (
          <details
            key={event.id}
            style={{
              padding: "7px 0",
              borderBottom: "1px solid var(--rule-soft)"
            }}
          >
            <summary style={{ cursor: "pointer", color: "var(--text)" }}>
              {event.timestamp.split("T")[1]?.slice(0, 8) ?? event.timestamp} / {event.type}
            </summary>
            <div style={{ marginTop: 5, color: "var(--text-3)" }}>
              actor: {event.actor}
              {event.summary !== undefined ? ` / ${event.summary}` : ""}
            </div>
          </details>
        ))}
      </div>
    </Section>
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
  const initialObjective = contract?.objective ?? view.goal;
  const [title, setTitle] = useState(view.title);
  const [objective, setObjective] = useState(initialObjective);
  const [allowedPaths, setAllowedPaths] = useState(textFromLines(contract?.allowedPaths ?? []));
  const [forbiddenPaths, setForbiddenPaths] = useState(textFromLines(contract?.forbiddenPaths ?? []));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(textFromLines(contract?.acceptanceCriteria ?? []));
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
    if (contract !== undefined && !arraysEqual(nextAllowedPaths, contract.allowedPaths)) body.allowedPaths = nextAllowedPaths;
    if (contract !== undefined && !arraysEqual(nextForbiddenPaths, contract.forbiddenPaths)) body.forbiddenPaths = nextForbiddenPaths;
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
        background: "rgba(8,8,7,0.62)",
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
          border: "1px solid var(--rule)",
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
            <div className="mh-coord">edit node</div>
            <div className="mh-serif" style={{ marginTop: 3, color: "var(--text)", fontSize: 20, lineHeight: 1.2 }}>
              {view.taskId}
            </div>
          </div>
          <button type="button" onClick={onCancel} style={smallButtonStyle}>
            Close
          </button>
        </div>

        <DialogField label="Title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} />
        </DialogField>
        <DialogField label="Objective / goal">
          <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} style={textareaStyle} />
        </DialogField>

        {contract !== undefined ? (
          <>
            <DialogField label="Allowed paths">
              <textarea value={allowedPaths} onChange={(event) => setAllowedPaths(event.target.value)} rows={4} style={textareaStyle} />
            </DialogField>
            <DialogField label="Forbidden paths">
              <textarea value={forbiddenPaths} onChange={(event) => setForbiddenPaths(event.target.value)} rows={3} style={textareaStyle} />
            </DialogField>
            <DialogField label="Acceptance criteria">
              <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} rows={4} style={textareaStyle} />
            </DialogField>
          </>
        ) : null}

        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 12.5 }}>
          <input type="checkbox" checked={manual} onChange={(event) => setManual(event.target.checked)} />
          Manual task
        </label>

        {error !== null ? (
          <div
            style={{
              border: "1px solid rgba(178,106,96,0.35)",
              background: "rgba(178,106,96,0.08)",
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

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h4 className="mh-coord" style={{ margin: 0, color: "var(--copper)" }}>
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
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 18px", fontSize: 12 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
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
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
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
            color: "var(--copper)",
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

function Checklist({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} style={{ display: "flex", gap: 8, padding: "4px 0" }}>
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              border: "1px solid var(--rule-strong)",
              borderRadius: 3,
              marginTop: 3,
              flex: "0 0 auto"
            }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function LinkedNodeList({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item) => (
        <span
          key={item}
          className="mh-mono"
          style={{
            border: "1px solid var(--rule)",
            background: "rgba(229,222,204,0.025)",
            color: "var(--text-2)",
            borderRadius: "var(--r-md)",
            padding: "4px 7px",
            fontSize: 11
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ border: "1px solid var(--rule)", background: "var(--bg-1)", padding: "10px 12px", borderRadius: "var(--r-md)" }}>
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
        border: "1px dashed var(--rule)",
        borderRadius: "var(--r-md)",
        lineHeight: 1.5
      }}
    >
      {children}
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p style={{ margin: 0, fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>{children}</p>;
}

function Tag({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "warning" | "danger";
}): React.ReactElement {
  const palette: Record<NonNullable<typeof tone>, string> = {
    default: "var(--text-2)",
    accent: "var(--done)",
    warning: "var(--ready)",
    danger: "var(--error)"
  };
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        color: palette[tone],
        textTransform: "uppercase"
      }}
    >
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      {children}
    </span>
  );
}

function ReviewButton({ label }: { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      disabled
      title="Per-node review actions are not connected in this MVP."
      style={{
        border: "1px solid var(--rule)",
        background: "rgba(229,222,204,0.025)",
        color: "var(--text-3)",
        borderRadius: "var(--r-md)",
        padding: "7px 10px",
        cursor: "not-allowed",
        fontSize: 12,
        opacity: 0.72
      }}
    >
      {label}
    </button>
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
      <span className="mh-coord">{label}</span>
      {children}
    </label>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--rule)",
  background: "transparent",
  color: "var(--text-2)",
  borderRadius: 5,
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 12
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--copper)",
  background: "rgba(180,113,72,0.14)",
  color: "var(--copper-hi)",
  borderRadius: 5,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
};

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
  if (left.length !== right.length) return false;
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
