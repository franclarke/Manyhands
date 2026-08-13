"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ApiErrorResponse,
  CapabilitiesResponse,
  ProviderReadiness,
  RunResponse,
  Workspace,
  WorkspaceCreateRequest,
  WorkspaceMigrationConflict,
  WorkspaceMigrationResolutionChoice
} from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { UiStatus } from "@/lib/status";
import { ModelPicker } from "./model-picker.client";
import { EffortControl } from "./effort-control.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { WorkspaceFormDialog, type WorkspaceFormValue } from "./workspace-form-dialog.client";
import { isGranularityLevel, GRANULARITY_DISPLAY_OPTIONS, type GranularityLevel } from "@/lib/granularity";
import { executorLabel, modelOptionForValue, modelOptionsFromCapabilities, parseSelectionValue, stageSelectionForSubmit, type EffortLevel, type ExecutorId, type ExecutorSelection, type ModelOption, type StageSelection } from "@/lib/models";
import { estimateRunCostUsd, formatUsd } from "@/lib/model-pricing";
import { RUN_USER_PROMPT_MAX_LENGTH } from "@/lib/run-limits";
import { FolderGit2, GitBranch, Plus, Pencil, Trash2, AlertTriangle, OctagonAlert, Sparkles } from "lucide-react";

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

const MIGRATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Nombre",
  description: "Descripción",
  color: "Color",
  packageManager: "Package manager",
  defaultBranch: "Branch por defecto",
  allowedPaths: "Paths permitidos",
  testCommand: "Comando de test",
  buildCommand: "Comando de build"
};

