"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorResponse, ProviderReadiness, ProviderReadinessResponse, RunResponse, Workspace } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "./model-picker.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";
import { toGranularityMode, isGranularityLevel, GRANULARITY_DISPLAY_OPTIONS, type GranularityLevel } from "@/lib/granularity";

const PROMPT_STORAGE_KEY = "manyhands:lastPrompt";
const EXAMPLE_PROMPTS = [
  "Add passwordless login with magic links, tests, and session handling.",
  "Refactor the task API validation and update the failing tests.",
  "Implement DELETE /tasks/:id with persistence, errors, and coverage."
] as const;

interface CommandCenterShellProps {
  workspaces: Workspace[];
  initialGranularity: GranularityLevel;
  initialModelId: string;
}

export function CommandCenterShell({
  workspaces: initialWorkspaces,
  initialGranularity,
  initialModelId
}: CommandCenterShellProps): React.ReactElement {
  const router = useRouter();

  // We keep a local state of workspaces so that workspace additions/edits/deletions
  // update the list instantly without relying solely on next.js refresh cycles.
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  useEffect(() => {
    setWorkspaces(initialWorkspaces);
  }, [initialWorkspaces]);

  const initialWorkspaceId =
    workspaces.find((entry) => entry.repoPath !== undefined && entry.repoPath.length > 0)?.id ??
    workspaces[0]?.id ??
    "";
  const [workspaceId, setWorkspaceId] = useState<string>(initialWorkspaceId);

  // If the list of workspaces updates and our current selection is no longer valid,
  // sync the selection to the first valid workspace.
  useEffect(() => {
    if (workspaceId.length > 0 && !workspaces.some(w => w.id === workspaceId)) {
      const nextWs = workspaces.find((entry) => entry.repoPath !== undefined && entry.repoPath.length > 0)?.id ??
        workspaces[0]?.id ??
        "";
      setWorkspaceId(nextWs);
    }
  }, [workspaces, workspaceId]);

  const [granularity, setGranularity] = useState<GranularityLevel>(initialGranularity);
  const [modelId, setModelId] = useState<string>(initialModelId);
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  // Workspace Dialog Management State
  const [workspaceFormOpen, setWorkspaceFormOpen] = useState<"closed" | "create" | "edit">("closed");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(PROMPT_STORAGE_KEY);
    if (stored !== null && stored.length > 0) {
      setPrompt(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prompt.length === 0) {
      window.sessionStorage.removeItem(PROMPT_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(PROMPT_STORAGE_KEY, prompt);
    }
  }, [prompt]);

  useEffect(() => {
    let cancelled = false;
    async function loadReadiness(): Promise<void> {
      if (workspaceId.length === 0) {
        setReadiness(null);
        return;
      }
      setReadinessLoading(true);
      setReadinessError(null);
      try {
        const response = await fetch(`/api/providers/readiness?workspaceId=${encodeURIComponent(workspaceId)}`);
        const payload = (await response.json()) as ProviderReadinessResponse | ApiErrorResponse;
        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : `Request failed with ${response.status}`);
        }
        if (!cancelled) {
          setReadiness((payload as ProviderReadinessResponse).providers[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setReadiness(null);
          setReadinessError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setReadinessLoading(false);
        }
      }
    }
    void loadReadiness();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? workspaces[0] ?? null,
    [workspaces, workspaceId]
  );

  const granularityMode = toGranularityMode(granularity);
  const hasPrompt = prompt.trim().length > 0;
  const hasLocalRepo = selectedWorkspace?.repoPath !== undefined && selectedWorkspace.repoPath.length > 0;
  const canStart =
    selectedWorkspace !== null &&
    hasPrompt &&
    hasLocalRepo &&
    modelId.trim().length > 0 &&
    !submitting;

  async function handleStart(): Promise<void> {
    if (selectedWorkspace === null) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const body: {
        workspaceId: string;
        granularity: string;
        model: string;
        userPrompt: string;
        repoSpec?: { kind: "localPath"; path: string };
      } = {
        workspaceId: selectedWorkspace.id,
        granularity: granularityMode,
        model: modelId,
        userPrompt: prompt.trim()
      };
      if (selectedWorkspace.repoPath !== undefined) {
        body.repoSpec = { kind: "localPath", path: selectedWorkspace.repoPath };
      }
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as RunResponse | ApiErrorResponse;
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : `Request failed with ${response.status}`);
      }
      const runId = (payload as RunResponse).run.runId;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PROMPT_STORAGE_KEY);
      }
      router.push(`/runs/${runId}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canStart) void handleStart();
    }
  }

  // Workspace CRUD operations
  async function handleWorkspaceSubmit(value: WorkspaceFormValue): Promise<void> {
    setErrorMessage(null);
    setWorkspaceBusy(true);

    const collectOptionalFields = (val: WorkspaceFormValue) => {
      const out: any = {};
      if (val.color !== "") out.color = val.color;
      if (val.repoPath !== "") out.repoPath = val.repoPath;
      if (val.packageManager !== "") out.packageManager = val.packageManager;
      if (val.defaultBranch !== "") out.defaultBranch = val.defaultBranch;
      if (val.testCommand !== "") out.testCommand = val.testCommand;
      if (val.buildCommand !== "") out.buildCommand = val.buildCommand;
      if (val.allowedPaths !== "") {
        const paths = val.allowedPaths
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (paths.length > 0) out.allowedPaths = paths;
      }
      return out;
    };

    const optional = collectOptionalFields(value);

    try {
      if (workspaceFormOpen === "create") {
        const payload = { name: value.name, ...optional };
        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const data = await response.json();
        if (data.workspace?.id) {
          // Add to local state and select it
          setWorkspaces((current) => [...current, data.workspace]);
          setWorkspaceId(data.workspace.id);
        }
      } else if (workspaceFormOpen === "edit" && selectedWorkspace) {
        const payload = { name: value.name, ...optional, description: value.description };
        const response = await fetch(`/api/workspaces/${selectedWorkspace.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const data = await response.json();
        if (data.workspace) {
          // Update local state
          setWorkspaces((current) =>
            current.map((w) => (w.id === data.workspace.id ? data.workspace : w))
          );
        }
      }
      setWorkspaceFormOpen("closed");
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleWorkspaceDelete(): Promise<void> {
    if (!selectedWorkspace) return;
    if (!confirm(`Delete workspace "${selectedWorkspace.name}"?`)) return;
    setErrorMessage(null);
    setWorkspaceBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${selectedWorkspace.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      // Remove from local state
      const remaining = workspaces.filter(w => w.id !== selectedWorkspace.id);
      setWorkspaces(remaining);
      const nextWs = remaining[0];
      if (nextWs !== undefined) {
        setWorkspaceId(nextWs.id);
      } else {
        setWorkspaceId("");
      }
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  const readinessTooltip = useMemo(() => {
    if (readinessLoading) return "Checking Gemini CLI status...";
    if (readinessError) return `Error checking readiness: ${readinessError}`;
    if (!readiness) return "Readiness status unknown";
    const checksStr = readiness.checks
      .map((check) => `• [${check.status === "pass" ? "PASS" : check.status.toUpperCase()}] ${check.label}: ${check.message}`)
      .join("\n");
    return `Gemini CLI Status: ${readiness.status.toUpperCase()}\nPath: ${readiness.binaryPath || "unknown"}\nVersion: ${readiness.version || "unknown"}\n\nChecks:\n${checksStr}`;
  }, [readiness, readinessLoading, readinessError]);

  const readinessColor = useMemo(() => {
    if (readinessLoading) return "var(--text-3)";
    if (readinessError !== null || readiness?.status === "error") return "var(--error)";
    if (readiness?.status === "warning") return "var(--warning)";
    if (readiness?.status === "ready") return "var(--done)";
    return "var(--text-3)";
  }, [readiness, readinessLoading, readinessError]);

  if (workspaces.length === 0 && workspaceFormOpen === "closed") {
    return (
      <div
        style={{
          maxWidth: "100%",
          margin: "0 auto",
          padding: 24,
          border: "1px dashed var(--rule-strong)",
          background: "rgba(241,234,216,0.035)",
          borderRadius: "var(--r-lg)",
          color: "var(--text-2)",
          display: "flex",
          flexDirection: "column",
          gap: 12
        }}
      >
        <div>
          <p className="mh-serif" style={{ fontSize: 20, color: "var(--text)", margin: 0 }}>
            No workspaces yet.
          </p>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
            Create a workspace before generating a task graph.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWorkspaceFormOpen("create")}
          style={{
            alignSelf: "flex-start",
            minHeight: 36,
            padding: "0 14px",
            border: "1px solid var(--coral)",
            background: "var(--coral)",
            color: "#1A1915",
            borderRadius: "var(--r-md)",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          + Create workspace
        </button>
      </div>
    );
  }

  return (
    <section
      style={{
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      {/* Workspace Selection & branch bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <FolderIcon style={{ color: "var(--text-3)", opacity: 0.7, flexShrink: 0 }} />
          {workspaces.length > 0 && (
            <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setWorkspaceId} />
          )}

          {/* Action buttons to manage workspace inline */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button
              type="button"
              title="Add Workspace"
              onClick={() => setWorkspaceFormOpen("create")}
              style={actionIconButtonStyle}
            >
              <PlusIcon />
            </button>
            {selectedWorkspace && (
              <>
                <button
                  type="button"
                  title="Edit Selected Workspace"
                  onClick={() => setWorkspaceFormOpen("edit")}
                  style={actionIconButtonStyle}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  title="Delete Selected Workspace"
                  disabled={workspaces.length <= 1 || workspaceBusy}
                  onClick={handleWorkspaceDelete}
                  style={{
                    ...actionIconButtonStyle,
                    color: workspaces.length <= 1 ? "var(--text-4)" : "var(--error)",
                    cursor: workspaces.length <= 1 ? "not-allowed" : "pointer"
                  }}
                >
                  <TrashIcon />
                </button>
              </>
            )}
          </div>

          {selectedWorkspace?.repoPath && (
            <span
              className="mh-mono"
              title={selectedWorkspace.repoPath}
              style={{
                color: "var(--text-3)",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                opacity: 0.6
              }}
            >
              ({getCompactPath(selectedWorkspace.repoPath)})
            </span>
          )}
        </div>
        {selectedWorkspace && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-3)", fontSize: 11, opacity: 0.8, flexShrink: 0 }}>
            <BranchGlyph />
            <span className="mh-mono">{selectedWorkspace.defaultBranch ?? "main"}</span>
          </div>
        )}
      </div>

      {/* Main Task Input Card */}
      <div
        style={{
          border: "1px solid var(--rule-control)",
          background: "rgba(24,26,28,0.78)",
          borderRadius: "var(--r-lg)",
          padding: "12px 14px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxShadow: "0 1px 0 rgba(255,255,255,0.025) inset"
        }}
      >
        <textarea
          id="manyhands-task-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          spellCheck={false}
          placeholder="Describe the task — what should the system build, refactor, or migrate?"
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            color: "var(--text)",
            fontFamily: "var(--font-sans)",
            fontSize: 16,
            lineHeight: 1.5,
            outline: "none",
            resize: "vertical",
            minHeight: 110,
            padding: 0
          }}
        />

        {/* Separator inside card */}
        <div style={{ height: 1, background: "var(--rule-soft)", margin: "0 -14px" }} />

        {/* Bottom Action Bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          {/* Config options */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {/* Model Select */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                model:
              </span>
              <ModelPicker value={modelId} onChange={setModelId} />
              <span
                className={readinessLoading ? "coral-pulse" : ""}
                title={readinessTooltip}
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: readinessColor,
                  cursor: "help",
                  flexShrink: 0,
                  marginLeft: 2
                }}
              />
            </div>

            {/* Separator */}
            <span style={{ color: "rgba(241, 234, 216, 0.1)", userSelect: "none" }} aria-hidden>|</span>

            {/* Aggressiveness Select */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                aggressiveness:
              </span>
              <select
                aria-label="Decomposition Aggressiveness"
                value={granularity}
                onChange={(event) => {
                  const val = event.target.value;
                  if (isGranularityLevel(val)) setGranularity(val);
                }}
                className="mh-select"
                style={{
                  minHeight: 32,
                  height: 32,
                  padding: "0 24px 0 8px",
                  fontSize: 12,
                  width: 110
                }}
              >
                {GRANULARITY_DISPLAY_OPTIONS.filter((opt) => !opt.disabled).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Button */}
          <Button
            variant="primary"
            size="sm"
            disabled={!canStart}
            busy={submitting}
            onClick={() => {
              void handleStart();
            }}
            style={{
              height: 34,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 6
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Generate
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  lineHeight: 1,
                  padding: "1px 4px",
                  borderRadius: 2,
                  background: "rgba(0,0,0,0.15)",
                  color: "rgba(0,0,0,0.5)"
                }}
              >
                ⌘↵
              </span>
            </span>
          </Button>
        </div>
      </div>

      {/* Examples chips (only if prompt is empty) */}
      {prompt.trim().length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 2 }}>
          <span className="mh-coord" style={{ fontSize: 10, color: "var(--text-3)", opacity: 0.8 }}>
            try:
          </span>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="mh-example-chip"
              style={{
                border: "1px solid var(--rule-soft)",
                background: "rgba(241,234,216,0.015)",
                color: "var(--text-2)",
                borderRadius: "var(--r-md)",
                minHeight: 28,
                padding: "4px 8px",
                fontSize: 11.5,
                lineHeight: 1.3,
                cursor: "pointer",
                transition: "border-color 150ms ease-out, color 150ms ease-out"
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {/* Errors / Warnings */}
      {errorMessage !== null ? (
        <div
          role="alert"
          style={{
            border: "1px solid var(--status-failed-border)",
            background: "var(--status-failed-bg)",
            color: "var(--status-failed-fg)",
            padding: "8px 12px",
            borderRadius: "var(--r-md)",
            fontSize: 12,
            marginTop: 4
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      {!hasLocalRepo && selectedWorkspace && (
        <div
          style={{
            border: "1px solid var(--status-failed-border)",
            background: "var(--status-failed-bg)",
            color: "var(--status-failed-fg)",
            padding: "8px 12px",
            borderRadius: "var(--r-md)",
            fontSize: 12,
            marginTop: 4
          }}
        >
          Workspace &quot;{selectedWorkspace.name}&quot; has no local git repo. Configure one using the Edit button.
        </div>
      )}

      {/* Add / Edit Workspace Dialog */}
      {workspaceFormOpen !== "closed" ? (
        <WorkspaceFormDialog
          mode={workspaceFormOpen}
          initial={workspaceFormOpen === "edit" && selectedWorkspace ? formValueFrom(selectedWorkspace) : null}
          onCancel={() => setWorkspaceFormOpen("closed")}
          onSubmit={handleWorkspaceSubmit}
          busy={workspaceBusy}
        />
      ) : null}
    </section>
  );
}

function getCompactPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
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
    const payload = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      return payload.error;
    }
    return `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

// Icons and Glyphs
const actionIconButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-3)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 4,
  padding: 0,
  transition: "background 150ms ease-out, color 150ms ease-out"
};

function PlusIcon(): React.ReactElement {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function EditIcon(): React.ReactElement {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon(): React.ReactElement {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function FolderIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BranchGlyph(): React.ReactElement {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto" }}
      aria-hidden
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="6" cy="3" r="1.6" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="12" cy="9" r="1.6" />
      <path d="M12 7.4V6c0-1.6-1.4-3-3-3H7.5" />
    </svg>
  );
}
