# ManyHands Web UI & API Audit Report

**Auditor Role:** `teamwork_preview_explorer` (API, SSE & Web UI Specialist)  
**Target:** `apps/web` (Next.js App Router, Server-Sent Events, React Flow canvas, Decision Queue, API routes)  
**Date:** July 21, 2026  

---

## 1. Executive Summary

A comprehensive audit of `apps/web` and all backend API endpoints was conducted to evaluate compliance with product design rules (`AGENTS.md`, `docs/design/interaction-model.md`, `docs/system/`), API security best practices, Server-Sent Events (SSE) lifecycle robustness, state synchronization, and React Flow viewport invariants.

### Key Audit Findings Overview
- **Canvas Viewport Governance:** The React Flow canvas accurately preserves pan and zoom levels across state updates, status changes, lens switches, and node selections. Automatic `fitView` is strictly bound to the `AutoFitSwitch` mode and structural graph topology changes (`graphStructureKey`).
- **Decision Queue & Non-blocked Execution:** The scheduler (`packages/scheduler/src/readiness-v2.ts`) and run coordinator correctly restrict decision blocking to the precise node IDs listed in `decision.affectedNodeIds`. Parallel execution branches continue running without interruption. However, a client-side inspector UI state drift bug (`MH-AUDIT-API-012`) prevents direct resolution when clicking decision-pending nodes on the canvas.
- **SSE Connection & Memory Management:** Critical issues were identified in SSE streaming (`/api/runs/[id]/run-events`). The server polling loop ignores client `AbortSignal`, creating zombie polling loops and unclosed file handles (`MH-AUDIT-API-001`). The client hook (`useLiveRunModel`) lacks event buffer memory caps, causing unbounded array accumulation and expensive $O(N^2)$ event fold recalculations on every incoming message (`MH-AUDIT-API-002`).
- **API Security:** All 17 API endpoints lack authentication, authorization, CSRF validation, and CORS restrictions, posing critical risk if exposed locally or on a shared network (`MH-AUDIT-API-006`, `MH-AUDIT-API-007`). Additionally, `POST /api/local-fs/pick-folder` allows unauthenticated callers to spawn native OS file picker GUI windows (`MH-AUDIT-API-008`).

---

## 2. Comprehensive Findings Matrix

| Finding ID | Severity | Category | File Path & Lines | Brief Description |
|---|---|---|---|---|
| `MH-AUDIT-API-001` | **High** | SSE Streaming | `apps/web/src/app/api/runs/[id]/run-events/route.ts:36-63` | SSE server pump loop ignores `request.signal`, leaking background disk I/O and timers on client disconnect. |
| `MH-AUDIT-API-002` | **High** | SSE / Memory | `apps/web/src/components/run-model/use-live-run-model.ts:34, 66-67, 90` | Unbounded SSE event buffer growth & $O(N^2)$ full model refolding per event causes main thread freeze. |
| `MH-AUDIT-API-003` | **Medium** | SSE / Reconnect | `apps/web/src/components/run-model/use-live-run-model.ts:88` | Re-creation of `initialEvents` array reference tears down SSE and causes duplicate event insertion in `buffer.current`. |
| `MH-AUDIT-API-004` | **Medium** | SSE / Protocol | `apps/web/src/components/run-model/use-live-run-model.ts:49` | Manual reconnect logic bypasses native browser `Last-Event-ID` header resume mechanics. |
| `MH-AUDIT-API-005` | **Low** | SSE / Liveness | `apps/web/src/app/api/runs/[id]/run-events/route.ts:47`, `use-live-run-model.ts:50` | Heartbeats emitted as SSE comments lack client-side timeout/liveness monitoring. |
| `MH-AUDIT-API-006` | **Critical** | API Security | `apps/web/src/app/api/**/route.ts` | Complete absence of authentication & authorization on all 17 API endpoints. |
| `MH-AUDIT-API-007` | **High** | API Security | `apps/web/src/app/api/**/route.ts` | No CSRF protection or Origin validation on mutating POST/PATCH/DELETE routes. |
| `MH-AUDIT-API-008` | **High** | API Security | `apps/web/src/app/api/local-fs/pick-folder/route.ts:8-18` | Unauthenticated endpoint triggers native server OS file dialog windows (DoS risk). |
| `MH-AUDIT-API-009` | **Medium** | API Security | `apps/web/src/app/api/workspaces/route.ts:22-35`, `workspaces/[id]/route.ts:29-43` | Raw payload passing without Zod schema validation on workspace creation and update. |
| `MH-AUDIT-API-010` | **Medium** | API Delivery | `apps/web/src/app/api/runs/[id]/deliver/route.ts:23-32` | Idempotency keys are received but not checked/enforced to prevent duplicate delivery requests. |
| `MH-AUDIT-API-011` | **Low** | Canvas UI | `apps/web/src/components/run-model/minimal-run-graph.tsx:99` | Hardcoded initial viewport center coordinates `(115, 330)` cause initial misalignment on non-standard viewports. |
| `MH-AUDIT-API-012` | **Medium** | Decision UI | `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:73-84, 172-178` | Selecting a node with pending decisions directly on the canvas does not activate `DecisionDetails` in inspector. |
| `MH-AUDIT-API-013` | **Medium** | Decision UI | `apps/web/src/components/run-model/minimal-run-graph.tsx:205-248` | Task nodes render only small decision badge text instead of contextual decision cards directly on the canvas. |
| `MH-AUDIT-API-014` | **Low** | Decision UI | `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:252-258` | Hardcoded string prefix stripping for decision reasons breaks if backend question format changes. |
| `MH-AUDIT-API-015` | **Medium** | State Sync | `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:48-65` | In-flight action race condition and persistent error banner after successful SSE state updates. |
| `MH-AUDIT-API-016` | **Low** | Accessibility | `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:148, 169` | `aside` element retains `aria-hidden="true"` while containing focusable child elements when collapsed. |

