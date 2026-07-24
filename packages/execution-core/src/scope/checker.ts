import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { ScopePathTraversalError, SymlinkEscapeError, ScopeViolationError } from "./scope-errors";
import type { ExecutionScope, ScopeContract } from "@manyhands/contracts";
import { ScopeCheckResultSchema, type ScopeCheckResult } from "../types";
import { matchesAnyGlob, normalizePath } from "./glob";

/**
 * A file is under a root only when the root is a strict directory prefix of it.
 * String prefixing alone would let `src/domain` swallow `src/domain-legacy/x.ts`,
 * so the boundary is the separator, and a root that normalizes to nothing (or to
 * the repository root) is refused here as well as in the contract schema.
 */
function isUnderAnyRoot(file: string, roots: readonly string[]): boolean {
  const target = normalizePath(file);
  return roots.some((root) => {
    const prefix = normalizePath(root).replace(/\/+$/u, "");
    if (prefix === "" || prefix === ".") return false;
    return target.startsWith(`${prefix}/`);
  });
}

export interface ScopeCheckParams {
  changedFiles: string[];
  /**
   * The subset of `changedFiles` the diff reports as newly created. Bounded
   * creation under `outputRoots` applies only to these — `git diff` is the
   * source of truth for what "new" means, never the agent's claim.
   */
  createdFiles?: readonly string[] | undefined;
  /** Allowed path categories. If omitted, every non-forbidden file is allowed. */
  executionScope?: ExecutionScope | undefined;
  /** Canonical V2 scope. Takes precedence over the legacy categorized scope. */
  scopeContract?: Pick<ScopeContract, "allowedPaths" | "forbiddenPaths"> & {
    outputRoots?: readonly string[] | undefined;
  } | undefined;
  /** Globs always prohibited regardless of scope. Deny wins (ADR-0023). */
  forbiddenPaths?: string[] | undefined;
  worktreeRoot?: string | undefined;
}

/**
 * Validates the files an agent changed against the contract's allowed scope and
 * the run-level forbidden paths. Two enforcement tiers:
 *
 * - **Forbidden paths (deny-list)** are a hard boundary: a file matching a
 *   forbidden glob is a terminal `violation` (deny wins — ADR-0023).
 * - **Allowed paths (allow-list)** are advisory: the decomposer guesses these
 *   globs for a layout that often does not exist yet (greenfield scaffolding),
 *   and a second, independent agent picks the real files. A changed file outside
 *   the allow-list but not forbidden is recorded in `outOfScope` for visibility
 *   but does NOT fail the run — the real isolation is the per-leaf git worktree,
 *   and real collisions surface at cherry-pick where the composer repairs.
 *
 * On top of the allow-list, `outputRoots` grant **bounded creation**: a node may
 * create a file it never pre-declared, provided the file is new and sits under a
 * directory the node already owns. This exists because a planner cannot reliably
 * predict every file a correct implementation will add (new tests, above all),
 * and rejecting that work made honest candidates fail. It is deliberately not a
 * relaxation of the allow-list: an existing file the node never declared stays
 * out of scope, so a root can never be used to take over a sibling's work.
 */
export class ScopeChecker {
  /**
   * Validates that a file path resolves within the worktree boundary.
   * Catches path traversal (../) and symlink escape attempts.
   */
  validatePathBoundary(worktreeRoot: string, targetPath: string): void {
    const resolvedRoot = resolve(worktreeRoot);
    const resolvedTarget = resolve(resolvedRoot, targetPath);

    // Path traversal check: resolved path must be within or equal to root
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
      throw new ScopePathTraversalError(targetPath, resolvedTarget, resolvedRoot);
    }

    // Symlink escape check: follow symlinks and verify the real path is still within boundary
    try {
      const realTarget = realpathSync(resolvedTarget);
      const realRoot = realpathSync(resolvedRoot);
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
        throw new SymlinkEscapeError(targetPath, resolvedTarget, realRoot, realTarget);
      }
    } catch (error) {
      // ENOENT: path does not exist yet (greenfield file). The logical path
      // check above already passed, so the file is within scope.
      if (error instanceof ScopeViolationError || error instanceof SymlinkEscapeError) throw error;
      // Other fs errors (ENOENT, EACCES) are acceptable for non-existent files.
    }
  }

  check(params: ScopeCheckParams): ScopeCheckResult {
    const forbidden = [
      ...(params.scopeContract?.forbiddenPaths ?? []),
      ...(params.forbiddenPaths ?? [])
    ];
    const allowed = params.scopeContract?.allowedPaths ?? (params.executionScope
      ? [
          ...params.executionScope.implementationPaths,
          ...params.executionScope.testPaths,
          ...params.executionScope.configPaths
        ]
      : undefined);

    const outputRoots = params.scopeContract?.outputRoots ?? [];
    const created = new Set((params.createdFiles ?? []).map(normalizePath));

    const violations: string[] = [];
    const outOfScope: string[] = [];

    // B-008: when worktreeRoot is provided, validate path boundaries first
    if (params.worktreeRoot !== undefined) {
      for (const file of params.changedFiles) {
        this.validatePathBoundary(params.worktreeRoot, file);
      }
    }

    for (const file of params.changedFiles) {
      if (matchesAnyGlob(file, forbidden)) {
        violations.push(file);
        continue;
      }
      if (allowed !== undefined && !matchesAnyGlob(file, allowed)) {
        if (created.has(normalizePath(file)) && isUnderAnyRoot(file, outputRoots)) {
          continue;
        }
        outOfScope.push(file);
      }
    }

    return ScopeCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      outOfScope
    });
  }
}

export { ScopePathTraversalError, SymlinkEscapeError } from "./scope-errors";
