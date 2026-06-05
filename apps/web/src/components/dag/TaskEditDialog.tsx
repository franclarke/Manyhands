"use client";

import { useState } from "react";
import type { InspectorView } from "@/lib/graph-view-model";
import { MODEL_OPTIONS, type ExecutorSelection } from "@/lib/models";
import { ModalDialog } from "@/components/ui/modal-dialog";
import {
  DialogActions,
  DialogError,
  DialogField,
  errorMessageFromResponse,
  inputStyle,
  smallButtonStyle,
  textareaStyle
} from "./task-inspector-ui";

export function TaskEditDialog({
  runId,
  view,
  defaultModelId,
  onCancel,
  onSaved
}: {
  runId: string;
  view: InspectorView;
  defaultModelId: string;
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
  const supportsExecutorOverride = view.kind === "leaf" || view.kind === "composite" || view.kind === "root";
  const [executorSelection, setExecutorSelection] = useState(selectionValue(view.executorOverride));
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
      executorSelection?: ExecutorSelection | null;
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
    if (supportsExecutorOverride) {
      const nextExecutorSelection = parseSelectionValue(executorSelection);
      if (!executorSelectionEqual(nextExecutorSelection, view.executorOverride ?? null)) {
        body.executorSelection = nextExecutorSelection;
      }
    }

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
    <ModalDialog ariaLabel="Edit node" onClose={onCancel} width={560}>
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

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

        {supportsExecutorOverride ? (
          <DialogField label={view.kind === "leaf" ? "Execution model" : "Composer repair model"}>
            <select
              value={executorSelection}
              onChange={(event) => setExecutorSelection(event.target.value)}
              style={inputStyle}
            >
              <option value="__default">Run default ({defaultModelId})</option>
              {MODEL_OPTIONS.filter((option) => option.enabled).map((option) => (
                <option key={`${option.executorId}/${option.id}`} value={`${option.executorId}/${option.id}`}>
                  {option.label} ({option.provider})
                </option>
              ))}
            </select>
          </DialogField>
        ) : null}

        <DialogError message={error} />
        <DialogActions
          onCancel={onCancel}
          primaryLabel={isSaving ? "Saving..." : "Save"}
          primaryDisabled={isSaving}
        />
      </form>
    </ModalDialog>
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
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function selectionValue(selection: ExecutorSelection | undefined): string {
  return selection === undefined ? "__default" : `${selection.executorId}/${selection.model}`;
}

function parseSelectionValue(value: string): ExecutorSelection | null {
  if (value === "__default") {
    return null;
  }
  const [executorId, ...modelParts] = value.split("/");
  return { executorId: executorId as ExecutorSelection["executorId"], model: modelParts.join("/") };
}

function executorSelectionEqual(
  left: ExecutorSelection | null,
  right: ExecutorSelection | null
): boolean {
  return left?.executorId === right?.executorId && left?.model === right?.model;
}
