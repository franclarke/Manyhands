# Stage 11 / Gate GObs — Bounded Independent Review

**Reviewer:** Independent Gate Reviewer Agent (`37c9e732-481c-4103-bde7-11fe8723a484`)  
**Date:** 2026-08-17  
**Candidate:** `8acb35edeae496f6c38a2edbea48024669835334`  
**Tree:** `21ad0d697596884e2a3451278f469d1fe84f10b6`  
**Plan Authority:** `docs/plans/2026-08-15-remaining-stages-to-gprod.md` (Stage 11) & `docs/plans/2026-08-12-correctness-first-system-redesign.md`  

---

## 1. Scope and Purpose

Independent verification of Gate `GObs` (Truthful Observable Product). The review evaluates whether the web product projection derives exclusively from canonical journal facts without fabricating ungrounded domain state, wires delegated autonomy through the daemon kernel, exposes typed diagnostics, and satisfies WCAG 2.2 AA accessibility without event-driven canvas recentering.

---

## 2. Assessment of GObs Invariants

### Invariant 1: Canonical Graph Projection
- **Finding:** `apps/web/src/lib/run-model/reducer.ts` decodes `canonicalGraphView` using `GraphRevisionSchema` from `@manyhands/task-graph`, eliminating the silent fallback to pre-planning placeholders. `apps/web/src/lib/run-model/graph-view.ts` accurately projects nodes, artifact requirements, and seam bindings.
- **Verification:** `tests/stage11-canonical-graph-view.test.ts` and `tests/run-model-v2-reducer.test.ts` pass.
- **Status:** **PASS**.

### Invariant 2: Journal Fact Traceability
- **Finding:** `objectiveHeadline` and counters render only from verified journal events. The mechanical audit guard in `tests/stage11-reachability.test.ts` checks $\ge 20$ rendered values against raw journal JSON with 0 unreachable properties, and rejects manufactured nodes.
- **Verification:** `tests/stage11-reachability.test.ts` and `tests/stage11-workspace-truth.test.ts` pass.
- **Status:** **PASS**.

### Invariant 3: Typed Diagnostics
- **Finding:** `DeliveryRecoveryError` and planning observation rejections preserve structured diagnostic digests, refs, and exact OIDs across IPC and render them in dedicated, labeled fields.
- **Verification:** `tests/stage11-recovery-diagnostic-visibility.test.ts` and `tests/stage11-planning-findings.test.ts` pass.
- **Status:** **PASS**.

### Invariant 4: Historical Replay
- **Finding:** Upcasting schemas and idempotent event reduction allow historical journals (e.g. `golden-password-recovery`) and reconnecting SSE streams to fold without data loss or exceptions.
- **Verification:** `tests/run-model-v2-fixture.test.ts` and `tests/run-events-replay.test.ts` pass.
- **Status:** **PASS**.

### Invariant 5: Accessible Workspace & Viewport Invariance
- **Finding:** Graph nodes and decision dialogs support keyboard navigation (`Enter`/`Space`), ARIA accessible names, and WCAG 2.2 AA contrast. Static source audit confirms 0 automated canvas motion calls (`fitView: false`).
- **Verification:** `tests/stage11-initial-viewport.test.ts`, `tests/stage11-graph-keyboard.test.ts`, and `tests/run-canvas-no-auto-fit.test.ts` pass.
- **Status:** **PASS**.

---

## 3. Delegated Autonomy Verification

- **Intake:** `POST /api/runs` validates `autonomy` with `AutonomyLevelSchema` and persists it into the durable definition (`tests/stage11-autonomy-intake.test.ts`).
- **Policy:** Pure evaluation approves plans and bounded retries in `semi`/`autonomous` while restricting publication exclusively to `autonomous` (`tests/stage11-autonomy-policy.test.ts`).
- **Execution:** Daemon actor resolves delegated decisions with standing authorizations stamped in the journal (`tests/stage11-autonomy-daemon.test.ts`).
- **Disclosure:** UI clearly distinguishes human vs delegated authorizations (`tests/stage11-autonomy-disclosure.test.ts`).

---

## 4. Formal Gate Verdict

**Verdict:** **GO**  
Gate **GObs** is formally **PASSED**. The candidate is approved for entry into Stage 12 (GArch).
