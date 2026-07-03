import type { ExecutionScope } from "@manyhands/contracts";

import { ScopeCheckResultSchema, type ScopeCheckResult } from "../types";
import { matchesAnyGlob } from "./glob";

export interface ScopeCheckParams {
  changedFiles: string[];
  /** Allowed path categories. If omitted, every non-forbidden file is allowed. */
  executionScope?: ExecutionScope | undefined;
  /** Globs always prohibited regardless of scope. Deny wins (ADR-0023). */
  forbiddenPaths?: string[] | undefined;
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
 */
export class ScopeChecker {
  check(params: ScopeCheckParams): ScopeCheckResult {
    const forbidden = params.forbiddenPaths ?? [];
    const allowed = params.executionScope
      ? [
          ...params.executionScope.implementationPaths,
          ...params.executionScope.testPaths,
          ...params.executionScope.configPaths
        ]
      : undefined;

    const violations: string[] = [];
    const outOfScope: string[] = [];

    for (const file of params.changedFiles) {
      if (matchesAnyGlob(file, forbidden)) {
        violations.push(file);
        continue;
      }
      if (allowed !== undefined && !matchesAnyGlob(file, allowed)) {
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
