"use client";

import Link from "next/link";
import { useId } from "react";
import type { Workspace } from "@/lib/api-types";

interface WorkspacePickerProps {
  workspaces: Workspace[];
  value: string;
  onChange: (id: string) => void;
}

export function WorkspacePicker({ workspaces, value, onChange }: WorkspacePickerProps): React.ReactElement {
  const labelId = useId();

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <label
        htmlFor={labelId}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text-3)"
        }}
      >
        Workspace
      </label>
      <select
        id={labelId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 30,
          padding: "0 28px 0 10px",
          border: "1px solid var(--border)",
          background: "var(--bg-1)",
          color: "var(--text)",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          appearance: "none",
          cursor: "pointer"
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <Link
        href="/workspaces"
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--coral)",
          padding: "0 6px",
          whiteSpace: "nowrap"
        }}
      >
        manage →
      </Link>
    </div>
  );
}
