import { access, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

export async function readFinalArtifactFile(run: RunRecord, relativePath: string): Promise<string> {
  const repoRoot = await repoRootForRun(run);
  const finalSha = run.finalArtifactManifest?.finalSha;
  if (repoRoot === null || finalSha === undefined) throw new Error("Final artifact is not available.");
  const { stdout } = await execFileAsync("git", ["show", `${finalSha}:${relativePath}`], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: MAX_WORKSPACE_FILE_BYTES + 1
  });
  return stdout;
}

export async function listFinalArtifactTree(run: RunRecord, relativePath: string): Promise<Array<{
  name: string; path: string; kind: "file" | "directory";
}>> {
  const repoRoot = await repoRootForRun(run);
  const finalSha = run.finalArtifactManifest?.finalSha;
  if (repoRoot === null || finalSha === undefined) throw new Error("Final artifact is not available.");
  const treeish = relativePath.length === 0 ? finalSha : `${finalSha}:${relativePath}`;
  const { stdout } = await execFileAsync("git", ["ls-tree", treeish], { cwd: repoRoot, encoding: "utf8" });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [meta, name = ""] = line.split("\t");
    const kind = meta?.includes(" tree ") ? "directory" as const : "file" as const;
    return { name, path: relativePath.length > 0 ? `${relativePath}/${name}` : name, kind };
  });
}

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

/** Thrown when a path lexically inside the root REALLY lives outside it. */
export class WorkspaceEscapeError extends Error {
  constructor(relativePath: string) {
    super(`Path "${relativePath}" escapes the workspace root (symlink/junction).`);
    this.name = "WorkspaceEscapeError";
  }
}

/**
 * B-006 (CF-40): the lexical check above is not enough — `stat/readFile`
 * follow symlinks and junctions, so a link INSIDE the workspace can read
 * anywhere on disk. Resolve the REAL path of the target and require it to
 * stay under the real root.
 */
export async function resolveContainedWorkspaceFile(rootPath: string, relativePath: string): Promise<string> {
  const target = resolveWorkspacePath(rootPath, relativePath);
  const realRoot = await realpath(path.resolve(rootPath));
  const realTarget = await realpath(target);
  const relative = path.relative(realRoot, realTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WorkspaceEscapeError(relativePath);
  }
  return realTarget;
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
    const rootPath = repoRoot;
    return {
      context: "final",
      label: run.finalBranchName !== undefined ? `Resultado ${run.finalBranchName}` : "Resultado integrado",
      rootPath,
      exists: run.finalArtifactManifest !== undefined && await pathExists(rootPath)
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
  // B-008: the frozen target context beats the mutable workspace record.
  if (run.targetContext !== undefined) return run.targetContext.sourceRealPath;
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
