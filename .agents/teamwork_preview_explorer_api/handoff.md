# Handoff Report — Web UI & API Audit

## 1. Observation
- **React Flow Canvas:** Inspecting `apps/web/src/components/run-model/minimal-run-graph.tsx:107-111`, `autoFit` uses `graphStructureKey = JSON.stringify(model.nodes.map(n => n.id))`. Viewport recentering/`fitView` only fires on structural changes when `autoFit` is active. Standard node selection, lens switching, or status pulses preserve user pan and zoom.
- **Decision Queue Scope:** In `packages/scheduler/src/readiness-v2.ts:18`, `explainReadiness` pushes `unresolved_decision` only if `decision.affectedNodeIds.includes(input.nodeId)`. Unaffected nodes remain ready/running.
- **Decision Queue Canvas Selection Drift:** In `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:73-84, 172-178`, calling `selectNode(nodeId)` from a graph node click updates `selectedNodeId` but leaves `decisionId` as `null`. As a result, the inspector displays `NodeDetails` instead of `DecisionDetails`.
- **SSE Connection & Memory Leak:** In `apps/web/src/app/api/runs/[id]/run-events/route.ts:36-63`, the SSE pump loop does not listen to `request.signal` aborts. In `apps/web/src/components/run-model/use-live-run-model.ts:34, 66-67, 90`, `buffer.current` grows without bound and calls `buildRunModel` (re-folding all historical events from event 0) on every single incoming SSE event.
- **API Security:** All 17 routes under `apps/web/src/app/api/**/route.ts` lack authentication, authorization, CSRF token checks, or origin validation. `POST /api/local-fs/pick-folder` executes `pickFolderNative()` on the host OS without authentication.

## 2. Logic Chain
1. *Observation:* Canvas `useEffect` relies on `graphStructureKey` which tracks node IDs (`model.nodes.map(n => n.id)`).
   *Reasoning:* Non-structural events (status updates, attempt progress, selection, lens toggle) do not change `graphStructureKey`, guaranteeing that user pan/zoom is preserved.
2. *Observation:* Scheduler checks `decision.affectedNodeIds.includes(input.nodeId)`.
   *Reasoning:* Non-affected subtrees retain their readiness state, ensuring parallel execution continues while a decision is pending.
3. *Observation:* Selecting a node on the canvas sets `selectedNodeId` but leaves `decisionId = null`.
   *Reasoning:* `activeDecision` is evaluated as `null`, causing the inspector to show `NodeDetails` rather than `DecisionDetails`. User cannot resolve the decision by selecting the node on the graph.
4. *Observation:* Server SSE loop `while (!cancelled)` ignores `request.signal.aborted`.
   *Reasoning:* Disconnected clients leave active background loops reading disk every 250ms indefinitely.
5. *Observation:* `useLiveRunModel` appends to `buffer.current` without size caps and calls full event refolding per message.
   *Reasoning:* On long runs, memory usage grows continuously, and $O(N^2)$ event processing causes main thread UI jank.
6. *Observation:* API handlers receive requests directly without session/token or origin checks.
   *Reasoning:* Any local network actor or cross-origin web page (via CSRF) can execute run operations or delete workspaces.

## 3. Caveats
- Audit was strictly read-only; code changes were proposed in `report.md` but not implemented in the codebase.
- Dynamic runtime testing of SSE disconnects across multi-tab browsers was verified via static code analysis of Node.js `ReadableStream` behavior in App Router.

## 4. Conclusion
The core canvas viewport stability and decision queue scope isolation rules meet `AGENTS.md` and `docs/design/` specifications. However, critical vulnerabilities exist in API security (missing auth/CSRF), SSE memory & handle leaks (unbounded event buffer, unhandled request aborts), and UI state synchronization (decision inspector desynchronization when selecting canvas nodes). Findings are cataloged with IDs `MH-AUDIT-API-001` through `MH-AUDIT-API-016` in `report.md`.

## 5. Verification Method
1. Verify canvas tests: `pnpm test tests/run-canvas-no-auto-fit.test.ts`
2. Verify TypeScript build types: `pnpm --filter @manyhands/web exec tsc --noEmit`
3. Inspect `report.md` at `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_api\report.md`.
