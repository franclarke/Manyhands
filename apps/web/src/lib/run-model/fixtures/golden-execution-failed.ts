/**
 * golden-execution-failed — a leaf that fails TERMINALLY after exhausting its
 * autonomous verify/repair budget. One sibling passes; the other reaches
 * `node.execution.failed` (terminal), so the run completes with status "failed"
 * and never reaches Disposition (no evidence). Exercises the `failed` display path
 * (H4): autonomous repair stays out of the human's way, and the terminal failure
 * surfaces as health "failing" — never as "done", "obsolete" or human attention.
 * See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-execution-failed";

export const goldenExecutionFailed = fixture(RUN_ID, [
  // Framing + Proposal
  ev("system", "run.created", { intent: "Importar contactos desde un CSV.", workspaceId: "ws-demo", config: demoConfig }),
  ev("system", "run.context.resolved", { repo: "contacts-app", baseCommit: "a0", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Importar contactos", goal: "Coordinar la importación.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "n-parse", parentId: "root", role: "leaf", title: "Parser CSV", goal: "Parsear el archivo.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-validate", parentId: "root", role: "leaf", title: "Validador", goal: "Validar filas.", depth: 1 }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 3, seamCount: 0, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} }),
  ev("human", "decision.resolved", { decisionId: "d-approve", choice: { action: "approve" }, actor: "human" }),

  // Foundation
  ev("system", "grounding.started", {}),
  ev("system", "scope.derived", { nodeId: "n-parse", paths: ["src/import/parse.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-validate", paths: ["src/import/validate.ts"] }),
  ev("system", "wave.planned", { waves: [{ waveId: "w1", index: 0, nodeIds: ["n-parse", "n-validate"], unlockedBySeams: [] }] }),
  ev("system", "grounding.completed", { skeletonCommit: "c1" }),

  // Supervision — one leaf passes; the other exhausts its autonomous repair budget
  ev("system", "wave.opened", { waveId: "w1", nodeIds: ["n-parse", "n-validate"] }),
  ev("agent", "node.execution.started", { nodeId: "n-parse", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-validate", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-parse", iteration: 1, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", { nodeId: "n-parse", commit: "p1", changedFiles: ["src/import/parse.ts"], builtAgainst: [] }),

  // n-validate: build fails, autonomous repair runs (no human attention), still fails
  ev("agent", "node.verify.iteration", { nodeId: "n-validate", iteration: 1, maxIterations: 3, build: "fail", testsPass: 0, testsTotal: 4 }),
  ev("agent", "node.verify.failed", { nodeId: "n-validate", iteration: 1, cause: "build broken: unresolved import" }),
  ev("agent", "node.repair.started", { nodeId: "n-validate", reason: "verify failed (1/3)" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-validate", iteration: 2, maxIterations: 3, build: "fail", testsPass: 0, testsTotal: 4 }),
  ev("agent", "node.verify.failed", { nodeId: "n-validate", iteration: 2, cause: "build still broken after repair" }),
  ev("agent", "node.repair.started", { nodeId: "n-validate", reason: "verify failed (2/3)" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-validate", iteration: 3, maxIterations: 3, build: "fail", testsPass: 0, testsTotal: 4 }),
  ev("agent", "node.execution.failed", { nodeId: "n-validate", cause: "repair budget exhausted (3/3): build never recovered" }),

  // The run fails: no integration, no evidence (never reaches Disposition).
  ev("system", "run.completed", { status: "failed" })
]);
