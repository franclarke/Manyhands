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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import type { UiStatus } from "@/lib/status";
import { ModelPicker } from "./model-picker.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";
import { toGranularityMode, isGranularityLevel, GRANULARITY_DISPLAY_OPTIONS, type GranularityLevel } from "@/lib/granularity";
import type { ExecutorSelection } from "@/lib/api-types";
import { FolderGit2, GitBranch, Pencil, Plus, Trash2, AlertTriangle, OctagonAlert } from "lucide-react";

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

  // Local workspace list so create/edit/delete update instantly without a
  // full Next.js refresh round-trip.
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  useEffect(() => {
    setWorkspaces(initialWorkspaces);
  }, [initialWorkspaces]);

  const initialWorkspaceId =
    workspaces.find((entry) => entry.repoPath !== undefined && entry.repoPath.length > 0)?.id ??
    workspaces[0]?.id ??
    "";
  const [workspaceId, setWorkspaceId] = useState<string>(initialWorkspaceId);

  // If the current selection disappears (deleted workspace), fall back to the
  // first workspace that still has a usable repo.
  useEffect(() => {
    if (workspaceId.length > 0 && !workspaces.some((w) => w.id === workspaceId)) {
      const nextWs =
        workspaces.find((entry) => entry.repoPath !== undefined && entry.repoPath.length > 0)?.id ??
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

  const [workspaceFormOpen, setWorkspaceFormOpen] = useState<"closed" | "create" | "edit">("closed");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
    setErrorMessage(null);
    setWorkspaceBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${selectedWorkspace.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const remaining = workspaces.filter((w) => w.id !== selectedWorkspace.id);
      setWorkspaces(remaining);
      setWorkspaceId(remaining[0]?.id ?? "");
      setConfirmDeleteOpen(false);
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

  const gemini = geminiPill({ readiness, readinessLoading, readinessError });

  if (workspaces.length === 0 && workspaceFormOpen === "closed") {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-[var(--r-xl)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6">
        <div>
          <p className="m-0 text-[17px] font-semibold text-[var(--color-text)]">Todavía no hay workspaces.</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
            Creá un workspace —apuntado a un repo git local— antes de generar un grafo de tareas.
          </p>
        </div>
        <Button variant="primary" size="md" className="self-start" onClick={() => setWorkspaceFormOpen("create")}>
          <Plus aria-hidden className="h-4 w-4" />
          Crear workspace
        </Button>
      </section>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4">
      {/* ── Composer card ──────────────────────────────────────────────── */}
      <div className="flex flex-col rounded-[var(--r-xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] transition-colors duration-150 focus-within:border-[var(--color-accent-deep)]">
        {/* Context bar: workspace + repo + branch */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-soft)] px-3.5 py-2.5">
          <FolderGit2 aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-text-subtle)]" />
          <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setWorkspaceId} />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction label="Agregar workspace" onClick={() => setWorkspaceFormOpen("create")}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
            </IconAction>
            {selectedWorkspace !== null ? (
              <>
                <IconAction label="Editar workspace seleccionado" onClick={() => setWorkspaceFormOpen("edit")}>
                  <Pencil aria-hidden className="h-3 w-3" />
                </IconAction>
                <IconAction
                  label="Eliminar workspace seleccionado"
                  danger
                  disabled={workspaces.length <= 1 || workspaceBusy}
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 aria-hidden className="h-3 w-3" />
                </IconAction>
              </>
            ) : null}
          </div>
          {selectedWorkspace?.repoPath ? (
            <span
              className="mh-mono min-w-0 truncate text-[11px] text-[var(--color-text-subtle)]"
              title={selectedWorkspace.repoPath}
            >
              {getCompactPath(selectedWorkspace.repoPath)}
            </span>
          ) : null}
          {selectedWorkspace ? (
            <span className="mh-mono ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-text-subtle)]">
              <GitBranch aria-hidden className="h-3 w-3" />
              {selectedWorkspace.defaultBranch ?? "main"}
            </span>
          ) : null}
        </div>

        {/* Prompt */}
        <textarea
          id="manyhands-task-prompt"
          aria-label="Descripción de la tarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          spellCheck={false}
          placeholder="Describí los cambios o la funcionalidad a construir (ej: agregar autenticación, refactorizar validación, crear endpoint…)"
          className="min-h-[120px] w-full resize-y border-0 bg-transparent px-4 py-3.5 font-sans text-[14px] leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
        />

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-soft)] px-3 py-2.5">
          <StatusPill
            status={hasLocalRepo ? "completed" : "failed"}
            label={hasLocalRepo ? "Repo conectado" : "Falta repo local"}
            pulse={false}
            title={selectedWorkspace?.repoPath}
          />
          <StatusPill status={gemini.status} label={gemini.label} pulse={false} title={readinessTooltip} />
          <Button
            variant="quiet"
            size="sm"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? "Ocultar opciones" : "Opciones avanzadas"}
          </Button>
          <div className="ml-auto flex items-center gap-3">
            {startBlockReason !== null && hasPrompt && !submitting ? (
              <span className="text-[11.5px] text-[var(--color-text-subtle)]">{startBlockReason}</span>
            ) : null}
            <Button variant="primary" size="sm" disabled={!canStart} busy={submitting} busyLabel="Generando…" onClick={() => void handleStart()}>
              Generar plan
              <kbd className="mh-mono ml-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-accent-contrast)_16%,transparent)] px-1 py-px text-[10px] font-normal leading-none">
                ⌘↵
              </kbd>
            </Button>
          </div>
        </div>

        {/* Advanced options drawer */}
        {advancedOpen ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-b-[var(--r-xl)] border-t border-[var(--color-border-soft)] bg-[var(--color-bg-subtle)] px-4 py-3.5 md:grid-cols-4">
            <AdvancedField label="Planificación">
              <ModelPicker value={modelId} onChange={setModelId} capability="planning" />
            </AdvancedField>
            <AdvancedField label="Ejecución">
              <ModelPicker
                value={defaultExecutionSelection}
                onChange={setDefaultExecutionSelection}
                capability="execution"
                selectionMode="executor-selection"
              />
            </AdvancedField>
            <AdvancedField label="Reparación">
              <ModelPicker
                value={defaultRepairSelection}
                onChange={setDefaultRepairSelection}
                capability="repair"
                selectionMode="executor-selection"
              />
            </AdvancedField>
            <AdvancedField label="Agresividad">
              <select
                aria-label="Agresividad de descomposición"
                value={granularity}
                onChange={(event) => {
                  const val = event.target.value;
                  if (isGranularityLevel(val)) setGranularity(val);
                }}
                className="mh-select h-8 w-full min-w-0 text-[12px]"
              >
                {GRANULARITY_DISPLAY_OPTIONS.filter((opt) => !opt.disabled).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </AdvancedField>
          </div>
        ) : null}
      </div>

      {/* ── Callouts ───────────────────────────────────────────────────── */}
      {readinessCallout !== null ? (
        <Callout tone="blocked" icon={<AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />}>
          {readinessCallout}
        </Callout>
      ) : null}
      {errorMessage !== null ? (
        <Callout tone="failed" role="alert" icon={<OctagonAlert aria-hidden className="h-4 w-4 shrink-0" />}>
          {errorMessage}
        </Callout>
      ) : null}
      {!hasLocalRepo && selectedWorkspace ? (
        <Callout tone="failed" icon={<OctagonAlert aria-hidden className="h-4 w-4 shrink-0" />}>
          El workspace &quot;{selectedWorkspace.name}&quot; no tiene un repo git local. Configurá uno con el botón de editar.
        </Callout>
      ) : null}

      {/* ── Example prompts (only while the composer is empty) ─────────── */}
      {prompt.trim().length === 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-[var(--color-text-subtle)]">Probá:</span>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="mh-example-chip cursor-pointer rounded-[var(--r-md)] border border-[var(--rule-soft)] bg-transparent px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-[var(--color-text-muted)] transition-colors duration-150"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      {workspaceFormOpen !== "closed" ? (
        <WorkspaceFormDialog
          mode={workspaceFormOpen}
          initial={workspaceFormOpen === "edit" && selectedWorkspace ? formValueFrom(selectedWorkspace) : null}
          onCancel={() => setWorkspaceFormOpen("closed")}
          onSubmit={handleWorkspaceSubmit}
          busy={workspaceBusy}
        />
      ) : null}
      {confirmDeleteOpen && selectedWorkspace !== null ? (
        <ConfirmDialog
          title={`¿Eliminar "${selectedWorkspace.name}"?`}
          description="Se elimina el workspace de ManyHands. El repositorio local no se toca."
          confirmLabel="Eliminar workspace"
          destructive
          busy={workspaceBusy}
          onConfirm={() => void handleWorkspaceDelete()}
          onCancel={() => setConfirmDeleteOpen(false)}
        />
      ) : null}
    </section>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────

