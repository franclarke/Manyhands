import { createHash } from "node:crypto";
import { tmpdir as osTmpdir } from "node:os";

const MAX_WORKTREE_SEGMENT_LENGTH = 64;
const WINDOWS_GIT_PATH_BUDGET = 220;
const WORKTREE_PATH_RESERVE = 1 + MAX_WORKTREE_SEGMENT_LENGTH + "/.git".length;
const RELOCATED_WORKTREES_DIRNAME = "mh-wt";
const WINDOWS_RESERVED_SEGMENTS = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

export interface WorktreeRootParams {
  worktreesRoot: string;
  runId: string;
  platform?: NodeJS.Platform;
  tmpdir?: () => string;
}

export function safeWorktreeSegment(id: string): string {
  const trimmed = id.trim();
  const normalized = trimmed
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const needsRewrite =
    normalized.length === 0 ||
    normalized !== trimmed ||
    normalized.length > MAX_WORKTREE_SEGMENT_LENGTH ||
    WINDOWS_RESERVED_SEGMENTS.has(normalized.toUpperCase());

  if (!needsRewrite) return normalized;
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 8);
  const prefix =
    normalized.length === 0 || WINDOWS_RESERVED_SEGMENTS.has(normalized.toUpperCase())
      ? "id"
      : normalized.slice(0, MAX_WORKTREE_SEGMENT_LENGTH - hash.length - 1);
  return `${prefix}-${hash}`;
}

export function runWorktreesRootFor(params: WorktreeRootParams): string {
  const root = params.worktreesRoot.replace(/[\\/]+$/, "");
  const runSegment = safeWorktreeSegment(params.runId);
  const candidate = `${root}/${runSegment}`;
  const platform = params.platform ?? process.platform;
  if (
    platform !== "win32" ||
    candidate.length + WORKTREE_PATH_RESERVE <= WINDOWS_GIT_PATH_BUDGET
  ) {
    return candidate;
  }
  const tmpBase = (params.tmpdir ?? osTmpdir)().replace(/[\\/]+$/, "");
  return `${tmpBase}/${RELOCATED_WORKTREES_DIRNAME}/${runSegment}`;
}

export function worktreePathFor(
  params: WorktreeRootParams & { taskId: string }
): string {
  return `${runWorktreesRootFor(params)}/${safeWorktreeSegment(params.taskId)}`;
}

export function worktreeBranchFor(params: { runId: string; taskId: string }): string {
  return `mh/${safeWorktreeSegment(params.runId)}/${safeWorktreeSegment(params.taskId)}`;
}
