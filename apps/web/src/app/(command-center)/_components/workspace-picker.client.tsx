"use client";

import type { Workspace } from "@/lib/api-types";

interface WorkspacePickerProps {
  workspaces: Workspace[];
  value: string;
  onChange: (id: string) => void;
}

export function WorkspacePicker({ workspaces, value, onChange }: WorkspacePickerProps): React.ReactElement {
  return (
    <select
      id="workspace-picker"
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
