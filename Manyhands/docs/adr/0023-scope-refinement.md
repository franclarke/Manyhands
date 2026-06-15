# 0023 · Scope refinement: path categories and forbidden zones

## Status

Accepted. Schemas defined in `ExecutionScopeSchema` (`packages/contracts`) and `ScopeCheckResultSchema` (`packages/execution-core`).

## Context

The existing `AllowedScopeSchema` uses a flat `paths: string[]` array. For real execution, finer granularity is needed: implementation files, test files, and config files have different risk profiles. Additionally, some paths should be globally forbidden (e.g., `.env`, `secrets/`) regardless of what the contract allows.

## Decision

- `ExecutionScopeSchema` introduces three path categories:
  - `implementationPaths`: globs for source code files (e.g., `["src/auth/**"]`).
  - `testPaths`: globs for test files (e.g., `["tests/auth/**"]`).
  - `configPaths`: globs for configuration files (e.g., `[".env.example"]`).
- `forbiddenPaths` is a flat array of globs that are always prohibited, regardless of scope. Applied globally across all tasks.
- The `ScopeChecker` (future implementation) validates `changedFiles` from `git diff` against both the contract's `executionScope` and the run-level `forbiddenPaths`.
- A file that matches both an allowed path and a forbidden path is **forbidden** (deny wins).
- Scope violations produce `ScopeViolationError` with the list of violating files.

## Consequences

Positive:
- Path categories enable differentiated reporting (e.g., "agent touched implementation files but no tests" is a useful signal).
- Forbidden paths provide a safety net against accidental credential exposure or critical file modification.
- Deny-wins semantics are simple and conservative.

Negative / accepted:
- Three categories may not cover all file types (docs, scripts, CI configs). Accepted: categories can be extended later.
- Glob matching adds a dependency on a glob library. Accepted: lightweight and well-understood.

## Alternatives considered

- **Keep flat `paths[]` only**: rejected — loses the ability to distinguish implementation from test scope, which is valuable for quality metrics.
- **Regex patterns instead of globs**: rejected — globs are the convention in `.gitignore`, CI configs, and existing contracts.

## References

- `packages/contracts/src/index.ts`: `ExecutionScopeSchema`, `AgentTaskContractSchema.executionScope`, `AgentTaskContractSchema.forbiddenPaths`
- `packages/execution-core/src/types.ts`: `ScopeCheckResultSchema`
- `packages/execution-core/src/errors.ts`: `ScopeViolationError`
