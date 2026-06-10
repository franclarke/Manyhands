"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ApiErrorResponse,
  ProviderReadiness,
  ProviderReadinessResponse,
  RunResponse,
  Workspace,
  WorkspaceCreateRequest
} from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "./model-picker.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";
import { toGranularityMode, isGranularityLevel, GRANULARITY_DISPLAY_OPTIONS, type GranularityLevel } from "@/lib/granularity";
import type { ExecutorSelection } from "@/lib/api-types";

const PROMPT_STORAGE_KEY = "manyhands:lastPrompt";
const EXAMPLE_PROMPTS = [
  "Agregá login sin contraseña con magic links, tests y manejo de sesión.",
  "Refactorizá la validación de la API de tareas y arreglá los tests que fallan.",
  "Implementá DELETE /tasks/:id con persistencia, errores y cobertura."
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
  const [defaultExecutionSelection, setDefaultExecutionSelection] = useState<string>(`gemini-cli/${initialModelId}`);
  const [defaultRepairSelection, setDefaultRepairSelection] = useState<string>(`gemini-cli/${initialModelId}`);
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
  const hasUsableGemini = readiness?.status === "ready" || readiness?.status === "warning";
  const startBlockReason = startBlockReasonFor({
    selectedWorkspace,
    hasPrompt,
    hasLocalRepo,
    readiness,
    readinessLoading,
    readinessError
  });
  const readinessCallout = readinessCalloutFor({ hasLocalRepo, readiness, readinessLoading, readinessError });
  const canStart =
    selectedWorkspace !== null &&
    hasPrompt &&
    hasLocalRepo &&
    hasUsableGemini &&
    modelId.trim().length > 0 &&
    defaultExecutionSelection.trim().length > 0 &&
    defaultRepairSelection.trim().length > 0 &&
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
        planningModel?: string;
        defaultExecutionSelection?: ExecutorSelection;
        defaultRepairSelection?: ExecutorSelection;
        userPrompt: string;
        repoSpec?: { kind: "localPath"; path: string };
      } = {
        workspaceId: selectedWorkspace.id,
        granularity: granularityMode,
        model: modelId,
        planningModel: modelId,
        defaultExecutionSelection: parseSelection(defaultExecutionSelection),
        defaultRepairSelection: parseSelection(defaultRepairSelection),
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

    const collectOptionalFields = (val: WorkspaceFormValue): Omit<WorkspaceCreateRequest, "name"> => {
      const out: Omit<WorkspaceCreateRequest, "name"> = {};
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
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleWorkspaceDelete(): Promise<void> {
    if (!selectedWorkspace) return;
    if (!confirm(`¿Eliminar el workspace "${selectedWorkspace.name}"?`)) return;
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
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  const readinessTooltip = useMemo(() => {
    if (readinessLoading) return "Verificando el estado de Gemini CLI…";
    if (readinessError) return `Error al verificar el estado: ${readinessError}`;
    if (!readiness) return "Estado de Gemini CLI desconocido";
    const checksStr = readiness.checks
      .map((check) => `• [${check.status === "pass" ? "OK" : check.status.toUpperCase()}] ${check.label}: ${check.message}`)
      .join("\n");
    return `Gemini CLI: ${readiness.status.toUpperCase()}\nRuta: ${readiness.binaryPath || "desconocida"}\nVersión: ${readiness.version || "desconocida"}\n\nChecks:\n${checksStr}`;
  }, [readiness, readinessLoading, readinessError]);



  if (workspaces.length === 0 && workspaceFormOpen === "closed") {
    return (
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: 24,
          border: "1px dashed var(--rule-strong)",
          background: "var(--surface)",
          borderRadius: "var(--r-lg)",
          color: "var(--text-2)",
          display: "flex",
          flexDirection: "column",
          gap: 12
        }}
      >
        <div>
          <p className="mh-serif" style={{ fontSize: 20, color: "var(--text)", margin: 0 }}>
            Todavía no hay workspaces.
          </p>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
            Creá un workspace —apuntado a un repo git local— antes de generar un grafo de tareas.
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
          + Crear workspace
        </button>
      </div>
    );
  }

  return (
    <section
      style={{
        maxWidth: 980,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 18
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "2px 2px 0" }}>
        <span className="mh-coord" style={{ color: "var(--copper)", margin: 0 }}>
          nuevo run
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      </div>
      {/* Workspace Selection & branch bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, rowGap: 8, flexWrap: "wrap", marginBottom: -4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 auto" }}>
          <FolderIcon style={{ color: "var(--text-3)", opacity: 0.7, flexShrink: 0 }} />
          {workspaces.length > 0 && (
            <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setWorkspaceId} />
          )}

          {/* Action buttons to manage workspace inline */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button
              type="button"
              title="Agregar workspace"
              onClick={() => setWorkspaceFormOpen("create")}
              style={actionIconButtonStyle}
            >
              <PlusIcon />
            </button>
            {selectedWorkspace && (
              <>
                <button
                  type="button"
                  title="Editar workspace seleccionado"
                  onClick={() => setWorkspaceFormOpen("edit")}
                  style={actionIconButtonStyle}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  title="Eliminar workspace seleccionado"
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
                maxWidth: 200,
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
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-surface)",
          borderRadius: 8,
          padding: "16px 20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "none"
        }}
      >
        <textarea
          id="manyhands-task-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          spellCheck={false}
          placeholder="Describí los cambios o la funcionalidad a construir (ej: agregar autenticación, refactorizar validación, crear endpoint...)"
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            color: "var(--color-text)",
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            lineHeight: "1.6",
            outline: "none",
            resize: "vertical",
            minHeight: 120,
            padding: 0
          }}
        />

        {/* Separator inside card */}
        <div style={{ height: 1, background: "var(--color-border-soft)", margin: "0 -20px" }} />

        {/* Bottom Action Bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            {hasLocalRepo ? (
              <span
                className="mh-mono cursor-help"
                title={readinessTooltip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  color: readinessTone(readiness?.status, hasLocalRepo).fg,
                  background: readinessTone(readiness?.status, hasLocalRepo).bg,
                  border: `1px solid ${readinessTone(readiness?.status, hasLocalRepo).border}`,
                  padding: "3px 8px",
                  borderRadius: 999
                }}
              >
                <span
                  className={readiness?.status === "ready" ? "w-1.5 h-1.5 rounded-full animate-pulse" : "w-1.5 h-1.5 rounded-full"}
                  style={{ background: readinessTone(readiness?.status, hasLocalRepo).fg }}
                />
                Workspace listo · Gemini {readinessLabel(readiness?.status)}
              </span>
            ) : (
              <span
                className="mh-mono cursor-help"
                title={readinessTooltip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--status-failed-fg)",
                  background: "var(--status-failed-bg)",
                  border: "1px solid var(--status-failed-border)",
                  padding: "3px 8px",
                  borderRadius: 999
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-failed-fg)]" />
                Falta repo local
              </span>
            )}
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="mh-mono"
              style={{
                minHeight: 28,
                padding: "0 10px",
                borderRadius: 6,
                border: "1px solid var(--color-border-strong)",
                background: advancedOpen ? "var(--color-surface-raised)" : "transparent",
                color: "var(--color-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                transition: "all 150ms ease"
              }}
            >
              {advancedOpen ? "Ocultar opciones" : "Opciones avanzadas"}
            </button>
          </div>

          {/* Config options */}
          <div style={{ display: advancedOpen ? "flex" : "none", alignItems: "center", gap: 14, flexWrap: "wrap", width: "100%", paddingTop: 6 }}>
            {/* Model Select */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                planificación:
              </span>
              <ModelPicker value={modelId} onChange={setModelId} capability="planning" width={150} />
            </div>

            <span style={{ color: "var(--color-border)", userSelect: "none" }} aria-hidden>|</span>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                ejecución:
              </span>
              <ModelPicker
                value={defaultExecutionSelection}
                onChange={setDefaultExecutionSelection}
                capability="execution"
                selectionMode="executor-selection"
                width={185}
              />
            </div>

            <span style={{ color: "var(--color-border)", userSelect: "none" }} aria-hidden>|</span>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                reparación:
              </span>
              <ModelPicker
                value={defaultRepairSelection}
                onChange={setDefaultRepairSelection}
                capability="repair"
                selectionMode="executor-selection"
                width={185}
              />
            </div>

            <span style={{ color: "var(--color-border)", userSelect: "none" }} aria-hidden>|</span>

            {/* Aggressiveness Select */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mh-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                agresividad:
              </span>
              <select
                aria-label="Agresividad de descomposición"
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
              borderRadius: 6,
              background: canStart ? "var(--color-accent)" : "var(--color-surface-raised)",
              borderColor: canStart ? "var(--color-accent)" : "var(--color-border)",
              color: canStart ? "#FFF" : "var(--color-text-muted)"
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {startBlockReason ?? "Generar plan"}
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
                  background: canStart ? "rgba(255,255,255,0.2)" : "transparent",
                  color: canStart ? "rgba(255,255,255,0.8)" : "var(--color-text-muted)"
                }}
              >
                ⌘↵
              </span>
            </span>
          </Button>
        </div>
      </div>

      {readinessCallout !== null ? (
        <ReadinessCallout message={readinessCallout} />
      ) : null}

      {/* Examples chips (only if prompt is empty) */}
      {prompt.trim().length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 2 }}>
          <span className="mh-coord" style={{ fontSize: 10, color: "var(--text-3)", opacity: 0.8 }}>
            probá:
          </span>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="mh-example-chip"
              style={{
                border: "1px solid var(--rule-soft)",
                background: "transparent",
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
El workspace &quot;{selectedWorkspace.name}&quot; no tiene un repo git local. Configurá uno con el botón de editar.
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

function startBlockReasonFor({
  selectedWorkspace,
  hasPrompt,
  hasLocalRepo,
  readiness,
  readinessLoading,
  readinessError
}: {
  selectedWorkspace: Workspace | null;
  hasPrompt: boolean;
  hasLocalRepo: boolean;
  readiness: ProviderReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
}): string | null {
  if (selectedWorkspace === null) return "Elegir workspace";
  if (!hasPrompt) return "Describir tarea";
  if (!hasLocalRepo) return "Configurar repo";
  if (readinessLoading) return "Verificando Gemini";
  if (readinessError !== null || readiness === null) return "Verificar Gemini";
  if (readiness.status === "error") return "Configurar Gemini";
  return null;
}

function readinessCalloutFor({
  hasLocalRepo,
  readiness,
  readinessLoading,
  readinessError
}: {
  hasLocalRepo: boolean;
  readiness: ProviderReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
}): string | null {
  if (!hasLocalRepo) {
    return "Este workspace necesita un repo git local antes de generar un plan.";
  }
  if (readinessLoading) return null;
  if (readinessError !== null) {
    return `No se pudo verificar Gemini CLI: ${readinessError}`;
  }
  if (readiness === null) {
    return "Gemini CLI todavia no fue verificado. ManyHands necesita Gemini para planificar y ejecutar.";
  }
  if (readiness.status === "error") {
    const failing = readiness.checks.find((check) => check.status === "fail");
    return failing?.message ?? "Gemini CLI no esta listo. Instalalo, autenticalo o configura MANYHANDS_GEMINI_BIN.";
  }
  if (readiness.status === "warning") {
    const warning = readiness.checks.find((check) => check.status === "warning");
    return warning?.message ?? "Gemini CLI esta disponible, pero hay avisos de entorno para revisar.";
  }
  return null;
}

function ReadinessCallout({ message }: { message: string }): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid var(--status-blocked-border)",
        background: "var(--status-blocked-bg)",
        color: "var(--status-blocked-fg)",
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.5
      }}
    >
      {message}
    </div>
  );
}

function readinessTone(
  status: ProviderReadiness["status"] | undefined,
  hasLocalRepo: boolean
): { fg: string; bg: string; border: string } {
  if (!hasLocalRepo || status === "error") {
    return {
      fg: "var(--status-failed-fg)",
      bg: "var(--status-failed-bg)",
      border: "var(--status-failed-border)"
    };
  }
  if (status === "warning" || status === undefined) {
    return {
      fg: "var(--status-blocked-fg)",
      bg: "var(--status-blocked-bg)",
      border: "var(--status-blocked-border)"
    };
  }
  return {
    fg: "var(--status-completed-fg)",
    bg: "var(--status-completed-bg)",
    border: "var(--status-completed-border)"
  };
}

function readinessLabel(status: ProviderReadiness["status"] | undefined): string {
  switch (status) {
    case "ready":
      return "listo";
    case "warning":
      return "con avisos";
    case "error":
      return "con error";
    default:
      return "desconocido";
  }
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

function parseSelection(value: string): ExecutorSelection {
  const [executorId, ...modelParts] = value.split("/");
  return { executorId: executorId as ExecutorSelection["executorId"], model: modelParts.join("/") };
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
