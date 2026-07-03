/**
 * golden-behavioral-conflict — two leaves pass locally (no textual conflict), but
 * integration fails on a behavioral conflict (a unit mismatch across a seam whose
 * signature didn't capture the semantics). The conflict is non-auto-resolvable and
 * raises a Decision atomically; the human resolves; the seam's `contract` is amended
 * (revision 2); the producer re-executes; integration passes; conflict resolved.
 * See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-behavioral-conflict";

export const goldenBehavioralConflict = fixture(RUN_ID, [
  // Framing + Proposal
  ev("system", "run.created", { intent: "Snooze de notificaciones por una duración.", workspaceId: "ws-demo", config: demoConfig }),
  ev("system", "run.context.resolved", { repo: "notif-svc", baseCommit: "a0", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Snooze de notificaciones", goal: "Coordinar el snooze.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "n-store", parentId: "root", role: "leaf", title: "SnoozeStore", goal: "snooze(id,duration); isSnoozed(id,at).", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-ui", parentId: "root", role: "leaf", title: "Botón snooze", goal: "Llamar al store.", depth: 1 }),
  ev("system", "plan.seam.proposed", {
    seamId: "seam-store",
    name: "SnoozeStore",
    producerNodeId: "n-store",
    consumerNodeIds: ["n-ui"],
    draftSignature: "snooze(id:string,duration:number):void; isSnoozed(id:string,at:number):boolean"
  }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 3, seamCount: 1, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} }),
  ev("human", "decision.resolved", { decisionId: "d-approve", choice: { action: "approve" }, actor: "human" }),

  // Foundation — seam frozen at revision 1 (signature only; no unit semantics)
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "src/notifications/snoozeStore.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", {
    seamId: "seam-store",
    revision: 1,
    frozenSignature: "snooze(id:string,duration:number):void; isSnoozed(id:string,at:number):boolean",
    extractedFrom: "src/notifications/snoozeStore.ts"
  }),
  ev("system", "scope.derived", { nodeId: "n-store", paths: ["src/notifications/snoozeStore.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-ui", paths: ["src/ui/notificationList.ts"] }),
  ev("system", "wave.planned", { waves: [{ waveId: "w1", index: 0, nodeIds: ["n-store", "n-ui"], unlockedBySeams: ["seam-store"] }] }),
  ev("system", "grounding.completed", { skeletonCommit: "c1" }),

  // Supervision — both pass locally against revision 1
  ev("system", "wave.opened", { waveId: "w1", nodeIds: ["n-store", "n-ui"] }),
  ev("agent", "node.execution.started", { nodeId: "n-store", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-ui", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-store", iteration: 1, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", { nodeId: "n-store", commit: "s1", changedFiles: ["src/notifications/snoozeStore.ts"], builtAgainst: [{ seamId: "seam-store", revision: 1 }], produces: { seamId: "seam-store", revision: 1 } }),
  ev("agent", "node.verify.iteration", { nodeId: "n-ui", iteration: 1, maxIterations: 3, build: "pass", testsPass: 1, testsTotal: 1 }),
  ev("agent", "node.verify.passed", { nodeId: "n-ui", commit: "u1", changedFiles: ["src/ui/notificationList.ts"], builtAgainst: [{ seamId: "seam-store", revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w1" }),

  // Reconciliation — clean merge, but behavioral conflict fails the e2e tests
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["n-store", "n-ui"] }),
  ev("system", "integration.validated", {
    compositeNodeId: "root", testsPass: 9, testsTotal: 11, passed: false,
    builtAgainst: [{ seamId: "seam-store", revision: 1 }], failuresRef: "blob://golden-behavioral-conflict/int/1/fail"
  }),
  ev("system", "conflict.detected", {
    conflictId: "cf-unit",
    dimension: "behavioral",
    status: "detected",
    nodeIds: ["n-store", "n-ui"],
    seamId: "seam-store",
    files: ["src/notifications/snoozeStore.ts", "src/ui/notificationList.ts"],
    autoResolvable: false,
    diagnosisRef: "blob://golden-behavioral-conflict/conflict/cf-unit/diag"
  }),
  // Atomic gate immediately after the non-auto-resolvable conflict
  ev("system", "decision.raised", { decisionId: "d-conflict", kind: "resolve_conflict", blocking: true, context: { conflictId: "cf-unit" } }),
  ev("human", "decision.resolved", { decisionId: "d-conflict", choice: { resolutionId: "canonical-ms-fix-store" }, actor: "human" }),

  // The seam's CONTRACT is amended (semantics pinned), revision 2
  ev("system", "seam.amended", { seamId: "seam-store", revision: 2, changeKind: "contract", contract: { "duration.unit": "ms" } }),

  // Re-execute the affected producer against revision 2
  ev("agent", "node.execution.started", { nodeId: "n-store", agent: "gemini", model: "gemini-2.5-flash", reason: "amendment:seam-store" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-store", iteration: 1, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", { nodeId: "n-store", commit: "s2", changedFiles: ["src/notifications/snoozeStore.ts"], builtAgainst: [{ seamId: "seam-store", revision: 2 }], produces: { seamId: "seam-store", revision: 2 } }),

  // Re-integration passes; conflict resolved
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["n-store", "n-ui"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 11, testsTotal: 11, passed: true, builtAgainst: [{ seamId: "seam-store", revision: 2 }] }),
  ev("system", "conflict.resolved", { conflictId: "cf-unit", by: "human", resolutionId: "canonical-ms-fix-store" }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "r1", status: "success" }),

  // Disposition
  ev("system", "run.evidence.ready", {
    aggregateDiffRef: "blob://golden-behavioral-conflict/diff",
    tests: { pass: 11, total: 11 },
    narrativeRef: "blob://golden-behavioral-conflict/narrative",
    integrationCommit: "r1"
  }),
  ev("system", "run.completed", { status: "success" })
]);
