/**
 * golden-seam-amendment-blast-radius — a seam SIGNATURE change that invalidates
 * already-green consumers and an already-integrated composite, forcing partial
 * re-execution while an unaffected node is preserved. Demonstrates projected blast
 * (before approval) vs realized invalidation (after seam.amended), and
 * Evidence.invalidationTrace. See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-seam-amendment-blast-radius";

export const goldenSeamAmendmentBlastRadius = fixture(RUN_ID, [
  // Framing + Proposal
  ev("system", "run.created", { intent: "Paginar la búsqueda (resultados con total y cursor).", workspaceId: "ws-demo", config: demoConfig }),
  ev("system", "run.context.resolved", { repo: "search-svc", baseCommit: "a0", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Búsqueda paginada", goal: "Coordinar la paginación.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "c-results", parentId: "root", role: "composite", title: "Pipeline de resultados", goal: "Integrar API + UI.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-search", parentId: "root", role: "leaf", title: "SearchService", goal: "Buscar.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-api", parentId: "c-results", role: "leaf", title: "GET /search", goal: "Endpoint.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-ui", parentId: "c-results", role: "leaf", title: "Lista de resultados", goal: "Render.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-telemetry", parentId: "root", role: "leaf", title: "Métricas de latencia", goal: "Logging independiente.", depth: 1 }),
  ev("system", "plan.seam.proposed", {
    seamId: "seam-search", name: "SearchService", producerNodeId: "n-search", consumerNodeIds: ["n-api", "n-ui"],
    draftSignature: "search(query:string):Result[]"
  }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 6, seamCount: 1, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} }),
  ev("human", "decision.resolved", { decisionId: "d-approve", choice: { action: "approve" }, actor: "human" }),

  // Foundation — seam frozen at revision 1
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "src/search/searchService.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", { seamId: "seam-search", revision: 1, frozenSignature: "search(query:string):Result[]", extractedFrom: "src/search/searchService.ts" }),
  ev("system", "scope.derived", { nodeId: "n-search", paths: ["src/search/searchService.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-api", paths: ["src/api/searchRoute.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-ui", paths: ["src/ui/resultsList.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-telemetry", paths: ["src/telemetry/searchMetrics.ts"] }),
  ev("system", "wave.planned", { waves: [{ waveId: "w1", index: 0, nodeIds: ["n-search", "n-api", "n-ui", "n-telemetry"], unlockedBySeams: ["seam-search"] }] }),
  ev("system", "grounding.completed", { skeletonCommit: "c1" }),

  // Supervision — consumers + telemetry pass against revision 1; composite integrates
  ev("system", "wave.opened", { waveId: "w1", nodeIds: ["n-search", "n-api", "n-ui", "n-telemetry"] }),
  ev("agent", "node.execution.started", { nodeId: "n-search", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-api", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-ui", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.execution.started", { nodeId: "n-telemetry", agent: "gemini", model: "gemini-2.5-flash" }),
  ev("agent", "node.verify.passed", { nodeId: "n-api", commit: "p1", changedFiles: ["src/api/searchRoute.ts"], builtAgainst: [{ seamId: "seam-search", revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-ui", commit: "p2", changedFiles: ["src/ui/resultsList.ts"], builtAgainst: [{ seamId: "seam-search", revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-telemetry", commit: "p3", changedFiles: ["src/telemetry/searchMetrics.ts"], builtAgainst: [] }),
  ev("system", "integration.started", { compositeNodeId: "c-results", childNodeIds: ["n-api", "n-ui"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-results", testsPass: 5, testsTotal: 5, passed: true, builtAgainst: [{ seamId: "seam-search", revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-results", commit: "cr1", status: "success" }),

  // The producer discovers the frozen signature is insufficient → amendment (signature)
  ev("agent", "node.verify.iteration", { nodeId: "n-search", iteration: 1, maxIterations: 3, build: "pass", testsPass: 1, testsTotal: 3 }),
  ev("agent", "amendment.proposed", {
    amendmentId: "am-pag",
    nodeId: "n-search",
    kind: "seam",
    changeKind: "signature",
    detail: {
      seamId: "seam-search",
      fromRevision: 1,
      toRevision: 2,
      newSignature: "search(query:string, page:{cursor?:string,limit:number}):{results:Result[],total:number,nextCursor?:string}"
    },
    affects: ["n-search", "n-api", "n-ui", "c-results", "root"],
    diagnosisRef: "blob://golden-seam-amendment-blast-radius/am-pag/diag"
  }),
  // Atomic gate immediately after the amendment proposal
  ev("system", "decision.raised", { decisionId: "d-amend", kind: "approve_amendment", blocking: true, context: { amendmentId: "am-pag" } }),
  ev("human", "decision.resolved", { decisionId: "d-amend", choice: { action: "approve" }, actor: "human" }),

  // Realized invalidation: seam advances to revision 2
  ev("system", "seam.amended", {
    seamId: "seam-search",
    revision: 2,
    changeKind: "signature",
    signature: "search(query:string, page:{cursor?:string,limit:number}):{results:Result[],total:number,nextCursor?:string}"
  }),

  // Producer re-runs to produce revision 2
  ev("agent", "node.execution.started", { nodeId: "n-search", agent: "gemini", model: "gemini-2.5-flash", reason: "amendment:am-pag" }),
  ev("agent", "node.verify.passed", { nodeId: "n-search", commit: "s2", changedFiles: ["src/search/searchService.ts"], builtAgainst: [{ seamId: "seam-search", revision: 2 }], produces: { seamId: "seam-search", revision: 2 } }),
  ev("system", "amendment.applied", { amendmentId: "am-pag" }),

  // Partial re-execution: only the stale consumers (n-telemetry is NOT re-run)
  ev("agent", "node.execution.started", { nodeId: "n-api", agent: "gemini", model: "gemini-2.5-flash", reason: "stale:seam-search@2" }),
  ev("agent", "node.verify.passed", { nodeId: "n-api", commit: "p1b", changedFiles: ["src/api/searchRoute.ts"], builtAgainst: [{ seamId: "seam-search", revision: 2 }] }),
  ev("agent", "node.execution.started", { nodeId: "n-ui", agent: "gemini", model: "gemini-2.5-flash", reason: "stale:seam-search@2" }),
  ev("agent", "node.verify.passed", { nodeId: "n-ui", commit: "p2b", changedFiles: ["src/ui/resultsList.ts"], builtAgainst: [{ seamId: "seam-search", revision: 2 }] }),

  // Re-integration of the composite and the root
  ev("system", "integration.started", { compositeNodeId: "c-results", childNodeIds: ["n-api", "n-ui"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-results", testsPass: 6, testsTotal: 6, passed: true, builtAgainst: [{ seamId: "seam-search", revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-results", commit: "cr2", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-results", "n-search", "n-telemetry"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 12, testsTotal: 12, passed: true, builtAgainst: [{ seamId: "seam-search", revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "r1", status: "success" }),

  // Disposition with the invalidation trace
  ev("system", "run.evidence.ready", {
    aggregateDiffRef: "blob://golden-seam-amendment-blast-radius/diff",
    tests: { pass: 12, total: 12 },
    narrativeRef: "blob://golden-seam-amendment-blast-radius/narrative",
    integrationCommit: "r1",
    invalidationTrace: [
      {
        seamId: "seam-search",
        from: 1,
        to: 2,
        cause: "signature-insufficient",
        reExecuted: ["n-search", "n-api", "n-ui"],
        reIntegrated: ["c-results", "root"],
        preserved: ["n-telemetry"]
      }
    ]
  }),
  ev("system", "run.completed", { status: "success" })
]);
