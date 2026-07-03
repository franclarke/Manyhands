/**
 * golden-planning-fallback — graph-generation ROBUSTNESS made observable (PR-N1).
 *
 * The recursive decomposer can hit recoverable step errors (timeout, "No JSON
 * object", invalid schema). It retries with bounded backoff and — opt-in, D3-safe —
 * may materialize a non-root step as a fallback atomic leaf. The engine already
 * emits this telemetry (`planning.node.status` / `RecursiveStepPlanningState`); this
 * fixture exercises the agent-first model carrying it via `plan.node.status`:
 *   - `n-parse` retries once (missing_json) then recovers (generated) → clean.
 *   - `n-eval` falls back after exhausting attempts (schema_invalid) → degraded but
 *     still a usable proposed leaf (planning is ORTHOGONAL to execution).
 * Planning retries/fallback are AUTONOMOUS — they never enter the decision channel.
 * The plan still completes and raises the approve_plan gate. No execution.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-planning-fallback";

export const goldenPlanningFallback = fixture(RUN_ID, [
  ev("system", "run.created", {
    intent: "Implementar una calculadora de expresiones.",
    workspaceId: "ws-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "expr-calc", baseCommit: "b0", readiness: "ok" }),

  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Calculadora", goal: "Coordinar el pipeline.", depth: 0 }),

  // n-parse: a recoverable planning error, then recovery.
  ev("system", "plan.node.proposed", { nodeId: "n-parse", parentId: "root", role: "leaf", title: "Parser", goal: "Parsear a AST.", depth: 1 }),
  ev("system", "plan.node.status", {
    nodeId: "n-parse",
    state: "retrying",
    attempt: 1,
    maxAttempts: 3,
    durationMs: 1200,
    errorKind: "missing_json",
    errorMessage: "No JSON object found in response"
  }),
  ev("system", "plan.node.status", { nodeId: "n-parse", state: "generated", attempt: 2, durationMs: 900 }),

  // n-eval: exhausts attempts → fallback atomic leaf (degraded, still usable).
  ev("system", "plan.node.proposed", { nodeId: "n-eval", parentId: "root", role: "leaf", title: "Evaluador", goal: "Evaluar el AST.", depth: 1 }),
  ev("system", "plan.node.status", {
    nodeId: "n-eval",
    state: "fallback",
    attempt: 3,
    maxAttempts: 3,
    durationMs: 4200,
    errorKind: "schema_invalid",
    errorMessage: "No parsed JSON candidate matched the step schema"
  }),

  ev("system", "plan.ready", { rootId: "root", nodeCount: 3, seamCount: 0, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} })
]);
