"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorResponse, RunResponse, Workspace } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { ControlRow } from "@/components/ui/control-row";
import { GranularitySelector } from "./granularity-selector.client";
import { ModelPicker } from "./model-picker.client";
import { ScenarioPicker } from "./scenario-picker.client";
import { TaskPrompt } from "./task-prompt.client";
import { WorkspacePicker } from "./workspace-picker.client";
import { toGranularityMode, type GranularityLevel } from "@/lib/granularity";
import { findScenario } from "@/lib/scenarios";

const PROMPT_STORAGE_KEY = "manyhands:lastPrompt";
const COLUMN_WIDTH = 880;

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
  workspaces,
  initialGranularity,
  initialModelId
}: CommandCenterShellProps): React.ReactElement {
  const router = useRouter();
  // Prefer the first executable workspace (one with a local repo) so the main
  // flow doesn't start blocked on a repo-less default. Falls back to the first
  // workspace when none has a repoPath (the UI then explains why Start is gated).
  const initialWorkspaceId =
    workspaces.find((entry) => entry.repoPath !== undefined && entry.repoPath.length > 0)?.id ??
    workspaces[0]?.id ??
    "";
  const [workspaceId, setWorkspaceId] = useState<string>(initialWorkspaceId);
  const [scenarioId, setScenarioId] = useState<string>("");
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

  const scenario = scenarioId.length > 0 ? findScenario(scenarioId) : undefined;
  const granularityMode = toGranularityMode(granularity);
  const granularitySupported = scenario !== undefined
    ? granularityMode === "auto" || scenario.supportedGranularities.includes(granularityMode)
    : true;
  const hasPrompt = prompt.trim().length > 0;
  const hasLocalRepo = selectedWorkspace?.repoPath !== undefined && selectedWorkspace.repoPath.length > 0;
  const canStart =
    selectedWorkspace !== null &&
    hasPrompt &&
    granularitySupported &&
    (scenario !== undefined || hasLocalRepo) &&
    modelId.trim().length > 0 &&
    !submitting;
  const executionMode = scenario !== undefined ? "Lab planning fixture" : "Local Gemini execution";

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
        repoSpec?: { kind: "localPath"; path: string };
      } = {
        workspaceId: selectedWorkspace.id,
        granularity: granularityMode,
        model: modelId,
        userPrompt: prompt.trim()
      };
      if (scenario !== undefined) {
        body.scenarioId = scenario.id;
      }
      if (scenario === undefined && selectedWorkspace.repoPath !== undefined) {
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

  if (workspaces.length === 0) {
    return (
      <div
        style={{
          maxWidth: COLUMN_WIDTH,
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
          Create a workspace before generating a task graph.
        </p>
      </div>
    );
  }

  return (
    <section
      style={{
        maxWidth: COLUMN_WIDTH,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24
      }}
    >
      <TaskPrompt
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => {
          void handleStart();
        }}
        disabled={!canStart}
        examples={EXAMPLE_PROMPTS}
      />

      <div style={{ height: 1, background: "var(--rule)" }} />

      {/* Run configuration — inline rows, separation by spacing not boxes. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 2 }}>
          <span className="mh-coord" style={{ color: "var(--copper)" }}>
            Run configuration
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
          <span className="mh-mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>
            {executionMode}
          </span>
        </div>

        <ControlRow label="Workspace">
          <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setWorkspaceId} />
          <span className="mh-mono" style={{ color: "var(--text-4)", padding: "0 2px" }}>
            ·
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--text-3)",
              fontSize: 12
            }}
          >
            <BranchGlyph />
            <span className="mh-mono" style={{ fontSize: 12 }}>
              {selectedWorkspace?.defaultBranch ?? "main"}
            </span>
          </span>
        </ControlRow>

        <ControlRow label="Target repo">
          <span
            className="mh-mono"
            style={{
              fontSize: 11.5,
              color: hasLocalRepo ? "var(--text-2)" : "var(--error)",
              wordBreak: "break-all"
            }}
          >
            {selectedWorkspace?.repoPath ?? "Configure a local git folder in this workspace"}
          </span>
        </ControlRow>

        <ControlRow label="Model">
          <ModelPicker value={modelId} onChange={setModelId} />
        </ControlRow>

        <ControlRow
          label="Granularity"
          hint="how deep the planner decomposes — decided per task, not a fixed depth"
          last
        >
          <GranularitySelector value={granularity} onChange={setGranularity} />
        </ControlRow>
      </div>

      {errorMessage !== null ? (
        <div
          role="alert"
          style={{
            border: "1px solid var(--status-failed-border)",
            background: "var(--status-failed-bg)",
            color: "var(--status-failed-fg)",
            padding: "9px 11px",
            borderRadius: "var(--r-md)",
            fontSize: 12.5
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          size="md"
          disabled={!canStart}
          busy={submitting}
          busyLabel="Generating task graph…"
          onClick={() => {
            void handleStart();
          }}
          style={{ height: 42, padding: "0 18px", fontSize: 14, fontWeight: 700, borderRadius: "var(--r-lg)" }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
            Generate task graph
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                lineHeight: 1,
                padding: "2px 5px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.18)",
                color: "rgba(0,0,0,0.6)"
              }}
            >
              ⌘↵
            </span>
          </span>
        </Button>

        <ActionHint
          granularitySupported={granularitySupported}
          scenarioSelected={scenario !== undefined}
          hasLocalRepo={hasLocalRepo}
          workspaceName={selectedWorkspace?.name ?? null}
        />
      </div>

      <AdvancedSection>
        <ScenarioPicker value={scenarioId} onChange={setScenarioId} granularity={granularityMode} />
      </AdvancedSection>
    </section>
  );
}

function ActionHint({
  granularitySupported,
  scenarioSelected,
  hasLocalRepo,
  workspaceName
}: {
  granularitySupported: boolean;
  scenarioSelected: boolean;
  hasLocalRepo: boolean;
  workspaceName: string | null;
}): React.ReactElement {
  if (!granularitySupported) {
    return (
      <span className="mh-mono" style={{ color: "var(--error)", fontSize: 11 }}>
        Selected lab scenario does not support this granularity.
      </span>
    );
  }
  if (!scenarioSelected && !hasLocalRepo) {
    return (
      <span className="mh-mono" style={{ color: "var(--error)", fontSize: 11, lineHeight: 1.4 }}>
        {workspaceName !== null
          ? `Workspace "${workspaceName}" has no local git repo. Configure one, pick a workspace that has one, or select a lab scenario.`
          : "Select a workspace with a local git repo, or pick a lab scenario."}
      </span>
    );
  }
  return (
    <span style={{ color: "var(--text-3)", fontSize: 12.5, lineHeight: 1.45, maxWidth: 460 }}>
      {scenarioSelected
        ? "Lab scenario selected — planning stays deterministic for replay."
        : "Gemini plans locally, agents run after approval, and the final patch is applied on success."}
    </span>
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
        {open ? "Hide lab fixture" : "Lab fixture options"}
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
            Lab fixtures keep thesis demos reproducible. Prompt-only runs use the live planner.
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}