function migrationConflictValue(snapshot: Workspace, field: string): string {
  const value = (snapshot as unknown as Record<string, unknown>)[field];
  if (value === undefined || value === null || value === "") return "Sin configurar";
  if (Array.isArray(value)) return value.length === 0 ? "Sin configurar" : value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function MigrationConfigurationSnapshot({
  label,
  snapshot,
  fields
}: {
  label: string;
  snapshot: Workspace;
  fields: readonly string[];
}): React.ReactElement {
  return (
    <section
      className="min-w-0 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      aria-label={`${label}: ${snapshot.name}`}
    >
      <p className="m-0 text-meta font-semibold text-[var(--color-text)]">{label}: {snapshot.name}</p>
      <dl className="mt-2 grid min-w-0 gap-2">
        {fields.map((field) => (
          <div key={field} className="min-w-0">
            <dt className="text-eyebrow text-[var(--color-text-subtle)]">
              {MIGRATION_FIELD_LABELS[field] ?? field}
            </dt>
            <dd className="mh-mono m-0 mt-0.5 break-words text-meta text-[var(--color-text)]">
              {migrationConflictValue(snapshot, field)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface CommandCenterShellProps {
  workspaces: Workspace[];
  migrationConflicts: WorkspaceMigrationConflict[];
  initialGranularity: GranularityLevel;
  initialModelId: string;
}

export function CommandCenterShell({
  workspaces: initialWorkspaces,
  migrationConflicts: initialMigrationConflicts,
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
  const [migrationConflicts, setMigrationConflicts] = useState<WorkspaceMigrationConflict[]>(
    initialMigrationConflicts
  );
  const [migrationConflictBusy, setMigrationConflictBusy] =
    useState<WorkspaceMigrationResolutionChoice | null>(null);
  useEffect(() => {
    setMigrationConflicts(initialMigrationConflicts);
  }, [initialMigrationConflicts]);

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
  const initialSelectionValue = `claude-code-cli/${initialModelId}`;
  const [planningModelValue, setPlanningModelValue] = useState<string>(initialSelectionValue);
  const [executionModelValue, setExecutionModelValue] = useState<string>(initialSelectionValue);
  // Independent per-stage reasoning effort (U2A-2). `effort` drives execution.
  const [effort, setEffort] = useState<EffortLevel>("medium");
  const [planningEffort, setPlanningEffort] = useState<EffortLevel>("medium");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("supervised");
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [handoffRunId, setHandoffRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readinessProviders, setReadinessProviders] = useState<ProviderReadiness[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
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
    async function loadCapabilities(): Promise<void> {
      if (workspaceId.length === 0) {
        setReadinessProviders([]);
        setModelOptions([]);
        return;
      }
      setReadinessLoading(true);
      setReadinessError(null);
      try {
        const response = await fetch(`/api/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`);
        const payload = (await response.json()) as CapabilitiesResponse | ApiErrorResponse;
        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : `Request failed with ${response.status}`);
        }
        if (!cancelled) {
          const capabilities = payload as CapabilitiesResponse;
          setReadinessProviders(capabilities.executors.map((executor) => executor.readiness));
          setModelOptions(modelOptionsFromCapabilities(capabilities));
        }
      } catch (error) {
        if (!cancelled) {
          setReadinessProviders([]);
          setModelOptions([]);
          setReadinessError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setReadinessLoading(false);
        }
      }
    }
    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const availablePlanning = modelOptions.filter(
      (option) => option.enabled && option.capabilities.includes("planning")
    );
    const availableExecution = modelOptions.filter(
      (option) => option.enabled && option.capabilities.includes("execution")
    );
    if (!modelOptionForValue(planningModelValue, availablePlanning) && availablePlanning[0] !== undefined) {
      setPlanningModelValue(`${availablePlanning[0].executorId}/${availablePlanning[0].id}`);
    }
    if (!modelOptionForValue(executionModelValue, availableExecution) && availableExecution[0] !== undefined) {
      setExecutionModelValue(`${availableExecution[0].executorId}/${availableExecution[0].id}`);
    }
  }, [executionModelValue, modelOptions, planningModelValue]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? workspaces[0] ?? null,
    [workspaces, workspaceId]
  );

  const trimmedPromptLength = prompt.trim().length;
  const hasPrompt = trimmedPromptLength > 0;
  const promptOverLimit = trimmedPromptLength > RUN_USER_PROMPT_MAX_LENGTH;
  const hasLocalRepo = selectedWorkspace?.repoPath !== undefined && selectedWorkspace.repoPath.length > 0;
  const selectedPlanningModel = modelOptionForValue(planningModelValue, modelOptions);
  const selectedExecutionModel = modelOptionForValue(executionModelValue, modelOptions);
  const planningSelection = parseSelectionValue(planningModelValue);
  const executionSelection = parseSelectionValue(executionModelValue);
  const requiredReadiness = readinessForSelections(readinessProviders, [planningSelection, executionSelection]);
  const readiness = aggregateReadiness(requiredReadiness);
  const hasUsableProvider =
    requiredReadiness.length > 0 &&
    requiredReadiness.every((provider) => provider.status === "ready" || provider.status === "warning");

  // Planning and execution can use different executor/model selections.
  const costEstimate = estimateRunCostUsd(executionSelection.model, {
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
    selectedPlanningModel !== undefined &&
    selectedExecutionModel !== undefined &&
    !submitting;

  async function handleStart(): Promise<void> {
    if (selectedWorkspace === null) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      // U2A-2: send canonical per-stage selections with independent effort.
      // The helper attaches effort only when the stage's model declares it
      // (never on Claude), so the server never rejects an unsupported effort.
      // The server derives the legacy mirror fields.
      const planningStage: StageSelection = stageSelectionForSubmit(planningSelection, selectedPlanningModel, planningEffort);
      const executionStage: StageSelection = stageSelectionForSubmit(executionSelection, selectedExecutionModel, effort);
      const body: {
        workspaceId: string;
        planningSelection?: StageSelection;
        executionSelection?: StageSelection;
        repairSelection?: StageSelection;
        userPrompt: string;
      } = {
        workspaceId: selectedWorkspace.id,
        planningSelection: planningStage,
        executionSelection: executionStage,
        repairSelection: executionStage,
        userPrompt: prompt.trim()
      };
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
      const response = await fetch(`/api/workspaces/${selectedWorkspace.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
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

  async function handleMigrationConflictResolution(
    conflict: WorkspaceMigrationConflict,
    choice: WorkspaceMigrationResolutionChoice
  ): Promise<void> {
    setErrorMessage(null);
    setMigrationConflictBusy(choice);
    try {
      const response = await fetch(
        `/api/workspaces/migration-conflicts/${encodeURIComponent(conflict.duplicateWorkspaceId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ choice })
        }
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as {
        workspace: Workspace;
        migrationConflict: WorkspaceMigrationConflict;
      };
      setWorkspaces((current) =>
        current.map((workspace) => workspace.id === payload.workspace.id ? payload.workspace : workspace)
      );
      setMigrationConflicts((current) =>
        current.map((entry) =>
          entry.duplicateWorkspaceId === payload.migrationConflict.duplicateWorkspaceId
            ? payload.migrationConflict
            : entry
        )
      );
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMigrationConflictBusy(null);
    }
  }

  const readinessTooltip = useMemo(() => {
    if (readinessLoading) return "Verificando los ejecutores seleccionados…";
    if (readinessError) return `Error al verificar el estado: ${readinessError}`;
    if (!readiness) return "Estado de ejecutores desconocido";
    const checksStr = readiness.checks
      .map((check) => `• [${check.status === "pass" ? "OK" : check.status.toUpperCase()}] ${check.label}: ${check.message}`)
      .join("\n");
    return `${readiness.label}: ${readiness.status.toUpperCase()}\nRuta: ${readiness.binaryPath || "desconocida"}\nVersión: ${readiness.version || "desconocida"}\n\nChecks:\n${checksStr}`;
  }, [readiness, readinessLoading, readinessError]);

  const provider = providerPill({ readiness, readinessLoading, readinessError });
  const pendingMigrationConflict =
    migrationConflicts.find((entry) => entry.resolution === undefined) ?? null;

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
          {/* Planning model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-[var(--color-text-subtle)]">
              Planificación
            </span>
            <ModelPicker value={planningModelValue} onChange={setPlanningModelValue} capability="planning" options={modelOptions} />
          </div>

          {/* Planning effort (independent, only when the planning model supports it) */}
          {selectedPlanningModel?.supportsEffort ? (
            <EffortControl
              value={planningEffort}
              onChange={setPlanningEffort}
              {...(selectedPlanningModel.efforts !== null ? { levels: selectedPlanningModel.efforts } : {})}
            />
          ) : null}

          {/* Execution model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-[var(--color-text-subtle)]">
              Ejecución
            </span>
            <ModelPicker value={executionModelValue} onChange={setExecutionModelValue} capability="execution" options={modelOptions} />
          </div>

          {/* Execution effort */}
          {selectedExecutionModel?.supportsEffort ? (
            <EffortControl
              value={effort}
              onChange={setEffort}
              {...(selectedExecutionModel.efforts !== null ? { levels: selectedExecutionModel.efforts } : {})}
            />
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
      {pendingMigrationConflict !== null ? (
        <Callout tone="blocked" role="alert" icon={<AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />}>
          <span className="block font-semibold">Configuración duplicada de workspace</span>
          <span className="mt-1 block">
            Los registros &quot;{pendingMigrationConflict.canonicalSnapshot.name}&quot; y{" "}
            &quot;{pendingMigrationConflict.duplicateSnapshot.name}&quot; apuntaban al mismo repo y difieren
            en {pendingMigrationConflict.conflictingFields.join(", ")}. Elegí qué configuración conservar.
          </span>
          <div
            className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2"
            aria-label="Comparación de configuraciones duplicadas"
          >
            <MigrationConfigurationSnapshot
              label="Configuración actual"
              snapshot={pendingMigrationConflict.canonicalSnapshot}
              fields={pendingMigrationConflict.conflictingFields}
            />
            <MigrationConfigurationSnapshot
              label="Configuración duplicada"
              snapshot={pendingMigrationConflict.duplicateSnapshot}
              fields={pendingMigrationConflict.conflictingFields}
            />
          </div>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              busy={migrationConflictBusy === "canonical"}
              busyLabel="Resolviendo…"
              disabled={migrationConflictBusy !== null}
              onClick={() => void handleMigrationConflictResolution(pendingMigrationConflict, "canonical")}
            >
              Conservar configuración actual: {pendingMigrationConflict.canonicalSnapshot.name}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              busy={migrationConflictBusy === "duplicate"}
              busyLabel="Resolviendo…"
              disabled={migrationConflictBusy !== null}
              onClick={() => void handleMigrationConflictResolution(pendingMigrationConflict, "duplicate")}
            >
              Usar configuración duplicada: {pendingMigrationConflict.duplicateSnapshot.name}
            </Button>
          </span>
        </Callout>
      ) : null}
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
  return <IconButton label={label} disabled={disabled} onClick={onClick} tone={danger ? "danger" : "default"}>{children}</IconButton>;
}

type IndicatorTone = "ok" | "warning" | "error" | "muted";

const TONE_COLOR: Record<IndicatorTone, string> = {
  ok: "var(--status-completed-fg)",
  warning: "var(--status-blocked-fg)",
  error: "var(--status-failed-fg)",
  muted: "var(--color-text-subtle)"
};

function toneForUiStatus(status: UiStatus): IndicatorTone {
  if (status === "completed") return "ok";
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
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function readinessForSelections(
  providers: readonly ProviderReadiness[],
  selections: readonly ExecutorSelection[]
): ProviderReadiness[] {
  const byExecutor = new Map<string, ProviderReadiness>();
  for (const provider of providers) {
    byExecutor.set(provider.executorId, provider);
  }
  const requiredIds = Array.from(new Set(selections.map((selection) => selection.executorId)));
  return requiredIds.map((executorId) => byExecutor.get(executorId) ?? missingProviderReadiness(executorId));
}

function missingProviderReadiness(executorId: ExecutorId): ProviderReadiness {
  return {
    executorId,
    label: executorLabel(executorId),
    status: "error",
    binaryPath: "",
    quota: "unknown",
    checks: [
      {
        id: "cli",
        status: "fail",
        label: executorLabel(executorId),
        message: `No se pudo verificar ${executorLabel(executorId)}.`
      }
    ]
  };
}

function aggregateReadiness(providers: readonly ProviderReadiness[]): ProviderReadiness | null {
  if (providers.length === 0) {
    return null;
  }
  const status = providers.some((provider) => provider.status === "error")
    ? "error"
    : providers.some((provider) => provider.status === "warning")
      ? "warning"
      : "ready";
  return {
    executorId: providers[0]!.executorId,
    label: providers.map((provider) => provider.label).join(" + "),
    status,
    binaryPath: providers.map((provider) => provider.binaryPath).filter(Boolean).join(" + "),
    quota: "unknown",
    checks: providers.flatMap((provider) =>
      provider.checks.map((check) => ({
        ...check,
        label: `${provider.label} - ${check.label}`
      }))
    )
  };
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
  if (readinessLoading) return { status: "pending", label: "Verificando ejecutores…" };
  if (readinessError !== null) return { status: "blocked", label: "Ejecutores sin verificar" };
  switch (readiness?.status) {
    case "ready":
      return { status: "completed", label: `${readiness.label} listo` };
    case "warning":
      return { status: "blocked", label: `${readiness.label} con avisos` };
    case "error":
      return { status: "failed", label: `${readiness.label} con error` };
    default:
      return { status: "pending", label: "Ejecutores desconocidos" };
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
  if (readinessLoading) return "Verificando ejecutores…";
  if (readinessError !== null || readiness === null) return "Ejecutores sin verificar";
  if (readiness.status === "error") return "El ejecutor seleccionado necesita configuración";
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
    return `No se pudieron verificar los ejecutores: ${readinessError}`;
  }
  if (readiness === null) {
    return "Los ejecutores seleccionados todavía no fueron verificados.";
  }
  if (readiness.status === "error") {
    const failing = readiness.checks.find((check) => check.status === "fail");
    return failing?.message ?? "El ejecutor seleccionado no está listo. Instalalo, autenticalo o configurá su ruta.";
  }
  if (readiness.status === "warning") {
    const warning = readiness.checks.find((check) => check.status === "warning");
    return warning?.message ?? "El ejecutor está disponible, pero hay avisos de entorno para revisar.";
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
