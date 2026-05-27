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
              Estos campos no se ejecutan todavía. Se usan únicamente como hints
              para guiar al LLM decomposer (paths, comandos, manager). Worktrees
              y ejecución real llegan en Fase D.
            </p>
            <Field label="Repo path (absolute or relative)">
              <input
                value={value.repoPath}
                onChange={(event) => setValue((v) => ({ ...v, repoPath: event.target.value }))}
                placeholder="/Users/me/code/my-repo"
                maxLength={400}
                style={inputStyle}
              />
            </Field>
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
