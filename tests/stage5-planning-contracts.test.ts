import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PlanningResultSchema,
  buildPlanningRevision,
  buildSemanticPlan,
  type DigestHasher,
  type PlanningBudget,
  type SemanticPlanMaterial
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 5 planning contracts", () => {
  it("keeps compileability exclusive to ready results", () => {
    const plan = buildSemanticPlan(planMaterial(), sha256);
    const result = PlanningResultSchema.parse({ kind: "ready", plan, trace: trace() });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.plan).toEqual(plan);
    expect(PlanningResultSchema.safeParse({
      kind: "needs_input",
      plan,
      decisions: [decision()],
      continuation: { requestDigest: "sha256:request", revisionDigest: "sha256:revision" },
      trace: trace()
    }).success).toBe(false);
    expect(PlanningResultSchema.safeParse({ ...plan, status: "needs_input" }).success).toBe(false);
  });

  it("identifies revision lineage and the complete unified budget", () => {
    const budget: PlanningBudget = {
      modelCalls: 2,
      repositoryQueries: 8,
      queryBytes: 64_000,
      revisions: 3,
      repairs: 1,
      expansions: 2
    };
    const revision = buildPlanningRevision({
      index: 1,
      cause: "initial",
      budget,
      consumed: {
        modelCalls: 1,
        repositoryQueries: 3,
        queryBytes: 1024,
        revisions: 1,
        repairs: 0,
        expansions: 0
      },
      queryReceipts: ["query:packages"],
      evidenceRefs: ["evidence:repository"],
      changedDecisionIds: [],
      changedFindingCodes: [],
      proposalDigest: "sha256:proposal"
    }, sha256);
    const revisionMaterial = structuredClone(revision);
    Reflect.deleteProperty(revisionMaterial, "digest");
    const replay = buildPlanningRevision(revisionMaterial, sha256);

    expect(revision.digest).toBe(replay.digest);
    expect(revision.parentDigest).toBeUndefined();
    expect(revision.budget).toEqual(budget);
  });

  it("stores contract semantics inside the single canonical plan", () => {
    const plan = buildSemanticPlan(planMaterial(), sha256);
    expect(plan.artifacts["artifact:change"]?.producerUnitId).toBe("unit:root");
    expect(plan.seams["seam:public"]?.compatibility.mode).toBe("exact");
    expect(plan.units["unit:root"]?.validation[0]?.proofStrategyId).toBe("proof:criterion");
    const intent = plan.units["unit:root"]?.resourceIntents[0];
    expect(intent?.access).toBe("modify");
    if (intent?.access !== "modify") return;
    expect(intent.outputArtifactId).toBe("artifact:change");
  });
});

function trace() {
  return {
    budget: {
      modelCalls: 2,
      repositoryQueries: 8,
      queryBytes: 64_000,
      revisions: 3,
      repairs: 1,
      expansions: 2
    },
    consumed: {
      modelCalls: 1,
      repositoryQueries: 1,
      queryBytes: 100,
      revisions: 1,
      repairs: 0,
      expansions: 0
    },
    revisions: [],
    advisoryFindings: []
  };
}

function decision() {
  return {
    id: "decision:ownership",
    question: "Which unit owns the public route?",
    rationale: "Repository evidence leaves two viable owners.",
    options: [
      { id: "option:web", label: "Web", consequences: ["Web owns the route."] },
      { id: "option:daemon", label: "Daemon", consequences: ["Daemon owns the route."] }
    ],
    evidenceRefs: ["evidence:route"]
  };
}

function planMaterial(): SemanticPlanMaterial {
  return {
    id: "plan:stage5",
    revision: 1,
    goalContract: { id: "goal:stage5", revision: 1, digest: "sha256:goal" },
    repositorySnapshot: { id: "snapshot:base", digest: "sha256:snapshot" },
    repositoryView: {
      digest: "sha256:view",
      treeSha: "a".repeat(40),
      resourceCatalogDigest: "sha256:catalog"
    },
    rootUnitId: "unit:root",
    units: {
      "unit:root": {
        id: "unit:root",
        role: "leaf",
        title: "Public route",
        objective: "Implement the public route",
        boundary: { kind: "vertical_slice", evidenceRefs: ["evidence:route"] },
        outcomes: [{ id: "outcome:route", statement: "The route behaves correctly." }],
        criteria: [{
          criterionId: "criterion:route",
          statement: "The route is usable.",
          sourceCriterionId: "criterion:route"
        }],
        repositorySurface: {
          resourceRefs: ["resource:route"],
          pathHints: ["src/route.ts"]
        },
        resourceIntents: [{
          resourceId: "resource:route",
          access: "modify",
          ownerPhase: "implementation",
          outputArtifactId: "artifact:change",
          evidenceRefs: ["evidence:route"],
          epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:route"] }
        }],
        consumes: [],
        produces: ["artifact:change"],
        seamRefs: ["seam:public"],
        validation: [{
          obligationId: "validation:route",
          criterionId: "criterion:route",
          proofStrategyId: "proof:criterion",
          layer: "integration",
          severity: "required",
          acceptableEvidence: ["test_result"],
          baselinePolicy: "required",
          negativeControl: "when_feasible",
          flakyPolicy: "forbid"
        }],
        uncertainty: [],
        granularity: {
          disposition: "leaf",
          feasibility: {
            coherentResponsibility: true,
            boundedContext: "yes",
            boundedChangeSurface: "yes",
            independentlyValidatable: "yes",
            unresolvedArchitectureDecision: false
          },
          splitReasons: [],
          expectedBenefits: [],
          expectedCosts: [],
          evidenceRefs: ["evidence:route"],
          epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:route"] }
        },
        expansion: "leaf"
      }
    },
    seams: {
      "seam:public": {
        id: "seam:public",
        kind: "api",
        specification: "GET /route returns the public representation.",
        producerUnitId: "unit:root",
        consumerUnitIds: ["unit:consumer"],
        semanticFacts: { method: "GET" },
        compatibility: { mode: "exact", rules: ["Response shape is stable."] },
        artifactId: "artifact:change",
        validationObligationIds: ["validation:route"]
      }
    },
    artifacts: {
      "artifact:change": {
        id: "artifact:change",
        producerUnitId: "unit:root",
        consumerUnitIds: [],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: ["src/route.ts"]
      }
    },
    decisions: [],
    evidence: [],
    status: "ready"
  };
}
