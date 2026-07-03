import type { ExecutionScope } from "@manyhands/contracts";

/**
 * Maps a flat list of allowed globs to the execution-time `ExecutionScope`
 * (V2) the executor and ScopeChecker consume. Single sede for the V1→V2 scope
 * mapping decision.
 *
 * Categorisation into implementation/test/config is deferred — the ScopeChecker
 * enforces against the *union* of the three categories, so lumping everything
 * into `implementationPaths` is correct for enforcement and avoids fragile glob
 * heuristics.
 *
 * IMPORTANT: callers must pass an already fallback-resolved, **non-empty**
 * `allowedPaths`. An empty `implementationPaths` would make the ScopeChecker
 * reject every change (empty allow-list = nothing permitted).
 */
export function executionScopeFromAllowed(allowedPaths: string[]): ExecutionScope {
  return {
    implementationPaths: allowedPaths,
    testPaths: [],
    configPaths: []
  };
}
