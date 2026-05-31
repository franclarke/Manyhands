"use client";

import { useEffect, useState } from "react";
import type { PackageManagerKey } from "@/lib/api-types";

export interface WorkspaceFormValue {
  name: string;
  description: string;
  color: string;
  repoPath: string;
  packageManager: PackageManagerKey | "";
  defaultBranch: string;
  allowedPaths: string;
  testCommand: string;
  buildCommand: string;
}

interface WorkspaceFormDialogProps {
  mode: "create" | "edit";
  initial: WorkspaceFormValue | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: WorkspaceFormValue) => void;
}

const EMPTY: WorkspaceFormValue = {
  name: "",
  description: "",
  color: "",
  repoPath: "",
  packageManager: "",
  defaultBranch: "",
  allowedPaths: "",
  testCommand: "",
  buildCommand: ""
};

export function WorkspaceFormDialog({
  mode,
  initial,
  busy,
  onCancel,
  onSubmit
}: WorkspaceFormDialogProps): React.ReactElement {
  const [value, setValue] = useState<WorkspaceFormValue>(initial ?? EMPTY);
  const [browser, setBrowser] = useState<LocalBrowserState>({ open: false, loading: false });
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    if (initial === null) return false;
    return Boolean(
      initial.repoPath ||
      initial.packageManager ||
      initial.defaultBranch ||
      initial.allowedPaths ||
      initial.testCommand ||
      initial.buildCommand
    );
  });

  useEffect(() => {
    setValue(initial ?? EMPTY);
  }, [initial]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (value.name.trim().length === 0) return;
    onSubmit({
      name: value.name.trim(),
      description: value.description.trim(),
      color: value.color.trim(),
      repoPath: value.repoPath.trim(),
      packageManager: value.packageManager,
      defaultBranch: value.defaultBranch.trim(),
      allowedPaths: value.allowedPaths.trim(),
      testCommand: value.testCommand.trim(),
      buildCommand: value.buildCommand.trim()
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,25,21,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
        overflowY: "auto"
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "min(480px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto"
        }}
      >
        <header>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--coral)",
              margin: 0,
              marginBottom: 6
            }}
          >
            {mode === "create" ? "Create workspace" : "Edit workspace"}
          </p>
          <h2 className="mh-serif" style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
            {mode === "create" ? "Nuevo workspace" : value.name || "Workspace"}
          </h2>
        </header>

        <Field label="Name">
          <input
            value={value.name}
            onChange={(event) => setValue((v) => ({ ...v, name: event.target.value }))}
            required
            maxLength={80}
            autoFocus
            style={inputStyle}
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={value.description}
            onChange={(event) => setValue((v) => ({ ...v, description: event.target.value }))}
            maxLength={400}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" as const, minHeight: 70 }}
          />
        </Field>
        <Field label="Accent color (optional, hex)">
          <input
            value={value.color}
            onChange={(event) => setValue((v) => ({ ...v, color: event.target.value }))}
            placeholder="#cc785c"
            pattern="^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
            style={inputStyle}
          />
        </Field>

        <button
          type="button"
          onClick={() => setShowAdvanced((current) => !current)}
          style={{
            alignSelf: "flex-start",
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
          {showAdvanced ? "▾ Hide workspace hints" : "▸ Workspace hints (optional, used by LLM decomposer)"}
        </button>

        {showAdvanced ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 12,
              border: "1px dashed var(--border)",
              borderRadius: "var(--r-md)",
              background: "var(--bg-1)"
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
              Repo path is the local git folder ManyHands will plan, execute, integrate, and patch after approval. Commands and paths guide Codex and validation.
            </p>
            <Field label="Repo path (absolute or relative)">
              <div style={{ display: "flex", gap: 8, width: "100%" }}>
                <input
                  value={value.repoPath}
                  onChange={(event) => setValue((v) => ({ ...v, repoPath: event.target.value }))}
                  placeholder="/Users/me/code/my-repo"
                  maxLength={400}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    void browseLocal(value.repoPath, setBrowser);
                  }}
                  style={secondaryButtonStyle}
                >
                  Browse
                </button>
              </div>
            </Field>
            {browser.open ? (
              <LocalFolderBrowser
                state={browser}
                onBrowse={(dir) => {
                  void browseLocal(dir, setBrowser);
                }}
                onSelect={(dir) => {
                  setValue((v) => ({ ...v, repoPath: dir }));
                  setBrowser({ open: false, loading: false });
                }}
              />
            ) : null}
            <Field label="Package manager">
              <select
                value={value.packageManager}
                onChange={(event) => setValue((v) => ({ ...v, packageManager: event.target.value as PackageManagerKey | "" }))}
                style={inputStyle}
              >
                <option value="">(unset)</option>
                <option value="pnpm">pnpm</option>
                <option value="npm">npm</option>
                <option value="yarn">yarn</option>
                <option value="bun">bun</option>
              </select>
            </Field>
            <Field label="Default branch">
              <input
                value={value.defaultBranch}
                onChange={(event) => setValue((v) => ({ ...v, defaultBranch: event.target.value }))}
                placeholder="main"
                maxLength={120}
                style={inputStyle}
              />
            </Field>
            <Field label="Allowed paths (comma-separated)">
              <input
                value={value.allowedPaths}
                onChange={(event) => setValue((v) => ({ ...v, allowedPaths: event.target.value }))}
                placeholder="src/**, packages/**"
                style={inputStyle}
              />
            </Field>
            <Field label="Test command">
              <input
                value={value.testCommand}
                onChange={(event) => setValue((v) => ({ ...v, testCommand: event.target.value }))}
                placeholder="pnpm test"
                maxLength={240}
                style={inputStyle}
              />
            </Field>
            <Field label="Build command">
              <input
                value={value.buildCommand}
                onChange={(event) => setValue((v) => ({ ...v, buildCommand: event.target.value }))}
                placeholder="pnpm build"
                maxLength={240}
                style={inputStyle}
              />
            </Field>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "7px 12px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-2)",
              borderRadius: "var(--r-md)",
              fontSize: 12.5,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || value.name.trim().length === 0}
            style={{
              padding: "7px 14px",
              border: "1px solid var(--coral)",
              background: "var(--coral)",
              color: "#1A1915",
              borderRadius: "var(--r-md)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  background: "var(--bg-1)",
  color: "var(--text)",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "var(--font-sans)",
  outline: "none"
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "0 10px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-2)",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer"
};

interface LocalBrowserEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface LocalBrowserState {
  open: boolean;
  loading: boolean;
  cwd?: string;
  parent?: string;
  entries?: LocalBrowserEntry[];
  git?: { repoRoot: string; branch: string; head: string; dirty: boolean };
  error?: string;
}

async function browseLocal(
  dir: string,
  setBrowser: React.Dispatch<React.SetStateAction<LocalBrowserState>>
): Promise<void> {
  setBrowser((current) => {
    const next: LocalBrowserState = { ...current, open: true, loading: true };
    delete next.error;
    return next;
  });
  try {
    const query = dir.trim().length > 0 ? `?path=${encodeURIComponent(dir.trim())}` : "";
    const response = await fetch(`/api/local-fs/browse${query}`);
    const payload = (await response.json()) as LocalBrowserState & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `Browse failed with ${response.status}`);
    }
    setBrowser({ ...payload, open: true, loading: false });
  } catch (error) {
    setBrowser({
      open: true,
      loading: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function LocalFolderBrowser({
  state,
  onBrowse,
  onSelect
}: {
  state: LocalBrowserState;
  onBrowse: (dir: string) => void;
  onSelect: (dir: string) => void;
}): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "rgba(15,16,18,0.72)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>
          {state.loading ? "Loading..." : state.cwd ?? "Local folders"}
        </span>
        {state.git !== undefined ? (
          <button type="button" onClick={() => onSelect(state.git!.repoRoot)} style={secondaryButtonStyle}>
            Select git repo
          </button>
        ) : null}
      </div>
      {state.error !== undefined ? (
        <span style={{ color: "var(--error)", fontSize: 12 }}>{state.error}</span>
      ) : null}
      {state.parent !== undefined ? (
        <button type="button" onClick={() => onBrowse(state.parent!)} style={folderButtonStyle}>
          ..
        </button>
      ) : null}
      <div style={{ display: "grid", gap: 4, maxHeight: 180, overflow: "auto" }}>
        {(state.entries ?? []).map((entry) => (
          <button key={entry.path} type="button" onClick={() => onBrowse(entry.path)} style={folderButtonStyle}>
            <span>{entry.name}</span>
            {entry.isGitRepo ? <span style={{ color: "var(--ready)" }}>git</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

const folderButtonStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  border: "1px solid var(--rule-soft)",
  background: "rgba(229,222,204,0.025)",
  color: "var(--text)",
  borderRadius: 5,
  padding: "6px 8px",
  fontSize: 12,
  cursor: "pointer"
};

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "var(--text-3)"
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
