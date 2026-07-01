import { access } from "node:fs/promises";
import path from "node:path";
import { worktreePathFor } from "@manyhands/execution-core";
import { getWorkspaceRepository } from "../workspaces/store";
import type { RunRecord } from "./schema";

export type WorkspaceContextKind = "base" | "node" | "final";

export interface WorkspaceContextRequest {
  context: WorkspaceContextKind;
  nodeId?: string | undefined;
}

export interface ResolvedWorkspaceContext {
  context: WorkspaceContextKind;
  label: string;
  rootPath: string;
  exists: boolean;
}

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo"
]);

export const MAX_WORKSPACE_FILE_BYTES = 512 * 1024;

export function parseWorkspaceContext(value: string | null): WorkspaceContextKind {
  if (value === "node" || value === "final" || value === "base") return value;
  return "base";
}

export function safeWorkspaceRelativePath(input: string | null | undefined): string {
  const raw = (input ?? "").trim().replace(/\\/g, "/");
  if (raw.length === 0 || raw === ".") return "";
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new Error("Absolute paths are not allowed.");
  }
  const parts = raw.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error("Path traversal is not allowed.");
  }
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) {
    throw new Error("That path is excluded from the workspace browser.");
  }
  return parts.join("/");
}

export function resolveWorkspacePath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path escapes the workspace root.");
  }
  return target;
}

export async function resolveRunWorkspaceContext(
  run: RunRecord,
  request: WorkspaceContextRequest
): Promise<ResolvedWorkspaceContext> {
  const repoRoot = await repoRootForRun(run);
  if (repoRoot === null) {
    throw new Error("This run does not have a local repository path.");
  }

  if (request.context === "node") {
    if (request.nodeId === undefined || request.nodeId.trim().length === 0) {
      throw new Error("nodeId is required for node worktree context.");
    }
    const rootPath = worktreePathFor({
      worktreesRoot: `${repoRoot.replace(/[\\/]+$/, "")}/.manyhands/worktrees`,
      runId: run.runId,
      taskId: request.nodeId
    });
    return {
      context: "node",
      label: `Worktree ${request.nodeId}`,
      rootPath,
      exists: await pathExists(rootPath)
    };
  }

  if (request.context === "final") {
    const rootPath = run.appliedToRepoPath ?? repoRoot;
    return {
      context: "final",
      label: run.finalBranchName !== undefined ? `Resultado ${run.finalBranchName}` : "Resultado integrado",
      rootPath,
      exists: await pathExists(rootPath)
    };
  }

  return {
    context: "base",
    label: "Repo base",
    rootPath: repoRoot,
    exists: await pathExists(repoRoot)
  };
}

async function repoRootForRun(run: RunRecord): Promise<string | null> {
  if (run.provisioned?.repoRoot !== undefined) return run.provisioned.repoRoot;
  if (run.repoSpec?.kind === "localPath") return run.repoSpec.path;
  const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
  return workspace?.repoPath ?? null;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
