import type { ExecutionScope } from "@manyhands/contracts";

import { ScopeCheckResultSchema, type ScopeCheckResult } from "../types";
import { matchesAnyGlob } from "./glob";

export interface ScopeCheckParams {
  changedFiles: string[];
  /** Allowed path categories. If omitted, every non-forbidden file is allowed. */
  executionScope?: ExecutionScope;
  /** Globs always prohibited regardless of scope. Deny wins (ADR-0023). */
  forbiddenPaths?: string[];
}

/**
 * Validates the files an agent changed against the contract's allowed scope and
 * the run-level forbidden paths. Deny wins: a file matching both an allowed and
 * a forbidden glob is a violation (ADR-0023).
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

    for (const file of params.changedFiles) {
      if (matchesAnyGlob(file, forbidden)) {
        violations.push(file);
        continue;
      }
      if (allowed !== undefined && !matchesAnyGlob(file, allowed)) {
        violations.push(file);
      }
    }

    return ScopeCheckResultSchema.parse({
      passed: violations.length === 0,
      violations
    });
  }
}
