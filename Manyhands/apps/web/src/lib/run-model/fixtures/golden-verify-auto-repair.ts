/**
 * golden-verify-auto-repair — a leaf fails build, the system repairs autonomously,
 * and it passes on a later iteration. Proves that the reversible/verifiable loop
 * does NOT bother the human: this fixture contains NO `decision.raised` and NO
 * `conflict.detected`. It focuses on the verify-loop, so it skips the approval gate.
 * See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-verify-auto-repair";

export const goldenVerifyAutoRepair = fixture(RUN_ID, [
  ev("system", "run.created", {
    intent: "Agregar un validador de email.",
    workspaceId: "ws-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "validators-app", baseCommit: "c0", readiness: "ok" }),

  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Validador de email", goal: "Validar emails.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "n-email", parentId: "root", role: "leaf", title: "isValidEmail", goal: "Implementar y testear.", depth: 1 }),

  // Foundation (minimal, no seam)
  ev("system", "grounding.started", {}),
  ev("system", "scope.derived", { nodeId: "n-email", paths: ["src/validators/email.ts"] }),
  ev("system", "wave.planned", { waves: [{ waveId: "w1", index: 0, nodeIds: ["n-email"], unlockedBySeams: [] }] }),
  ev("system", "grounding.completed", { skeletonCommit: "c1" }),

  // Supervision — the verify-loop fails, repairs, then passes
  ev("system", "wave.opened", { waveId: "w1", nodeIds: ["n-email"] }),
  ev("agent", "node.execution.started", { nodeId: "n-email", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-email", iteration: 1, maxIterations: 3, build: "fail", testsPass: 0, testsTotal: 2 }),
  ev("agent", "node.verify.failed", { nodeId: "n-email", iteration: 1, cause: "TS2345: type mismatch" }),
  ev("agent", "node.repair.started", { nodeId: "n-email", reason: "build error" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-email", iteration: 2, maxIterations: 3, build: "pass", testsPass: 1, testsTotal: 2 }),
  ev("agent", "node.verify.iteration", { nodeId: "n-email", iteration: 3, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", { nodeId: "n-email", commit: "e1", changedFiles: ["src/validators/email.ts"], builtAgainst: [] })
]);
