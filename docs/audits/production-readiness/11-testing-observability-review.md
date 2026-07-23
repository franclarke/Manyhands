# 11 — Testing & Observability Review

**Audit Date**: 2026-07-21  
**Target Suites**: `tests/`, `packages/trace-store`, `vitest.config.ts`  
**Auditor**: Teamwork Explorer (Testing & Observability Specialist)  

---

## 1. Test Suite Execution & Diagnostic Observability Overview

The ManyHands repository uses Vitest as its test runner for unit and integration tests. 

Execution of `pnpm test` resulted in **2 test file failures out of 166 test files** (958 passed, 2 failed, 1 skipped). Additionally, diagnostic observability is compromised because diagnostic traces (`TraceEvent`) are stored strictly in memory via `InMemoryTraceStore` and evaporate on process termination.

---

## 2. Test Execution Log (`pnpm test`)

```text
FAIL tests/run-loading-skeleton.test.ts > foundation v-next — loading skeleton parity
AssertionError: expected runViewSource to contain shared layout class

FAIL tests/typography-scale.test.ts > foundation v-next — no off-scale arbitraries in components
AssertionError: off-grid spacing remains:
app\runs\proto\[fixture]\cockpit-fixture-view.client.tsx:73
app\runs\[runId]\_components\run-model-view.client.tsx:132

Test Files  2 failed | 164 passed (166)
     Tests  2 failed | 958 passed | 1 skipped (961)
```

---

## 3. Audit Findings Inventory (`MH-AUDIT-QA-xxx`)

| Issue ID | Severity | Location | Short Description |
|---|---|---|---|
| `MH-AUDIT-QA-001` | **P1 (High)** | `packages/trace-store/src/index.ts:24-60` | Ephemeral trace logging via `InMemoryTraceStore` causes diagnostic events to evaporate on process exit. |
| `MH-AUDIT-QA-002` | **P1 (High)** | `apps/web/src/` | Zero DOM/Component unit tests or E2E browser tests (Playwright/Cypress) for `apps/web`. |
| `MH-AUDIT-QA-003` | **P1 (High)** | `tests/run-loading-skeleton.test.ts:25` | Fragile UI tests rely on `fs.readFileSync` code string regex matching instead of component rendering. |
| `MH-AUDIT-QA-004` | **P1 (High)** | `vitest.config.ts:12` & `packages/*/package.json` | Package-level `"test"` scripts missing from `packages/*/package.json` and obsolete glob patterns in Vitest config. |
| `MH-AUDIT-QA-005` | **P2 (Medium)** | `tests/execution-core-claude-code-cli.test.ts:110` | Windows file-lock lockouts in integration tests cause test flakiness and rely on global `retry: 1` workaround. |
| `MH-AUDIT-QA-006` | **P2 (Medium)** | `apps/web/src/lib/server/runs/repository.ts:210` | Server error loggers suppress error stack traces when API endpoints fail. |
| `MH-AUDIT-QA-007` | **P2 (Medium)** | `packages/run-store/src/jsonl-event-store.ts:190` | Event store read errors fail silently without emitting diagnostic telemetry events. |
| `MH-AUDIT-QA-008` | **P2 (Medium)** | `tests/decomposer-llm-fallback.test.ts:40` | LLM fallback tests rely on mock responses without negative-control validation. |
| `MH-AUDIT-QA-009` | **P3 (Low)** | `vitest.config.ts:25` | Test execution reporter lacks JUnit / JSON export options for CI test analytics. |

---

## 4. Remediation Plan

1. **Fix Failing UI Tests (`MH-AUDIT-QA-003`)**: Update `cockpit-fixture-view.client.tsx:73` and `run-model-view.client.tsx:132` to replace off-grid spacing classes (`mt-2.5`, `p-5.5`) with standard Tailwind tokens (`mt-2`, `mt-3`, `p-5`, `p-6`).
2. **Implement Durable Trace Store (`MH-AUDIT-QA-001`)**: Create `JsonlTraceStore` in `packages/trace-store` to write trace events to `*.traces.v2.jsonl` files alongside domain event logs.
3. **Add Package Test Scripts (`MH-AUDIT-QA-004`)**: Add `"test": "vitest run"` scripts to all package manifests in `packages/*/package.json`.