---

## 3. Detailed Audit Findings

### 3.1 Server-Sent Events (SSE) & Connection Lifecycle

#### `MH-AUDIT-API-001` (Severity: High)
- **File Path:** `apps/web/src/app/api/runs/[id]/run-events/route.ts:36-63`
- **Observation:** In the SSE handler `GET /api/runs/[id]/run-events`, a ReadableStream is created with a `pump()` async loop that executes `while (!cancelled)` and sleeps for `POLL_MS` (250 ms).
- **Logic Chain:**
  1. The handler never registers an `abort` listener on `request.signal`.
  2. In Node.js App Router, when a client closes a tab or drops the SSE connection, `stream.cancel()` is not guaranteed to fire immediately if enqueue backpressure checks do not fail.
  3. Because `request.signal.aborted` is not polled in `while (!cancelled)`, the `pump()` loop continues running indefinitely in the background, executing `store.load(id)` every 250ms and consuming CPU and disk read operations.
- **Recommendation:** Bind `request.signal.addEventListener("abort", () => { cancelled = true; })` and check `request.signal.aborted` inside `pump()`.

#### `MH-AUDIT-API-002` (Severity: High)
- **File Path:** `apps/web/src/components/run-model/use-live-run-model.ts:34, 66-67, 90`
- **Observation:** Incoming events are pushed directly to `buffer.current` (`buffer.current = [...buffer.current, event]`), setting `streamEvents` state on every message. Line 90 calls `useMemo(() => buildLiveRunModel(streamEvents, seed, initialEvents), [streamEvents, ...])`.
- **Logic Chain:**
  1. `buffer.current` has no maximum event limit. Over long execution runs (e.g. 5,000+ events), memory usage grows continuously.
  2. `buildRunModel` parses all historical events from event 0 to event $N$ using `uniqueOrderedEvents` and `foldProjection`.
  3. Processing $N$ events for every single incoming event results in $O(N^2)$ CPU overhead, causing severe main thread UI freezes and jank on high-frequency SSE streaming.
- **Recommendation:** Implement an incremental event reducer or sliding event window, memoizing projection states to avoid re-folding the entire event timeline on every tick.

#### `MH-AUDIT-API-003` (Severity: Medium)
- **File Path:** `apps/web/src/components/run-model/use-live-run-model.ts:88`
- **Observation:** `useEffect` in `useLiveRunModel` lists `initialEvents` as a dependency: `[disabled, initialCursor, initialEvents, seed.id]`.
- **Logic Chain:**
  1. If a parent component re-renders and passes a newly instantiated `initialEvents` array reference, `useEffect` triggers cleanup (closing existing `EventSource`) and re-executes `connect()`.
  2. Inside `useEffect`, `lastSeen` is reset to `initialCursor` (e.g. 0), but `buffer.current` (stored in `useRef`) retains previous events.
  3. The new `EventSource` queries `/api/runs/.../run-events?afterSeq=0`. Since `seen` set is re-created from `initialEvents`, incoming stream events already present in `buffer.current` pass the `seen.has()` check and get appended again to `buffer.current`, producing duplicate events and broken sequence indexes.
- **Recommendation:** Standardize `initialEvents` tracking via stable event IDs or ref references, or reset `buffer.current` when sequence base changes.

---

### 3.2 API Security: Authentication, CSRF/CORS, Input Validation

#### `MH-AUDIT-API-006` (Severity: Critical)
- **File Path:** All routes under `apps/web/src/app/api/`
- **Observation:** Zero authentication or authorization middleware or checks exist on any API endpoint (`/api/runs`, `/api/runs/[id]/cancel`, `/api/runs/[id]/deliver`, `/api/workspaces`, `/api/local-fs/pick-folder`).
- **Logic Chain:**
  1. Any network client capable of reaching `apps/web` can make HTTP requests to list, modify, cancel, or delete runs and workspaces.
  2. Destructive routes like `DELETE /api/workspaces/[id]` or `POST /api/runs/[id]/deliver` execute git operations and filesystem modifications without verifying operator identity.
- **Recommendation:** Introduce authentication middleware (e.g. session tokens, API keys, or localhost origin binding) for all API routes.

