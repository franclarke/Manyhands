import type { MinimalWorkspaceView } from "./minimal-workspace-view";
import type { VitalStatus, WorkspaceNode } from "./workspace-view";

export type RunOutlineFilter = "all" | "running" | "blocked" | "failed" | "attention" | "integrated";

export interface RunOutlineItem {
  id: string;
  title: string;
  role: WorkspaceNode["role"];
  depth: number;
  parentId: string | null;
  status: VitalStatus;
  label: string;
  hasActiveConflict: boolean;
  matchesFilter: boolean;
  hasMatchingDescendant: boolean;
}

export interface RunOutlineView {
  items: RunOutlineItem[];
  matchCount: number;
}

export function selectRunOutline(view: MinimalWorkspaceView, filter: RunOutlineFilter): RunOutlineView {
  const nodes = view.details.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const directMatches = new Set(
    nodes.filter((node) => matches(node, filter)).map((node) => node.id)
  );
  const visible = new Set(directMatches);

  if (filter !== "all") {
    for (const id of directMatches) {
      let current = byId.get(id);
      while (current?.parentId !== null && current?.parentId !== undefined) {
        visible.add(current.parentId);
        current = byId.get(current.parentId);
      }
    }
  }

  const children = new Map<string | null, WorkspaceNode[]>();
  for (const node of nodes) {
    const bucket = children.get(node.parentId) ?? [];
    bucket.push(node);
    children.set(node.parentId, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }

  const ordered: WorkspaceNode[] = [];
  const visit = (node: WorkspaceNode): void => {
    if (visible.has(node.id)) ordered.push(node);
    for (const child of children.get(node.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);

  return {
    items: ordered.map((node) => ({
      id: node.id,
      title: node.title,
      role: node.role,
      depth: node.depth,
      parentId: node.parentId,
      status: node.vital.status,
      label: node.vital.label,
      hasActiveConflict: node.hasActiveConflict,
      matchesFilter: directMatches.has(node.id),
      hasMatchingDescendant: visible.has(node.id) && !directMatches.has(node.id)
    })),
    matchCount: directMatches.size
  };
}

function matches(node: WorkspaceNode, filter: RunOutlineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return node.vital.status === "running" || node.vital.status === "verifying" || node.vital.status === "repairing";
    case "blocked":
      return node.vital.status === "blocked" || node.vital.status === "gated";
    case "failed":
      return node.vital.status === "failed";
    case "attention":
      return node.hasActiveConflict || node.vital.status === "gated" || node.vital.status === "blocked" || node.vital.status === "failed" || node.vital.status === "obsolete";
    case "integrated":
      return node.vital.status === "done";
    default:
      return true;
  }
}
