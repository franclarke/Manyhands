"use client";

import { useMemo, useState } from "react";
import type { InspectorView } from "@/lib/graph-view-model";
import { dependencyFormState } from "@/lib/dependency-validation";
import { ModalDialog } from "@/components/ui/modal-dialog";
import {
  Card,
  DialogActions,
  DialogError,
  DialogField,
  EmptyHint,
  Prose,
  Section,
  errorMessageFromResponse,
  inputStyle,
  smallButtonStyle,
  textareaStyle
} from "./task-inspector-ui";

interface NodeOption {
  id: string;
  title: string;
}

interface DependencyEdge {
  source: string;
  target: string;
  label?: string;
}

export function TaskDependencyDialog({
  runId,
  view,
  availableNodes,
  dependencyEdges,
  onCancel,
  onSaved
}: {
  runId: string;
  view: InspectorView;
  availableNodes: NodeOption[];
  dependencyEdges: DependencyEdge[];
  onCancel: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [fromTaskId, setFromTaskId] = useState("");
  const [toTaskId, setToTaskId] = useState(view.taskId);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const incoming = dependencyEdges.filter((edge) => edge.target === view.taskId);
  const outgoing = dependencyEdges.filter((edge) => edge.source === view.taskId);
  const formState = useMemo(
    () =>
      dependencyFormState({
        nodes: availableNodes,
        edges: dependencyEdges,
        fromTaskId,
        toTaskId
      }),
    [availableNodes, dependencyEdges, fromTaskId, toTaskId]
  );
  const validationMessage = formState.valid ? null : formState.message ?? null;

  async function addDependency(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!formState.valid) {
      return;
    }
    setBusy("add");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/serialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromTaskId,
          toTaskId,
          ...(rationale.trim().length > 0 ? { rationale: rationale.trim() } : {})
        })
      });
      if (!response.ok) {
        setError(await errorMessageFromResponse(response));
        return;
      }
      onSaved();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setBusy(null);
    }
  }

  async function removeDependency(edge: DependencyEdge): Promise<void> {
    setError(null);
    setBusy(`${edge.source}->${edge.target}`);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/dependencies`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromTaskId: edge.source,
          toTaskId: edge.target,
          rationale: "Removed from structured DAG edit mode."
        })
      });
      if (!response.ok) {
        setError(await errorMessageFromResponse(response));
        return;
      }
      onSaved();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModalDialog ariaLabel="Manage dependencies" onClose={onCancel} width={600}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="mh-coord">manage dependencies</div>
          <div className="mh-serif" style={{ marginTop: 3, color: "var(--text)", fontSize: 20, lineHeight: 1.2 }}>
            {view.taskId}
          </div>
        </div>
        <button type="button" onClick={onCancel} style={smallButtonStyle}>
          Close
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Section title="Incoming dependencies">
          <DependencyEdgeList edges={incoming} busy={busy} onRemove={(edge) => void removeDependency(edge)} />
        </Section>
        <Section title="Outgoing dependents">
          <DependencyEdgeList edges={outgoing} busy={busy} onRemove={(edge) => void removeDependency(edge)} />
        </Section>
        <form onSubmit={addDependency} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Section title="Add dependency">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <DialogField label="From">
                <NodeSelect value={fromTaskId} nodes={availableNodes} placeholder="Choose source task" onChange={setFromTaskId} />
              </DialogField>
              <DialogField label="To">
                <NodeSelect value={toTaskId} nodes={availableNodes} placeholder="Choose target task" onChange={setToTaskId} />
              </DialogField>
            </div>
            <div style={{ height: 10 }} />
            <DialogField label="Rationale">
              <textarea
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                rows={3}
                style={textareaStyle}
              />
            </DialogField>
            {validationMessage !== null ? (
              <div className="mh-mono" style={{ marginTop: 8, color: "var(--ready)", fontSize: 11.5 }}>
                {validationMessage}
              </div>
            ) : null}
          </Section>
          <DialogError message={error} />
          <DialogActions
            onCancel={onCancel}
            primaryLabel={busy === "add" ? "Adding..." : "Add dependency"}
            primaryDisabled={busy !== null || !formState.valid}
          />
        </form>
      </div>
    </ModalDialog>
  );
}

function NodeSelect({
  value,
  nodes,
  placeholder,
  onChange
}: {
  value: string;
  nodes: NodeOption[];
  placeholder: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
      <option value="">{placeholder}</option>
      {nodes.map((node) => (
        <option key={node.id} value={node.id}>
          {node.id} / {node.title}
        </option>
      ))}
    </select>
  );
}

function DependencyEdgeList({
  edges,
  busy,
  onRemove
}: {
  edges: DependencyEdge[];
  busy: string | null;
  onRemove: (edge: DependencyEdge) => void;
}): React.ReactElement {
  if (edges.length === 0) {
    return <EmptyHint>No dependencies in this direction.</EmptyHint>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {edges.map((edge) => {
        const key = `${edge.source}->${edge.target}`;
        return (
          <Card key={key}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mh-mono" style={{ color: "var(--text)", fontSize: 11.5, flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                {edge.source} {"->"} {edge.target}
              </span>
              <button
                type="button"
                onClick={() => onRemove(edge)}
                disabled={busy !== null}
                style={smallButtonStyle}
              >
                {busy === key ? "Removing..." : "Remove"}
              </button>
            </div>
            {edge.label !== undefined ? <Prose>{edge.label}</Prose> : null}
          </Card>
        );
      })}
    </div>
  );
}
