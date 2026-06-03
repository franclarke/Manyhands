"use client";

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
    <select
      id={labelId}
      aria-label="Workspace"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mh-select"
      style={{
        minHeight: 32,
        height: 32,
        padding: "0 24px 0 8px",
        fontSize: 12
      }}
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}
