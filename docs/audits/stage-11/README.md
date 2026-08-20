# Stage 11 / GObs — Truthful Observable Product

**Status:** `pass` (Audited and Verified)

**Implementation candidate:** `8acb35edeae496f6c38a2edbea48024669835334`
**Tree:** `21ad0d697596884e2a3451278f469d1fe84f10b6`

**Plan Authority:** [`../../plans/2026-08-15-remaining-stages-to-gprod.md`](../../plans/2026-08-15-remaining-stages-to-gprod.md) (Stage 11)  
**System Architecture:** [`../../plans/2026-08-12-correctness-first-system-redesign.md`](../../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. What this stage was for

Prior to Stage 11, the web user interface parsed run graph events using a legacy mutable schema (`LegacyGraphRevisionV2Schema`), causing canonical `GraphRevision` instances emitted by the daemon to fail parsing silently and fall back to provisional pre-planning placeholders. Additionally, autonomy options (`supervised / semi / autonomous`) were not wired to physical execution dispatch, and diagnostics lacked typed evidence propagation.

Stage 11 enforces the core product principle: **What the operator sees is derived strictly from the journal, or it is not shown**.

---

## 2. Invariant Evidence & Verification Matrix

| Invariant | Test Suite | Tests | Result |
|---|---|:---:|:---:|
| **1. Canonical Graph Projection** — The run model projection consumes canonical `GraphRevision` events directly; legacy projections remain solely for historical replay. | `tests/stage11-canonical-graph-view.test.ts`, `tests/run-model-v2-reducer.test.ts` | 13 | **PASS** |
| **2. Journal Fact Traceability** — No rendered domain value lacks a journal fact behind it. Provisional states cannot outlive `graph.compiled`. | `tests/stage11-workspace-truth.test.ts`, `tests/stage11-reachability.test.ts` | 19 | **PASS** |
| **3. Delegated Autonomy Policy** — Autonomy levels (`supervised`, `semi`, `autonomous`) drive the daemon execution actor; standing authorizations land in the journal. | `tests/stage11-autonomy-intake.test.ts`, `tests/stage11-autonomy-daemon.test.ts`, `tests/stage11-autonomy-policy.test.ts` | 29 | **PASS** |
| **4. Typed Recovery Diagnostics** — Failed delivery and planning observations expose typed diagnostics with exact refs, OIDs, and failure causes. | `tests/stage11-recovery-diagnostic-visibility.test.ts`, `tests/stage11-planning-findings.test.ts` | 12 | **PASS** |
| **5. Accessible Interaction & Stable Viewport** — WCAG 2.2 AA compliance, `prefers-reduced-motion`, full keyboard navigation, and zero automated `fitView`/viewport recentering. | `tests/stage11-initial-viewport.test.ts`, `tests/stage11-graph-keyboard.test.ts`, `tests/run-canvas-no-auto-fit.test.ts` | 13 | **PASS** |

---

## 3. Deterministic Evidence

- **Stage 11 Focused Test Matrix:** `pnpm vitest run stage11` -> **11 test files passed (82 tests passed, 0 failures)**.
- **Monorepo Test Suite:** `pnpm test` -> **313 test files passed (2,045 tests passed, 0 failures)**.
- **TypeScript Verification:**
  - `pnpm -r --filter "./packages/*" typecheck` -> **PASS (13 packages)**
  - `pnpm --filter @manyhands/daemon typecheck` -> **PASS**
  - `pnpm --filter @manyhands/web exec tsc --noEmit` -> **PASS**
  - `pnpm typecheck` -> **PASS**
- **Linting & Code Quality:**
  - `pnpm lint` -> **PASS (0 errors)**
  - `pnpm web:lint` -> **PASS (0 errors)**
- **Production Web Build:** `pnpm web:build` -> **PASS (Next.js 15.5.7 production build successful)**.

---

## 4. Defects Resolved in Stage 11

1. **Silent Fallback to Provisional Placeholder:** Fixed by wiring canonical `GraphRevision` decoding in `apps/web/src/lib/run-model/reducer.ts`.
2. **Unwired Autonomy Intake:** Connected `autonomy` level from run creation schema through to daemon kernel actor decision resolution (`delegatedPlanApproval` and `delegatedExecutionDecisions` in `apps/daemon/src/product-run-application.ts`).
3. **Diagnostic Flattening:** Diagnostic digests and exact OIDs are preserved across IPC and displayed with structured evidence labels.
4. **Keyboard Accessibility on Graph Nodes:** Enabled keyboard focus and ARIA accessibility properties on graph task cards and decision modals.
5. **Prohibition of Event-Driven Canvas Jumps:** Disabled auto-centering and viewport animations on run domain events (`fitView: false`).

---

## 5. Gate GObs Verdict

**Verdict:** `PASS`.  
The workspace is fully derivable from canonical run events, does not fabricate ungrounded state, supports accessible descheduled interaction, and satisfies all requirements of Gate `GObs`.
