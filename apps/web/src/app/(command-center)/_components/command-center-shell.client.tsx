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
import type { UiStatus } from "@/lib/status";
import { ModelPicker } from "./model-picker.client";
import { EffortControl, type EffortLevel } from "./effort-control.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";
import { toGranularityMode, isGranularityLevel, GRANULARITY_DISPLAY_OPTIONS, type GranularityLevel } from "@/lib/granularity";
import { modelOptionForValue, parseSelectionValue } from "@/lib/models";
import { estimateRunCostUsd, formatUsd } from "@/lib/model-pricing";
import { RUN_USER_PROMPT_MAX_LENGTH } from "@/lib/run-limits";
import type { ExecutorSelection } from "@/lib/api-types";
import { FolderGit2, GitBranch, Plus, Pencil, Trash2, AlertTriangle, OctagonAlert, Sparkles } from "lucide-react";

const DEFAULT_PLANNING_MODEL = "sonnet";

type AutonomyLevel = "supervised" | "semi" | "autonomous";
const AUTONOMY_OPTIONS: ReadonlyArray<{ id: AutonomyLevel; label: string; hint: string }> = [
  { id: "supervised", label: "Supervisado", hint: "Aprobás el plan y respondés cada decisión." },
  { id: "semi", label: "Semi", hint: "Auto-aprueba el plan; frena en gates y preguntas." },
  { id: "autonomous", label: "Autónomo", hint: "Auto-aprueba y auto-responde preguntas; frena solo en fallos de ejecución." }
];

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
  // Single model choice drives planning + execution + repair (W3).
  const [modelValue, setModelValue] = useState<string>(`claude-code-cli/${initialModelId}`);
  const [effort, setEffort] = useState<EffortLevel>("medium");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("supervised");
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [handoffRunId, setHandoffRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

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
  const trimmedPromptLength = prompt.trim().length;
  const hasPrompt = trimmedPromptLength > 0;
  const promptOverLimit = trimmedPromptLength > RUN_USER_PROMPT_MAX_LENGTH;
  const hasLocalRepo = selectedWorkspace?.repoPath !== undefined && selectedWorkspace.repoPath.length > 0;
  const hasUsableProvider = readiness?.status === "ready" || readiness?.status === "warning";

  // One model choice → planning + execution + repair. Planning needs a
  // planning-capable model (Claude Code today); if an execution-only model is
  // picked, planning falls back to the default Claude Code planner.
  const selectedModel = modelOptionForValue(modelValue);
  const selection = parseSelectionValue(modelValue);
  const canPlanWithSelection = selectedModel?.capabilities.includes("planning") ?? false;
  const planningModelId = canPlanWithSelection ? selection.model : DEFAULT_PLANNING_MODEL;
  const costEstimate = estimateRunCostUsd(selection.model, {
    promptChars: trimmedPromptLength,
    granularity
  });

  const startBlockReason = startBlockReasonFor({
    selectedWorkspace,
    hasPrompt,
    promptOverLimit,
    hasLocalRepo,
    readiness,
    readinessLoading,
    readinessError
  });
  const readinessCallout = readinessCalloutFor({ hasLocalRepo, readiness, readinessLoading, readinessError });
  const canStart =
    selectedWorkspace !== null &&
    hasPrompt &&
    !promptOverLimit &&
    hasLocalRepo &&
    hasUsableProvider &&
    selectedModel !== undefined &&
    !submitting;

  async function handleStart(): Promise<void> {
    if (selectedWorkspace === null) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const planningExecutorId = canPlanWithSelection ? selection.executorId : "claude-code-cli";
      const body: {
        workspaceId: string;
        granularity: string;
        model: string;
        planningModel?: string;
        planningExecutorId?: string;
        defaultExecutionSelection?: ExecutorSelection;
        defaultRepairSelection?: ExecutorSelection;
        autonomy?: AutonomyLevel;
        userPrompt: string;
        repoSpec?: { kind: "localPath"; path: string };
      } = {
        workspaceId: selectedWorkspace.id,
        granularity: granularityMode,
        model: planningModelId,
        planningModel: planningModelId,
        planningExecutorId: planningExecutorId,
        defaultExecutionSelection: selection,
        defaultRepairSelection: selection,
        autonomy,
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
      setHandoffRunId(runId);
      if (typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 520));
      }
      router.push(`/runs/${runId}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
      setHandoffRunId(null);
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
      if (val.repoPath !== "") out.repoPath = val.repoPath;
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
    if (readinessLoading) return "Verificando el estado de Claude Code CLI…";
    if (readinessError) return `Error al verificar el estado: ${readinessError}`;
    if (!readiness) return "Estado de Claude Code CLI desconocido";
    const checksStr = readiness.checks
      .map((check) => `• [${check.status === "pass" ? "OK" : check.status.toUpperCase()}] ${check.label}: ${check.message}`)
      .join("\n");
    return `Claude Code CLI: ${readiness.status.toUpperCase()}\nRuta: ${readiness.binaryPath || "desconocida"}\nVersión: ${readiness.version || "desconocida"}\n\nChecks:\n${checksStr}`;
  }, [readiness, readinessLoading, readinessError]);

  const provider = providerPill({ readiness, readinessLoading, readinessError });

  if (workspaces.length === 0 && workspaceFormOpen === "closed") {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-[var(--r-xl)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6">
        <div>
          <p className="m-0 text-base font-semibold text-[var(--color-text)]">Todavía no hay workspaces.</p>
          <p className="mt-2 text-label leading-relaxed text-[var(--color-text-muted)]">
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
      <div
        className={[
          "mh-elev-1 mh-elev-focus relative flex flex-col rounded-[var(--r-xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] transition-[border-color,box-shadow,transform,opacity] duration-500 focus-within:border-[var(--color-accent-deep)]",
          handoffRunId !== null ? "scale-[0.96] opacity-80" : ""
        ].join(" ")}
      >
        {handoffRunId !== null ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--r-xl)] bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)]">
            <div className="mh-elev-sheet flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-running-fg)]" />
              <span className="text-sm font-semibold text-[var(--color-text)]">Abriendo workspace del run</span>
              <span className="mh-mono text-eyebrow text-[var(--color-text-subtle)]">{handoffRunId.slice(0, 8)}</span>
            </div>
          </div>
        ) : null}
        {/* Context bar: workspace + repo + branch */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-soft)] px-4 py-3">
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
              className="mh-mono min-w-0 truncate text-eyebrow text-[var(--color-text-subtle)]"
              title={selectedWorkspace.repoPath}
            >
              {getCompactPath(selectedWorkspace.repoPath)}
            </span>
          ) : null}
          {selectedWorkspace ? (
            <span className="mh-mono ml-auto flex shrink-0 items-center gap-1.5 text-eyebrow text-[var(--color-text-subtle)]">
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
          maxLength={RUN_USER_PROMPT_MAX_LENGTH}
          rows={5}
          spellCheck={false}
          placeholder="Describí los cambios o la funcionalidad a construir (ej: agregar autenticación, refactorizar validación, crear endpoint…)"
          className="min-h-[120px] w-full resize-y border-0 bg-transparent px-4 py-3.5 font-sans text-sm leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
        />
        {hasPrompt ? (
          <div className="flex justify-end px-4 pb-3">
            <span
              className={[
                "text-meta",
                promptOverLimit ? "text-[var(--status-failed-fg)]" : "text-[var(--color-text-subtle)]"
              ].join(" ")}
            >
              {trimmedPromptLength.toLocaleString("es-AR")} /{" "}
              {RUN_USER_PROMPT_MAX_LENGTH.toLocaleString("es-AR")} caracteres
            </span>
          </div>
        ) : null}

        {/* Selectors Bar */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4 border-t border-[var(--color-border-soft)] px-4 py-4 bg-[var(--color-bg-subtle)]/5">
          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-[var(--color-text-subtle)]">
              Modelo
            </span>
            <ModelPicker value={modelValue} onChange={setModelValue} />
          </div>

          {/* Effort */}
          {selectedModel?.supportsEffort ? (
            <EffortControl value={effort} onChange={setEffort} />
          ) : null}

          {/* Granularidad */}
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-[var(--color-text-subtle)]">
              Granularidad
            </span>
            <select
              aria-label="Granularidad de descomposición"
              value={granularity}
              onChange={(event) => {
                const val = event.target.value;
                if (isGranularityLevel(val)) setGranularity(val);
              }}
              className="mh-select h-8 min-w-[100px] text-meta"
            >
              {GRANULARITY_DISPLAY_OPTIONS.filter((opt) => !opt.disabled).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Autonomía */}
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-[var(--color-text-subtle)]">
              Autonomía
            </span>
            <select
              aria-label="Nivel de autonomía"
              title={AUTONOMY_OPTIONS.find((opt) => opt.id === autonomy)?.hint}
              value={autonomy}
              onChange={(event) => setAutonomy(event.target.value as AutonomyLevel)}
              className="mh-select h-8 min-w-[110px] text-meta"
            >
              {AUTONOMY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id} title={option.hint}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-subtle)]/20 px-4 py-3 rounded-b-[var(--r-xl)]">
          {/* Cost estimate & Warning Metadata */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-[var(--color-text-subtle)]">
            {costEstimate !== undefined ? (
              <span title="Estimación heurística previa: los tokens reales se conocen recién al ejecutar.">
                Costo estimado{" "}
                <span className="text-[var(--color-text-muted)] font-medium">
                  ~{formatUsd(costEstimate.lowUsd)}–{formatUsd(costEstimate.highUsd)}
                </span>
              </span>
            ) : null}
            {!canPlanWithSelection ? (
              <span className="text-[var(--color-text-faint)]">
                {costEstimate !== undefined ? "· " : ""}Planifica con Claude Code {DEFAULT_PLANNING_MODEL}
              </span>
            ) : null}
          </div>

          {/* Action button & Status */}
          <div className="flex items-center gap-3">
            <StatusIcon
              icon={<FolderGit2 aria-hidden className="h-4 w-4" />}
              tone={hasLocalRepo ? "ok" : "error"}
              title={hasLocalRepo ? `Repo conectado: ${selectedWorkspace?.repoPath ?? ""}` : "Falta un repo git local"}
            />
            <StatusIcon
              icon={<Sparkles aria-hidden className="h-4 w-4" />}
              tone={toneForUiStatus(provider.status)}
              title={readinessTooltip}
            />
            {startBlockReason !== null && hasPrompt && !submitting ? (
              <span className="text-meta text-[var(--color-text-subtle)] mr-1">{startBlockReason}</span>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              disabled={!canStart}
              busy={submitting}
              busyLabel="Generando…"
              onClick={() => void handleStart()}
            >
              Generar plan
              <kbd className="mh-mono ml-1.5 rounded-sm bg-[color-mix(in_srgb,var(--color-accent-contrast)_16%,transparent)] px-1 py-px text-eyebrow font-normal leading-none">
                ⌘↵
              </kbd>
            </Button>
          </div>
        </div>
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
          <span className="mr-1 text-meta text-[var(--color-text-subtle)]">Probá:</span>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="mh-example-chip cursor-pointer rounded-[var(--r-md)] border border-[var(--rule-soft)] bg-transparent px-3 py-1.5 text-left text-meta leading-snug text-[var(--color-text-muted)] transition-colors duration-150"
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

type IndicatorTone = "ok" | "warning" | "error" | "muted";

const TONE_COLOR: Record<IndicatorTone, string> = {
  ok: "var(--status-completed-fg)",
  warning: "var(--status-blocked-fg)",
  error: "var(--status-failed-fg)",
  muted: "var(--color-text-subtle)"
};

function toneForUiStatus(status: UiStatus): IndicatorTone {
  if (status === "completed" || status === "completed_with_accepted") return "ok";
  if (status === "blocked") return "warning";
  if (status === "failed") return "error";
  return "muted";
}

/** Compact icon indicator (replaces a word badge); the tooltip carries detail. */
function StatusIcon({
  icon,
  tone,
  title
}: {
  icon: React.ReactNode;
  tone: IndicatorTone;
  title?: string;
}): React.ReactElement {
  return (
    <span
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--r-md)]"
      style={{ color: TONE_COLOR[tone] }}
    >
      {icon}
    </span>
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
      className="flex items-start gap-3 rounded-[var(--r-lg)] border px-4 py-3 text-label leading-relaxed"
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

function providerPill({
  readiness,
  readinessLoading,
  readinessError
}: {
  readiness: ProviderReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
}): { status: UiStatus; label: string } {
  if (readinessLoading) return { status: "pending", label: "Verificando Claude Code…" };
  if (readinessError !== null) return { status: "blocked", label: "Claude Code sin verificar" };
  switch (readiness?.status) {
    case "ready":
      return { status: "completed", label: "Claude Code listo" };
    case "warning":
      return { status: "blocked", label: "Claude Code con avisos" };
    case "error":
      return { status: "failed", label: "Claude Code con error" };
    default:
      return { status: "pending", label: "Claude Code desconocido" };
  }
}

function startBlockReasonFor({
  selectedWorkspace,
  hasPrompt,
  promptOverLimit,
  hasLocalRepo,
  readiness,
  readinessLoading,
  readinessError
}: {
  selectedWorkspace: Workspace | null;
  hasPrompt: boolean;
  promptOverLimit: boolean;
  hasLocalRepo: boolean;
  readiness: ProviderReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
}): string | null {
  if (selectedWorkspace === null) return "Elegí un workspace";
  if (!hasPrompt) return "Describí la tarea para empezar";
  if (promptOverLimit) return "El prompt supera el límite de caracteres";
  if (!hasLocalRepo) return "Configurá un repo local";
  if (readinessLoading) return "Verificando Claude Code…";
  if (readinessError !== null || readiness === null) return "Claude Code sin verificar";
  if (readiness.status === "error") return "Claude Code necesita configuración";
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
    return `No se pudo verificar Claude Code CLI: ${readinessError}`;
  }
  if (readiness === null) {
    return "Claude Code CLI todavía no fue verificado. ManyHands necesita Claude Code para planificar y ejecutar.";
  }
  if (readiness.status === "error") {
    const failing = readiness.checks.find((check) => check.status === "fail");
    return failing?.message ?? "Claude Code CLI no está listo. Instalalo, autenticalo o configurá MANYHANDS_CLAUDE_BIN.";
  }
  if (readiness.status === "warning") {
    const warning = readiness.checks.find((check) => check.status === "warning");
    return warning?.message ?? "Claude Code CLI está disponible, pero hay avisos de entorno para revisar.";
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
