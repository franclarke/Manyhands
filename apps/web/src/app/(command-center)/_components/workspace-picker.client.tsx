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
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <select
        id={labelId}
        aria-label="Workspace"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mh-select"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <Link
        href="/workspaces"
        className="mh-mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 36,
          padding: "0 4px",
          fontSize: 12,
          color: "var(--text-2)",
          whiteSpace: "nowrap"
        }}
      >
        manage
      </Link>
    </div>
  );
}
