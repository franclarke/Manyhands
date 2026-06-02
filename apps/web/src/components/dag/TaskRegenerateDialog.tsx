"use client";

import { useState } from "react";
import type { InspectorView } from "@/lib/graph-view-model";
import { ModalDialog } from "@/components/ui/modal-dialog";
import {
  DialogActions,
  DialogError,
  DialogField,
  errorMessageFromResponse,
  inputStyle,
  smallButtonStyle
} from "./task-inspector-ui";

export function TaskRegenerateDialog({
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
  const [granularity, setGranularity] = useState<"coarse" | "balanced" | "fine">("balanced");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(view.taskId)}/regen`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ granularity })
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
    <ModalDialog ariaLabel="Regenerate subtree" onClose={onCancel} width={600}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="mh-coord">regenerate subtree</div>
          <div className="mh-serif" style={{ marginTop: 3, color: "var(--text)", fontSize: 20, lineHeight: 1.2 }}>
            {view.taskId}
          </div>
        </div>
        <button type="button" onClick={onCancel} style={smallButtonStyle}>
          Close
        </button>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.55 }}>
          Replace this node&apos;s subtree with a freshly generated graft. The task id is preserved and approval is invalidated.
        </p>
        <DialogField label="Granularity">
          <select
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as "coarse" | "balanced" | "fine")}
            style={inputStyle}
          >
            <option value="coarse">coarse</option>
            <option value="balanced">balanced</option>
            <option value="fine">fine</option>
          </select>
        </DialogField>
        <DialogError message={error} />
        <DialogActions
          onCancel={onCancel}
          primaryLabel={isSaving ? "Regenerating..." : "Regenerate"}
          primaryDisabled={isSaving}
        />
      </form>
    </ModalDialog>
  );
}
