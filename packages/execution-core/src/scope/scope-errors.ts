import { ScopeViolationError } from "../errors";

/**
 * B-008 — path boundary errors for ScopeChecker traversal guard.
 */

export class ScopePathTraversalError extends ScopeViolationError {
  readonly attemptedPath: string;
  readonly resolvedPath: string;
  readonly worktreeRoot: string;

  constructor(attemptedPath: string, resolvedPath: string, worktreeRoot: string, taskId = "scope-check") {
    super(
      `Path traversal blocked: "${attemptedPath}" resolves to "${resolvedPath}" which is outside worktree root "${worktreeRoot}".`,
      taskId,
      [attemptedPath]
    );
    this.name = "ScopePathTraversalError";
    this.attemptedPath = attemptedPath;
    this.resolvedPath = resolvedPath;
    this.worktreeRoot = worktreeRoot;
  }

  static override is(err: unknown): err is ScopePathTraversalError {
    return err instanceof ScopePathTraversalError;
  }
}

export class SymlinkEscapeError extends ScopePathTraversalError {
  readonly symlinkTarget: string;

  constructor(
    attemptedPath: string,
    resolvedPath: string,
    worktreeRoot: string,
    symlinkTarget: string,
    taskId = "scope-check"
  ) {
    super(attemptedPath, resolvedPath, worktreeRoot, taskId);
    this.name = "SymlinkEscapeError";
    this.symlinkTarget = symlinkTarget;
    this.message =
      `Symlink escape blocked: "${attemptedPath}" is a symlink pointing to ` +
      `"${symlinkTarget}" which resolves outside worktree root "${worktreeRoot}".`;
  }

  static override is(err: unknown): err is SymlinkEscapeError {
    return err instanceof SymlinkEscapeError;
  }
}

export { ScopeViolationError };