function IconAction({
  label,
  onClick,
  disabled = false,
  danger = false,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex h-7 w-7 items-center justify-center rounded-[var(--r-md)] border border-transparent bg-transparent transition-colors duration-150",
        disabled
          ? "cursor-not-allowed text-[var(--color-text-faint)]"
          : danger
            ? "cursor-pointer text-[var(--color-text-subtle)] hover:bg-[var(--status-failed-bg)] hover:text-[var(--status-failed-fg)]"
            : "cursor-pointer text-[var(--color-text-subtle)] hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] hover:text-[var(--color-text)]"
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function AdvancedField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="mh-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Callout({
  tone,
  icon,
  role,
  children
}: {
  tone: "blocked" | "failed";
  icon: React.ReactNode;
  role?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      {...(role !== undefined ? { role } : {})}
      className="flex items-start gap-2.5 rounded-[var(--r-lg)] border px-3.5 py-2.5 text-[12.5px] leading-relaxed"
      style={{
        color: `var(--status-${tone}-fg)`,
        background: `var(--status-${tone}-bg)`,
        borderColor: `var(--status-${tone}-border)`
      }}
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function geminiPill({
  readiness,
  readinessLoading,
  readinessError
}: {
  readiness: ProviderReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
}): { status: UiStatus; label: string } {
  if (readinessLoading) return { status: "pending", label: "Verificando Gemini…" };
  if (readinessError !== null) return { status: "blocked", label: "Gemini sin verificar" };
  switch (readiness?.status) {
    case "ready":
      return { status: "completed", label: "Gemini listo" };
    case "warning":
      return { status: "blocked", label: "Gemini con avisos" };
    case "error":
      return { status: "failed", label: "Gemini con error" };
    default:
      return { status: "pending", label: "Gemini desconocido" };
  }
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
  if (selectedWorkspace === null) return "Elegí un workspace";
  if (!hasPrompt) return "Describí la tarea para empezar";
  if (!hasLocalRepo) return "Configurá un repo local";
  if (readinessLoading) return "Verificando Gemini…";
  if (readinessError !== null || readiness === null) return "Gemini sin verificar";
  if (readiness.status === "error") return "Gemini necesita configuración";
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
    return "Gemini CLI todavía no fue verificado. ManyHands necesita Gemini para planificar y ejecutar.";
  }
  if (readiness.status === "error") {
    const failing = readiness.checks.find((check) => check.status === "fail");
    return failing?.message ?? "Gemini CLI no está listo. Instalalo, autenticalo o configurá MANYHANDS_GEMINI_BIN.";
  }
  if (readiness.status === "warning") {
    const warning = readiness.checks.find((check) => check.status === "warning");
    return warning?.message ?? "Gemini CLI está disponible, pero hay avisos de entorno para revisar.";
  }
  return null;
}

function getCompactPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
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
