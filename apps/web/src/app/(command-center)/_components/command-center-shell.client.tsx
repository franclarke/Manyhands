"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorResponse, RunResponse, Workspace } from "@/lib/api-types";
import { GranularitySelector } from "./granularity-selector.client";
import { ModelPicker } from "./model-picker.client";
import { ScenarioPicker, getDefaultScenarioId } from "./scenario-picker.client";
import { TaskPrompt } from "./task-prompt.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { toDecompositionMode, type GranularityLevel } from "@/lib/granularity";
import { findScenario } from "@/lib/scenarios";

const PROMPT_STORAGE_KEY = "manyhands:lastPrompt";

interface CommandCenterShellProps {
  workspaces: Workspace[];
  initialGranularity: GranularityLevel;
  initialModelId: string;
}

export function CommandCenterShell({
  workspaces,
  initialGranularity,
  initialModelId
}: CommandCenterShellProps): React.ReactElement {
  const router = useRouter();
  const initialWorkspaceId = workspaces[0]?.id ?? "";
  const [workspaceId, setWorkspaceId] = useState<string>(initialWorkspaceId);
  const [scenarioId, setScenarioId] = useState<string>(getDefaultScenarioId());
  const [granularity, setGranularity] = useState<GranularityLevel>(initialGranularity);
  const [modelId, setModelId] = useState<string>(initialModelId);
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? workspaces[0] ?? null,
    [workspaces, workspaceId]
  );

  const scenario = findScenario(scenarioId);
  const decompositionMode = toDecompositionMode(granularity);
  const granularitySupported = scenario?.supportedGranularities.includes(decompositionMode) ?? true;
  const canStart = selectedWorkspace !== null && scenario !== undefined && granularitySupported && !submitting;

  async function handleStart(): Promise<void> {
    if (selectedWorkspace === null || scenario === undefined) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: selectedWorkspace.id,
          scenarioId: scenario.id,
          granularity: decompositionMode,
          model: modelId,
          userPrompt: prompt.trim()
        })
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

  if (workspaces.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          border: "1px dashed var(--border)",
          background: "var(--bg-1)",
          borderRadius: "var(--r-lg)",
          color: "var(--text-2)"
        }}
      >
        <p className="mh-serif" style={{ fontSize: 20, color: "var(--text)", margin: 0 }}>
          No workspaces yet.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
          Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        padding: 22,
        boxShadow: "var(--shadow-lift)",
        display: "flex",
        flexDirection: "column",
        gap: 18
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <WorkspacePicker
            workspaces={workspaces}
            value={workspaceId}
            onChange={setWorkspaceId}
          />
          <ModelPicker value={modelId} onChange={setModelId} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-3)",
            letterSpacing: 0.4
          }}
        >
          fase B · scenario determines the deterministic plan
        </span>
      </div>

      <TaskPrompt
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => {
          void handleStart();
        }}
        disabled={!canStart}
      />

      {errorMessage !== null ? (
        <div
          role="alert"
          style={{
            border: "1px solid rgba(194,91,84,0.55)",
            background: "rgba(194,91,84,0.10)",
            color: "var(--error)",
            padding: "8px 12px",
            borderRadius: "var(--r-md)",
            fontSize: 12.5
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <GranularitySelector value={granularity} onChange={setGranularity} />

      <AdvancedSection>
        <ScenarioPicker
          value={scenarioId}
          onChange={setScenarioId}
          granularity={decompositionMode}
        />
      </AdvancedSection>
    </section>
  );
}

function AdvancedSection({ children }: { children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--coral)",
          cursor: "pointer",
          padding: 0,
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          letterSpacing: 0.4
        }}
      >
        {open ? "▾ Advanced" : "▸ Advanced (scenario picker, reproducible plans)"}
      </button>
      {open ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: "1px dashed var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            gap: 10
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11.5,
              color: "var(--text-3)",
              lineHeight: 1.5
            }}
          >
            En esta fase, el escenario seleccionado determina el plan determinístico de fallback.
            Cuando hay <code>ANTHROPIC_API_KEY</code>, el LLM decomposer genera el árbol a partir del prompt;
            el escenario se mantiene como fixture base. Tu prompt queda guardado como objetivo del run.
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}
