/**
 * golden-happy-path — successful run, no conflict. Exercises the six phases:
 * Framing → Proposal → Foundation → Supervision → Reconciliation → Disposition.
 * See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-happy-path";

export const goldenHappyPath = fixture(RUN_ID, [
  // Framing
  ev("system", "run.created", {
    intent: "Mostrar un contador con incrementar/decrementar y persistencia local.",
    workspaceId: "ws-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "counter-app", baseCommit: "a0", readiness: "ok" }),

  // Proposal
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Contador", goal: "Coordinar el contador.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "n-store", parentId: "root", role: "leaf", title: "CounterStore", goal: "Estado + persistencia.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-ui", parentId: "root", role: "leaf", title: "UI del contador", goal: "Render + botones.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-logic", parentId: "root", role: "leaf", title: "Lógica de incremento", goal: "inc/dec/reset.", depth: 1 }),
  ev("system", "plan.seam.proposed", {
    seamId: "seam-counter",
    name: "CounterStore",
    producerNodeId: "n-store",
    consumerNodeIds: ["n-ui", "n-logic"],
    draftSignature: "get():number; inc():void; dec():void; reset():void; subscribe(fn):void"
  }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 4, seamCount: 1, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} }),
  ev("human", "decision.resolved", { decisionId: "d-approve", choice: { action: "approve" }, actor: "human" }),

  // Foundation
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "src/counter/store.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", {
    seamId: "seam-counter",
    revision: 1,
    frozenSignature: "get():number; inc():void; dec():void; reset():void; subscribe(fn):void",
    extractedFrom: "src/counter/store.ts"
  }),
  ev("system", "scope.derived", { nodeId: "n-store", paths: ["src/counter/store.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-ui", paths: ["src/ui/counterView.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-logic", paths: ["src/counter/logic.ts"] }),
  ev("system", "wave.planned", {
    waves: [{ waveId: "w1", index: 0, nodeIds: ["n-store", "n-ui", "n-logic"], unlockedBySeams: ["seam-counter"] }]
  }),
  ev("system", "grounding.completed", { skeletonCommit: "c1" }),

  // Supervision (parallel wave)
  ev("system", "wave.opened", { waveId: "w1", nodeIds: ["n-store", "n-ui", "n-logic"] }),
  ev("agent", "node.execution.started", { nodeId: "n-store", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-ui", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-logic", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-store", iteration: 1, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", {
    nodeId: "n-store", commit: "s1", changedFiles: ["src/counter/store.ts"],
    builtAgainst: [{ seamId: "seam-counter", revision: 1 }], produces: { seamId: "seam-counter", revision: 1 }
  }),
  ev("agent", "node.verify.iteration", { nodeId: "n-ui", iteration: 1, maxIterations: 3, build: "pass", testsPass: 1, testsTotal: 1 }),
  ev("agent", "node.verify.passed", { nodeId: "n-ui", commit: "u1", changedFiles: ["src/ui/counterView.ts"], builtAgainst: [{ seamId: "seam-counter", revision: 1 }] }),
  ev("agent", "node.verify.iteration", { nodeId: "n-logic", iteration: 1, maxIterations: 3, build: "pass", testsPass: 2, testsTotal: 2 }),
  ev("agent", "node.verify.passed", { nodeId: "n-logic", commit: "l1", changedFiles: ["src/counter/logic.ts"], builtAgainst: [{ seamId: "seam-counter", revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w1" }),

  // Reconciliation
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["n-store", "n-ui", "n-logic"] }),
  ev("system", "integration.validated", {
    compositeNodeId: "root", testsPass: 8, testsTotal: 8, passed: true,
    builtAgainst: [{ seamId: "seam-counter", revision: 1 }]
  }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "r1", status: "success" }),

  // Disposition
  ev("system", "run.evidence.ready", {
    aggregateDiffRef: "blob://golden-happy-path/diff",
    tests: { pass: 8, total: 8 },
    narrativeRef: "blob://golden-happy-path/narrative",
    integrationCommit: "r1"
  }),
  ev("system", "decision.raised", { decisionId: "d-merge", kind: "approve_merge", blocking: true, context: { diffRef: "blob://golden-happy-path/diff" } }),
  ev("human", "decision.resolved", { decisionId: "d-merge", choice: { action: "accept" }, actor: "human" }),
  ev("system", "run.completed", { status: "success" })
]);