#### `MH-AUDIT-API-007` (Severity: High)
- **File Path:** All `POST`, `PATCH`, `DELETE` routes under `apps/web/src/app/api/`
- **Observation:** No API routes validate CSRF tokens, `Origin` headers, or `Sec-Fetch-Site` headers.
- **Logic Chain:**
  1. If a developer runs ManyHands locally (`localhost:3000`) and visits a malicious external site, the malicious site can trigger cross-origin POST requests to `/api/runs/[id]/deliver` or `/api/workspaces/[id]`.
  2. Because browser cross-origin requests do not block simple POST payloads by default, dangerous server actions can be executed remotely.
- **Recommendation:** Validate `Origin` and `Host` headers on mutating requests, or require custom CSRF/session header validation (e.g., `X-Requested-With` or `X-ManyHands-Session`).

#### `MH-AUDIT-API-008` (Severity: High)
- **File Path:** `apps/web/src/app/api/local-fs/pick-folder/route.ts:8-18`
- **Observation:** `POST /api/local-fs/pick-folder` calls `pickFolderNative()` on the host machine.
- **Logic Chain:**
  1. The route accepts POST requests without authentication or origin checks.
  2. Calling `pickFolderNative()` triggers a native OS folder picker dialog GUI on the host machine.
  3. Repeated requests from external web pages or local network actors can spawn multiple dialog windows, freezing the host GUI and causing Denial of Service.
- **Recommendation:** Restrict `pick-folder` access to local desktop IPC bindings or enforce strict local origin authentication.

---

### 3.3 React Flow Canvas & Viewport Invariants

#### `MH-AUDIT-API-011` (Severity: Low)
- **File Path:** `apps/web/src/components/run-model/minimal-run-graph.tsx:99`
- **Observation:** Initial viewport setup uses `flow.setCenter(115, 330, { zoom: 0.85 })`.
- **Logic Chain:**
  1. Coordinates `(115, 330)` are hardcoded static numbers.
  2. On narrow screens or high-DPI displays, graph nodes may appear off-center or partially clipped upon initial load until the user manually pans or toggles `Autoencuadre`.
- **Recommendation:** Use container-relative initial placement or trigger a single initial `fitView({ padding: 0.2 })` measurement on mount.

---

### 3.4 Decision Queue UI & Scope Blocking

#### `MH-AUDIT-API-012` (Severity: Medium)
- **File Path:** `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:73-84, 172-178`
- **Observation:** Clicking a node on the canvas calls `selectNode(nodeId)`, which updates `selectedNodeId` but leaves `decisionId` as `null`.
- **Logic Chain:**
  1. In `run-model-view.client.tsx`, `activeDecision` is derived only when `decisionId` is explicitly set (`pendingDecisions.find(d => d.id === decisionId)`).
  2. When a node requiring a decision is selected via canvas click, `activeDecision` remains `null`.
  3. The inspector renders `NodeDetails` instead of `DecisionDetails`, hiding the decision prompt and option buttons. The operator is forced to locate and click "Revisar" in the top decision banner.
- **Recommendation:** In `selectNode(nodeId)`, if `nodeId` is in `pendingDecisions.affectedNodeIds`, automatically set `decisionId` to match that node's active decision.

#### `MH-AUDIT-API-013` (Severity: Medium)
- **File Path:** `apps/web/src/components/run-model/minimal-run-graph.tsx:205-248`
- **Observation:** Nodes needing human decisions display only text count badges: `1 decisión`.
- **Logic Chain:**
  1. `AGENTS.md` and `docs/design/interaction-model.md` specify: *"Decisions use contextual card + accessible dialog + global queue."*
  2. Nodes currently render a generic text badge rather than a contextual decision card or prominent warning treatment directly on the node component.
- **Recommendation:** Enhance `TaskCard` node rendering to display a prominent contextual decision callout badge when `node.decisionCount > 0`.

---

### 3.5 Client State Drift & Action Race Conditions

#### `MH-AUDIT-API-015` (Severity: Medium)
- **File Path:** `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:48-65`
- **Observation:** `command(path, body)` manages `busyAction` and `error` state.
- **Logic Chain:**
  1. If an API request fails, `setError(message)` displays a sticky red error banner.
  2. Subsequent SSE events updating run lifecycle (e.g. from `waiting_for_input` to `running`) do not clear `error`. The error alert remains visible until manually dismissed by clicking `X`.
  3. Rapid consecutive button clicks overwrite `busyAction` without aborting previous in-flight fetches.
- **Recommendation:** Clear stale UI error banners upon successful SSE lifecycle transitions and use `AbortController` for in-flight command fetches.

---

## 4. Verification Methods & Commands

To independently verify these findings:

1. **Verify Canvas Viewport Rule Compliance:**
   ```bash
   pnpm test tests/run-canvas-no-auto-fit.test.ts
   ```
2. **Verify Type Consistency:**
   ```bash
   pnpm --filter @manyhands/web exec tsc --noEmit
   ```
3. **Inspect SSE Route & Hook Implementation:**
   - Server SSE Route: `apps/web/src/app/api/runs/[id]/run-events/route.ts`
   - Client SSE Hook: `apps/web/src/components/run-model/use-live-run-model.ts`
4. **Inspect Decision Queue & Inspector Integration:**
   - Component: `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx`
