# Stage 12 / GArch — Architecture Closure

**Status:** `pass` (Audited and Verified)

**Implementation candidate:** `8acb35edeae496f6c38a2edbea48024669835334`
**Tree:** `21ad0d697596884e2a3451278f469d1fe84f10b6`

**Plan Authority:** [`../../plans/2026-08-15-remaining-stages-to-gprod.md`](../../plans/2026-08-15-remaining-stages-to-gprod.md) (Stage 12)  
**System Architecture:** [`../../plans/2026-08-12-correctness-first-system-redesign.md`](../../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. What this stage was for

Stage 12 formalizes the architecture boundary of ManyHands by establishing **one single authority per domain invariant**, enforced mechanically via automated tests and continuous typechecking rather than by documentation or convention.

---

## 2. Invariant Ownership & Verification Matrix

| Domain Invariant | Canonical Owning Module | Mechanical Verifying Test | Status |
|---|---|---|:---:|
| **1. Goal & Change Contracts** | `@manyhands/contracts` | `tests/canonical-contract-roundtrip.test.ts`, `tests/contracts-v2.test.ts` | **PASS** |
| **2. Immutable Graph & Ownership** | `@manyhands/task-graph` (`canonical-graph.ts`) | `tests/canonical-graph-invariants.test.ts`, `tests/canonical-resource-claims.test.ts` | **PASS** |
| **3. Grounded Plan Compilation** | `@manyhands/decomposer` (`direct-plan-compiler.ts`) | `tests/stage5-direct-compiler.test.ts`, `tests/stage5-planning-contracts.test.ts` | **PASS** |
| **4. Exact Artifact Materialization** | `@manyhands/execution-core` (`exact-manifest-materializer.ts`) | `tests/stage7-exact-artifact-materialization.test.ts`, `tests/stage7-ga-artifact-evidence.test.ts` | **PASS** |
| **5. Read-Ready Frontier Scheduling** | `@manyhands/scheduler` (`canonical-frontier.ts`) | `tests/stage6-canonical-frontier.test.ts`, `tests/scheduler-readiness-v2.test.ts` | **PASS** |
| **6. Atomic Delivery Ref Update** | `@manyhands/execution-core` (`delivery/publisher.ts`) | `tests/stage10-delivery-boundary.test.ts`, `tests/stage10-clean-clone-reproduction.test.ts` | **PASS** |
| **7. Fenced Actor Journaling** | `@manyhands/run-engine`, `@manyhands/run-store` | `tests/daemon-kernel.test.ts`, `tests/run-engine-actor.test.ts`, `tests/run-store-fencing.test.ts` | **PASS** |
| **8. Workspace Dependency Enclosure** | `@manyhands/contracts` / Monorepo root | `tests/canonical-dependency-boundaries.test.ts` | **PASS** |

---

## 3. Package Dependency Boundary Enforcement

Dependency rules (`apps -> specific packages -> shared`, zero dependencies on legacy `@manyhands/core`) are enforced mechanically across all 13 packages and 2 apps via `tests/canonical-dependency-boundaries.test.ts`:
- No package depends on `@manyhands/core`.
- Contracts are strictly browser-safe and independent of Node runtime APIs.
- The web app and daemon consume domain packages exclusively through versioned domain contracts and IPC channels.

---

## 4. Deterministic Verification Evidence

- **Monorepo Global Typecheck:** `pnpm typecheck` -> **PASS (0 errors across `packages/`, `apps/` and `tests/`)**.
- **Package Typechecks:** `pnpm -r --filter "./packages/*" typecheck` -> **PASS (13 packages green)**.
- **Daemon Typecheck:** `pnpm --filter @manyhands/daemon typecheck` -> **PASS**.
- **Web Typecheck:** `pnpm --filter @manyhands/web exec tsc --noEmit` -> **PASS**.
- **Linters:** `pnpm lint` & `pnpm web:lint` -> **PASS (0 warnings, 0 errors)**.
- **Test Suite:** `pnpm test` -> **PASS (313 test files, 2,045 tests passing)**.
- **Production Web Build:** `pnpm web:build` -> **PASS**.

---

## 5. Gate GArch Verdict

**Verdict:** `PASS`.  
The architecture is fully closed with mechanical invariant enforcement, clean package boundaries, single ownership per invariant, and complete green verification.
