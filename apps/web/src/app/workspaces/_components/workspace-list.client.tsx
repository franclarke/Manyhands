"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ApiErrorResponse,
  Workspace,
  WorkspaceCreateRequest,
  WorkspaceResponse,
  WorkspaceUpdateRequest
} from "@/lib/api-types";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";

interface WorkspaceListProps {
  workspaces: Workspace[];
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; workspace: Workspace };

export function WorkspaceList({ workspaces }: WorkspaceListProps): React.ReactElement {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(value: WorkspaceFormValue): Promise<void> {
    setErrorMessage(null);
    const optional = collectOptionalFields(value);

    if (dialog.mode === "create") {
      setBusy("create");
      const payload: WorkspaceCreateRequest = { name: value.name, ...optional };
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        setErrorMessage(await readError(response));
        setBusy(null);
        return;
      }
    } else if (dialog.mode === "edit") {
      setBusy(`edit-${dialog.workspace.id}`);
      const updatePayload: WorkspaceUpdateRequest = { name: value.name, ...optional };
      // description can be cleared explicitly
      updatePayload.description = value.description;
      const response = await fetch(`/api/workspaces/${dialog.workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updatePayload)
      });
      if (!response.ok) {
        setErrorMessage(await readError(response));
        setBusy(null);
        return;
      }
    }

    setBusy(null);
    setDialog({ mode: "closed" });
    router.refresh();
  }

  function collectOptionalFields(value: WorkspaceFormValue): Partial<WorkspaceCreateRequest> {
    const out: Partial<WorkspaceCreateRequest> = {};
    if (value.color !== "") out.color = value.color;
    if (value.repoPath !== "") out.repoPath = value.repoPath;
    if (value.packageManager !== "") out.packageManager = value.packageManager;
    if (value.defaultBranch !== "") out.defaultBranch = value.defaultBranch;
    if (value.testCommand !== "") out.testCommand = value.testCommand;
    if (value.buildCommand !== "") out.buildCommand = value.buildCommand;
    if (value.allowedPaths !== "") {
      const paths = value.allowedPaths
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (paths.length > 0) out.allowedPaths = paths;
    }
    return out;
  }

  async function handleDelete(workspace: Workspace): Promise<void> {
    setErrorMessage(null);
    if (!confirm(`Delete workspace "${workspace.name}"?`)) return;
    setBusy(`delete-${workspace.id}`);
    const response = await fetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
    if (!response.ok) {
      setErrorMessage(await readError(response));
      setBusy(null);
      return;
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap"
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-3)",
            letterSpacing: 0.4
          }}
        >
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"} · persisted at .manyhands/workspaces.json
        </span>
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          style={{
            padding: "7px 14px",
            border: "1px solid var(--coral)",
            background: "var(--coral)",
            color: "#1A1915",
            borderRadius: "var(--r-md)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          + New workspace
        </button>
      </div>

      {errorMessage !== null ? (
        <div
          role="alert"
          style={{
            border: "1px solid rgba(194,91,84,0.55)",
            background: "rgba(194,91,84,0.10)",
            color: "var(--error)",
            padding: "8px 12px",
            borderRadius: "var(--r-md)",
            fontSize: 13
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12
        }}
      >
        {workspaces.map((workspace) => (
          <article
            key={workspace.id}
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              borderRadius: "var(--r-md)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: workspace.color ?? "var(--coral)"
                }}
              />
              <h3 className="mh-serif" style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>
                {workspace.name}
              </h3>
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)"
              }}
            >
              slug · {workspace.slug}
            </div>
            {workspace.description ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                {workspace.description}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
                No description.
              </p>
            )}
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--text-3)",
                display: "flex",
                justifyContent: "space-between"
              }}
            >
              <span>created {formatDate(workspace.createdAt)}</span>
              <span>updated {formatDate(workspace.updatedAt)}</span>
            </div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setDialog({ mode: "edit", workspace })}
                disabled={busy !== null}
                style={{
                  padding: "5px 10px",
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text-2)",
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: busy !== null ? "not-allowed" : "pointer"
                }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDelete(workspace);
                }}
                disabled={busy !== null || workspaces.length <= 1}
                title={workspaces.length <= 1 ? "Cannot delete the last workspace" : undefined}
                style={{
                  padding: "5px 10px",
                  border: "1px solid rgba(194,91,84,0.45)",
                  background: "transparent",
                  color: workspaces.length <= 1 ? "var(--text-3)" : "var(--error)",
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: busy !== null || workspaces.length <= 1 ? "not-allowed" : "pointer"
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {dialog.mode !== "closed" ? (
        <WorkspaceFormDialog
          mode={dialog.mode}
          initial={dialog.mode === "edit" ? formValueFrom(dialog.workspace) : null}
          onCancel={() => setDialog({ mode: "closed" })}
          onSubmit={(value) => {
            void handleSubmit(value);
          }}
          busy={busy !== null}
        />
      ) : null}
    </div>
  );
}

function formValueFrom(workspace: Workspace): WorkspaceFormValue {
  return {
    name: workspace.name,
    description: workspace.description ?? "",
    color: workspace.color ?? "",
    repoPath: workspace.repoPath ?? "",
    packageManager: workspace.packageManager ?? "",
    defaultBranch: workspace.defaultBranch ?? "",
    allowedPaths: (workspace.allowedPaths ?? []).join(", "),
    testCommand: workspace.testCommand ?? "",
    buildCommand: workspace.buildCommand ?? ""
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse | WorkspaceResponse;
    if ("error" in payload) return payload.error;
    return `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}
