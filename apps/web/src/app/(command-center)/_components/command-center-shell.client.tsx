"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorResponse, RunResponse, Workspace } from "@/lib/api-types";
import { GranularitySelector } from "./granularity-selector.client";
import { ScenarioPicker, getDefaultScenarioId } from "./scenario-picker.client";
import { TaskPrompt } from "./task-prompt.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { toGranularityMode, type GranularityLevel } from "@/lib/granularity";
import { findScenario } from "@/lib/scenarios";
import { EXECUTABLE_FIXTURES } from "@/lib/executable-fixtures";

const PROMPT_STORAGE_KEY = "manyhands:lastPrompt";

type RunMode = "planning" | "mock" | "execution-ready";

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
  const [repoFixtureId, setRepoFixtureId] = useState<string>("");
  const [granularity, setGranularity] = useState<GranularityLevel>(initialGranularity);
  const [mode, setMode] = useState<RunMode>("planning");
  const [modelId] = useState<string>(initialModelId);
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

  const scenario = scenarioId.length > 0 ? findScenario(scenarioId) : undefined;
  const granularityMode = toGranularityMode(granularity);
  const granularitySupported = scenario !== undefined
    ? granularityMode === "auto" || scenario.supportedGranularities.includes(granularityMode)
    : true;
  const hasPrompt = prompt.trim().length > 0;
  const canStart = selectedWorkspace !== null && hasPrompt && granularitySupported && !submitting;

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
        scenarioId?: string;
        repoSpec?: { kind: "fixture"; fixtureId: string };
      } = {
        workspaceId: selectedWorkspace.id,
        granularity: granularityMode,
        model: modelId,
        userPrompt: prompt.trim()
      };
      if (scenario !== undefined) {
        body.scenarioId = scenario.id;
      }
      if (repoFixtureId.length > 0) {
        body.repoSpec = { kind: "fixture", fixtureId: repoFixtureId };
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

  if (workspaces.length === 0) {
    return (
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: 24,
          border: "1px dashed var(--rule-strong)",
          background: "rgba(229,222,204,0.018)",
          borderRadius: "var(--r-lg)",
          color: "var(--text-2)"
        }}
      >
        <p className="mh-serif" style={{ fontSize: 20, color: "var(--text)", margin: 0 }}>
          No workspaces yet.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
          Create one before generating a DAG.
        </p>
      </div>
    );
  }

  return (
    <section
      className="mh-tick-frame"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "14px 0 0",
        display: "flex",
        flexDirection: "column",
        gap: 18
      }}
    >
      <TaskPrompt
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => {
          void handleStart();
        }}
        disabled={!canStart}
      />

      <div style={{ height: 1, background: "var(--rule)", marginTop: -2 }} />

      <ControlRow label="Workspace">
        <WorkspacePicker
          workspaces={workspaces}
          value={workspaceId}
          onChange={setWorkspaceId}
        />
        <span className="mh-coord" style={{ opacity: 0.5 }}>branch</span>
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {selectedWorkspace?.defaultBranch ?? "main"}
        </span>
      </ControlRow>

      <ControlRow label="Granularity" hint="planner depth">
        <GranularitySelector value={granularity} onChange={setGranularity} />
      </ControlRow>

      <ControlRow label="Mode" hint="what this run will do">
        <ModeSelector value={mode} onChange={setMode} />
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          Codex execution appears after the DAG is approved.
        </span>
      </ControlRow>

      <ControlRow label="Target repo" hint="real execution fixture">
        <select
          value={repoFixtureId}
          onChange={(event) => setRepoFixtureId(event.target.value)}
          className="mh-mono"
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--rule)",
            background: "rgba(229,222,204,0.035)",
            color: "var(--text)",
            borderRadius: "var(--r-md)",
            fontSize: 12.5
          }}
        >
          <option value="">none — plan only (mock)</option>
          {EXECUTABLE_FIXTURES.map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {fixture.label}
            </option>
          ))}
        </select>
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          {repoFixtureId.length > 0
            ? EXECUTABLE_FIXTURES.find((f) => f.id === repoFixtureId)?.description
            : "Select a fixture to enable real Codex execution."}
        </span>
      </ControlRow>

      {errorMessage !== null ? (
        <div
          role="alert"
          style={{
            border: "1px solid rgba(178,106,96,0.45)",
            background: "rgba(178,106,96,0.08)",
            color: "var(--error)",
            padding: "8px 10px",
            borderRadius: "var(--r-md)",
            fontSize: 12.5
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => {
            void handleStart();
          }}
          style={{
            height: 38,
            padding: "0 16px",
            border: `1px solid ${canStart ? "var(--copper)" : "var(--rule)"}`,
            background: canStart ? "var(--copper)" : "rgba(229,222,204,0.035)",
            color: canStart ? "#14110e" : "var(--text-3)",
            borderRadius: "var(--r-lg)",
            fontSize: 14,
            fontWeight: 600,
            cursor: canStart ? "pointer" : "not-allowed"
          }}
        >
          {submitting ? "Generating DAG..." : "Generate DAG"}
        </button>
        <button
          type="button"
          disabled
          title="Available after Codex CLI execution is connected."
          style={{
            height: 34,
            padding: "0 12px",
            border: "1px solid var(--rule)",
            background: "transparent",
            color: "var(--text-3)",
            borderRadius: "var(--r-md)",
            fontSize: 12,
            cursor: "not-allowed"
          }}
        >
          Run with Codex / future
        </button>
        <span style={{ flex: 1 }} />
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          Ctrl+Enter also generates
        </span>
      </div>

      <AdvancedSection>
        <ScenarioPicker
          value={scenarioId}
          onChange={setScenarioId}
          granularity={granularityMode}
        />
      </AdvancedSection>
    </section>
  );
}

function ControlRow({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "10px 0",
        borderBottom: "1px solid var(--rule-soft)"
      }}
    >
      <div style={{ width: 124, flex: "0 0 124px" }}>
        <div className="mh-coord">{label}</div>
        {hint !== undefined ? (
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function ModeSelector({
  value,
  onChange
}: {
  value: RunMode;
  onChange: (value: RunMode) => void;
}): React.ReactElement {
  const options: Array<{ id: RunMode; label: string }> = [
    { id: "planning", label: "Planning" },
    { id: "mock", label: "Mock" },
    { id: "execution-ready", label: "Execution-ready" }
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Run mode"
      style={{
        display: "inline-flex",
        padding: 2,
        border: "1px solid var(--rule)",
        borderRadius: 7
      }}
    >
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            style={{
              height: 26,
              border: "none",
              background: active ? "rgba(229,222,204,0.06)" : "transparent",
              color: active ? "var(--text)" : "var(--text-2)",
              borderRadius: 5,
              padding: "0 10px",
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AdvancedSection({ children }: { children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 2 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-3)",
          cursor: "pointer",
          padding: 0,
          fontSize: 11,
          fontFamily: "var(--font-mono)"
        }}
      >
        {open ? "Hide research fixture" : "Research fixture / deterministic mock"}
      </button>
      {open ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: "1px dashed var(--rule-strong)",
            borderRadius: "var(--r-md)",
            background: "rgba(229,222,204,0.018)",
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
            Fixtures keep thesis demos reproducible. Prompt-only runs require a live
            decomposer key; fixture-backed runs stay clearly marked as mock.
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}
