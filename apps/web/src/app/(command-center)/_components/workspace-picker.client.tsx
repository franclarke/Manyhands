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
      className="mh-select h-8 max-w-[220px] text-label font-medium"
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}
