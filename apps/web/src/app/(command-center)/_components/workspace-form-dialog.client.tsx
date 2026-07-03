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
  const [pickingFolder, setPickingFolder] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initial ?? EMPTY);
    setPickerError(null);
  }, [initial]);

  async function pickFolder(): Promise<void> {
    setPickingFolder(true);
    setPickerError(null);
    try {
      const response = await fetch("/api/local-fs/pick-folder", { method: "POST" });
      const payload = (await response.json()) as { path?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Folder picker failed with ${response.status}`);
      }
      if (typeof payload.path !== "string" || payload.path.length === 0) return;
      setValue((current) => ({
        ...current,
        repoPath: payload.path!,
        name: current.name.trim().length === 0 ? basename(payload.path!) : current.name
      }));
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error));
    } finally {
      setPickingFolder(false);
    }
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (value.name.trim().length === 0 || value.repoPath.trim().length === 0) return;
    onSubmit({
      name: value.name.trim(),
      description: "",
      color: "",
      repoPath: value.repoPath.trim(),
      packageManager: "",
      defaultBranch: "",
      allowedPaths: "",
      testCommand: "",
      buildCommand: ""
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
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)"
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
            {mode === "create" ? "Crear workspace" : "Editar workspace"}
          </p>
          <h2 className="mh-serif" style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
            {mode === "create" ? "Nuevo workspace" : value.name || "Workspace"}
          </h2>
        </header>

        <Field label="Nombre">
          <input
            value={value.name}
            onChange={(event) => setValue((v) => ({ ...v, name: event.target.value }))}
            required
            maxLength={80}
            autoFocus
            style={inputStyle}
          />
        </Field>

        <Field label="Carpeta del repo">
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <input
              value={value.repoPath}
              onChange={(event) => setValue((v) => ({ ...v, repoPath: event.target.value }))}
              placeholder="Ruta local del repo"
              required
              maxLength={400}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={() => void pickFolder()} disabled={busy || pickingFolder} style={secondaryButtonStyle}>
              {pickingFolder ? "Abriendo..." : "Elegir carpeta"}
            </button>
          </div>
        </Field>

        {pickerError !== null ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--error)", lineHeight: 1.5 }}>
            {pickerError}
          </p>
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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || value.name.trim().length === 0 || value.repoPath.trim().length === 0}
            style={{
              padding: "7px 14px",
              border: "1px solid var(--color-accent)",
              background: "var(--color-accent)",
              color: "var(--color-accent-contrast)",
              borderRadius: "var(--r-md)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Guardando..." : mode === "create" ? "Crear" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  border: "1px solid var(--rule-control)",
  background: "var(--surface)",
  color: "var(--text)",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "var(--font-sans)"
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "0 10px",
  border: "1px solid var(--rule-control)",
  background: "rgba(241,234,216,0.035)",
  color: "var(--text)",
  borderRadius: 6,
  fontSize: 12.5,
  cursor: "pointer",
  whiteSpace: "nowrap"
};

function basename(folderPath: string): string {
  const normalized = folderPath.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? folderPath;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
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
