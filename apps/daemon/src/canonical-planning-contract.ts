/**
 * The exact shape of a planning proposal, as prompt material.
 *
 * `SemanticPlanMaterial` is a strict, deeply nested schema with discriminated
 * unions and cross-field refinements, and the productive prompt used to name it
 * without describing it. The live composite run answered with a correct
 * hierarchy expressed in an invented shape and lost the whole planning call to
 * sixty Zod issues. A model cannot derive a strict schema from its type name,
 * so the contract has to travel with the request.
 *
 * Everything here is pinned by `tests/planning-prompt-canonical-contract.test.ts`,
 * which runs the example through the real schema. If a contract field moves,
 * that test fails before a live run pays to discover it.
 */

/**
 * The proposal surface. The six fields the daemon binds exactly — `id`,
 * `revision`, `goalContract`, `repositorySnapshot`, `repositoryView` and
 * `evidence` — are deliberately absent: a model value for any of them is
 * discarded, so asking for one only invites a contradiction.
 */
export interface PlanProposalExample {
  readonly rootUnitId: string;
  readonly units: Readonly<Record<string, unknown>>;
  readonly seams: Readonly<Record<string, unknown>>;
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly decisions: readonly unknown[];
  readonly status: "ready";
}

const EVIDENCE_PLACEHOLDER = "evidence:replace-with-a-supplied-reference";
// New files have no resource of their own, so the write authority is the
// package that contains them. Both leaves therefore write the same resource and
// have to be ordered by an artifact.
const PACKAGE = "resource:replace-with-a-supplied-package";

const EPISTEMIC = {
  state: "known",
  confidence: "high",
  evidenceRefs: [EVIDENCE_PLACEHOLDER]
} as const;

const FEASIBLE = {
  coherentResponsibility: true,
  boundedContext: "yes",
  boundedChangeSurface: "yes",
  independentlyValidatable: "yes",
  unresolvedArchitectureDecision: false
} as const;

export const CANONICAL_PLAN_EXAMPLE: PlanProposalExample = {
  rootUnitId: "unit:root",
  units: {
    "unit:root": {
      id: "unit:root",
      role: "composite",
      title: "Integrated feature",
      objective: "Own the boundary between the two modules and prove it holds.",
      boundary: { kind: "vertical_slice", evidenceRefs: [EVIDENCE_PLACEHOLDER] },
      outcomes: [{ id: "outcome:integrated", statement: "Both modules work together." }],
      criteria: [{
        criterionId: "criterion:root-refinement",
        statement: "The integrated behaviour satisfies the supplied criterion.",
        sourceCriterionId: "criterion:replace-with-a-supplied-criterion"
      }],
      repositorySurface: {
        resourceRefs: [PACKAGE],
        pathHints: ["src/producer.ts", "src/producer.test.ts", "src/consumer.ts", "src/consumer.test.ts"]
      },
      resourceIntents: [],
      consumes: ["artifact:producer-change", "artifact:consumer-change"],
      produces: [],
      seamRefs: ["seam:producer-contract"],
      validation: [{
        obligationId: "validation:integration",
        criterionId: "criterion:root-refinement",
        layer: "integration",
        severity: "required",
        acceptableEvidence: ["test_result"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid",
        evidence: {
          kind: "focused_command",
          selectors: ["src/producer.test.ts", "src/consumer.test.ts"],
          references: ["src/producer.test.ts", "src/consumer.test.ts"]
        }
      }],
      uncertainty: [],
      granularity: {
        disposition: "split",
        feasibility: FEASIBLE,
        splitReasons: ["integration_boundary"],
        expectedBenefits: ["Each module is validated on its own."],
        expectedCosts: ["One explicit seam has to stay compatible."],
        integrationObligationId: "validation:integration",
        evidenceRefs: [EVIDENCE_PLACEHOLDER],
        epistemic: EPISTEMIC
      },
      expansion: "expanded",
      integration: {
        obligationId: "validation:integration",
        objective: "Compose both module changes and prove the seam.",
        criterionIds: ["criterion:root-refinement"],
        artifactIds: ["artifact:producer-change", "artifact:consumer-change"],
        seamIds: ["seam:producer-contract"]
      }
    },
    "unit:producer": {
      id: "unit:producer",
      parentId: "unit:root",
      role: "leaf",
      title: "Producer module",
      objective: "Implement the module that exports the seam.",
      boundary: { kind: "module", evidenceRefs: [EVIDENCE_PLACEHOLDER] },
      outcomes: [{ id: "outcome:producer", statement: "The module exports its contract." }],
      criteria: [{
        criterionId: "criterion:producer",
        statement: "The producer supports the integrated behaviour.",
        sourceCriterionId: "criterion:root-refinement"
      }],
      repositorySurface: {
        resourceRefs: [PACKAGE],
        pathHints: ["src/producer.ts", "src/producer.test.ts"]
      },
      resourceIntents: [{
        resourceId: PACKAGE,
        access: "modify",
        ownerPhase: "implementation",
        outputArtifactId: "artifact:producer-change",
        evidenceRefs: [EVIDENCE_PLACEHOLDER],
        epistemic: EPISTEMIC
      }],
      consumes: [],
      produces: ["artifact:producer-change"],
      seamRefs: ["seam:producer-contract"],
      validation: [{
        obligationId: "validation:producer",
        criterionId: "criterion:producer",
        layer: "unit",
        severity: "required",
        acceptableEvidence: ["test_result"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid",
        evidence: {
          kind: "focused_command",
          selectors: ["src/producer.test.ts"],
          references: ["src/producer.test.ts"]
        }
      }],
      uncertainty: [],
      granularity: {
        disposition: "leaf",
        feasibility: FEASIBLE,
        splitReasons: [],
        expectedBenefits: [],
        expectedCosts: [],
        evidenceRefs: [EVIDENCE_PLACEHOLDER],
        epistemic: EPISTEMIC
      },
      expansion: "leaf"
    },
    "unit:consumer": {
      id: "unit:consumer",
      parentId: "unit:root",
      role: "leaf",
      title: "Consumer module",
      objective: "Implement the module that consumes the seam.",
      boundary: { kind: "module", evidenceRefs: [EVIDENCE_PLACEHOLDER] },
      outcomes: [{ id: "outcome:consumer", statement: "The module consumes the exported contract." }],
      criteria: [{
        criterionId: "criterion:consumer",
        statement: "The consumer supports the integrated behaviour.",
        sourceCriterionId: "criterion:root-refinement"
      }],
      repositorySurface: {
        resourceRefs: [PACKAGE],
        pathHints: ["src/consumer.ts", "src/consumer.test.ts"]
      },
      resourceIntents: [{
        resourceId: PACKAGE,
        access: "modify",
        ownerPhase: "implementation",
        inputArtifactId: "artifact:producer-change",
        outputArtifactId: "artifact:consumer-change",
        evidenceRefs: [EVIDENCE_PLACEHOLDER],
        epistemic: EPISTEMIC
      }],
      consumes: ["artifact:producer-change"],
      produces: ["artifact:consumer-change"],
      seamRefs: ["seam:producer-contract"],
      validation: [{
        obligationId: "validation:consumer",
        criterionId: "criterion:consumer",
        layer: "unit",
        severity: "required",
        acceptableEvidence: ["test_result"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid",
        evidence: {
          kind: "focused_command",
          selectors: ["src/consumer.test.ts"],
          references: ["src/consumer.test.ts"]
        }
      }],
      uncertainty: [],
      granularity: {
        disposition: "leaf",
        feasibility: FEASIBLE,
        splitReasons: [],
        expectedBenefits: [],
        expectedCosts: [],
        evidenceRefs: [EVIDENCE_PLACEHOLDER],
        epistemic: EPISTEMIC
      },
      expansion: "leaf"
    }
  },
  seams: {
    "seam:producer-contract": {
      id: "seam:producer-contract",
      kind: "api",
      specification: "The producer exports createFeature(input: string): Feature.",
      producerUnitId: "unit:producer",
      consumerUnitIds: ["unit:consumer", "unit:root"],
      semanticFacts: { export: "createFeature", returns: "Feature", constructorArgs: "message: string, cause?: Error" },
      compatibility: { mode: "exact", rules: ["The exported signature stays stable."] },
      artifactId: "artifact:producer-change",
      validationObligationIds: ["validation:consumer"]
    }
  },
  artifacts: {
    "artifact:producer-change": {
      id: "artifact:producer-change",
      producerUnitId: "unit:producer",
      consumerUnitIds: ["unit:consumer", "unit:root"],
      artifactType: "source_change",
      materialization: "patch",
      expectedPaths: ["src/producer.ts", "src/producer.test.ts"]
    },
    "artifact:consumer-change": {
      id: "artifact:consumer-change",
      producerUnitId: "unit:consumer",
      consumerUnitIds: ["unit:root"],
      artifactType: "source_change",
      materialization: "patch",
      expectedPaths: ["src/consumer.ts", "src/consumer.test.ts"]
    }
  },
  decisions: [],
  status: "ready"
};

/**
 * The invariants `verifyPlan` enforces once the schema accepts the proposal. A
 * plan that parses and then fails these costs the same planning call, so the
 * rules travel with the shape instead of waiting for a repair round.
 */
export const CANONICAL_PLAN_RULES: readonly string[] = [
  "The root unit has no parentId. Every other unit names an existing parentId.",
  "A leaf has role leaf, expansion leaf, granularity.disposition leaf, coherentResponsibility true, boundedContext, boundedChangeSurface and independentlyValidatable all yes, unresolvedArchitectureDecision false, at least one validation obligation, and no integration.",
  "An expanded composite has role composite, expansion expanded, granularity.disposition split, at least two direct children, and an integration object.",
  "granularity.integrationObligationId equals integration.obligationId, and that same obligationId also appears in the validation array of the same unit.",
  "criteria[].sourceCriterionId on the root unit names a supplied criterion id. On any other unit it names a criterionId declared by its parent.",
  "Every supplied required criterion is reachable from a required validation obligation through that refinement chain.",
  "validation[].criterionId names a criterionId declared by the same unit, and every obligationId is unique across the whole plan.",
  "Every artifact has one producer unit that lists it in produces and owns a modify intent whose outputArtifactId is that artifact. Every consumer lists it in consumes, and the artifact lists every consumer.",
  "Every modify intent carries ownerPhase and outputArtifactId. An observe intent carries neither.",
  "resourceIntents[].resourceId also appears in repositorySurface.resourceRefs of the same unit, and both use supplied resource ids.",
  "artifacts[].expectedPaths stay inside the write surface of their producer. A file resource authorises only its own exact path, so to create a file that does not exist yet the modify intent must name the package or directory resource that contains it, and repositorySurface.pathHints must list the new paths.",
  "Two units may modify overlapping resources only when they are ordered by an artifact: the later unit consumes the artifact of the earlier one and its modify intent carries inputArtifactId set to that artifact. Two units creating files under the same package resource overlap, so they need that ordering.",
  "A package resource contains every file in it, so a unit that creates a new file overlaps every unit that edits an existing one. Order them: give the file-editing unit an inputArtifactId pointing at the creator's artifact, and have it consume that artifact. Consuming the artifact alone is not enough — the modify intent has to name it as the version it starts from.",
  "Claim the narrowest resource that authorises the write. A unit that only changes files which already exist claims those file resources, and two units holding different file resources do not overlap, so they run at the same time. Claiming the package when a file would do forces an ordering the work does not need and turns a wide plan into a chain.",
  "A seam is declared in seamRefs by its producer and by every consumer, every consumer also consumes the artifactId of the seam, semanticFacts and compatibility.rules are both non-empty, and the artifact of the seam has the same producer.",
  "When one command proves several criteria, every one of those criteria has its own obligation, all of them carry evidence of kind shared_command, and every one lists the same complete criterionIds — identical objects, not overlapping subsets. An obligation naming a criterion whose own obligation declares anything else is rejected. If the same evidence cannot be written on all of them, give each criterion a focused_command instead.",
  "semanticFacts is a flat map of string to string. A fact that is naturally a list — argument names, accepted values — is one string, never an array or a nested object. Every field this contract shows as a string is a string.",
  "Every required validation obligation carries an evidence binding, or execution refuses the node because no command can be materialized. Use {kind: focused_command, selectors, references} for a test or check layer, {kind: static_proof, references} only when layer is static, or {kind: shared_command, criterionIds, references, rationale} when one command covers several criteria.",
  "evidence selectors are repository-relative paths passed to the validation command as arguments. They may not be absolute, start with a hyphen, or contain a .. segment, and the files they name must be produced by the same unit.",
  "Replace every criterion:, resource: and evidence: identifier taken from the example with ids from the supplied lists. Invented ids are rejected."
];

/** Enumerations the schema accepts, listed so no value has to be guessed. */
const CANONICAL_PLAN_ENUMS: readonly string[] = [
  "role: leaf | composite",
  "expansion: leaf | expanded | frontier",
  "boundary.kind: application | package | module | domain | vertical_slice | cross_cutting",
  "granularity.disposition: leaf | split | frontier",
  "granularity.feasibility.boundedContext / boundedChangeSurface / independentlyValidatable: yes | no | unknown",
  "granularity.splitReasons[]: capacity | independent_delivery | parallelism | risk_isolation | integration_boundary | specialization",
  "epistemic: either {state: known|partial|conflicting, confidence: high|medium|low, evidenceRefs: at least one} or {state: unknown, reason: text, evidenceRefs: []}",
  "resourceIntents[].access: observe | modify",
  "resourceIntents[].ownerPhase: implementation | integration",
  "validation[].layer: static | unit | integration | e2e | security | accessibility | manual",
  "validation[].severity: required | advisory",
  "validation[].acceptableEvidence[]: static_analysis | test_result | runtime_observation | artifact_inspection | manual_attestation",
  "validation[].baselinePolicy: required | optional | not_required",
  "validation[].negativeControl: required | when_feasible | not_required",
  "validation[].flakyPolicy: forbid | allow_with_warning",
  "uncertainty[].disposition: bounded | decision_required | unsupported",
  "seams[].kind: api | type | event | data | ui | command",
  "seams[].compatibility.mode: exact | backward_compatible",
  "artifacts[].materialization: commit | patch | files | manifest | logical"
];

/** The contract block the planning prompt carries verbatim. */
export function canonicalPlanningContract(): string {
  return [
    "Return exactly one JSON object with these keys and no others: rootUnitId, units, seams, artifacts, decisions, status.",
    "Every object is strict: an unexpected key is a rejection, not a warning. Omit an optional field instead of sending null.",
    "Do not send id, revision, goalContract, repositorySnapshot, repositoryView or evidence. The system binds those exactly and discards any value you supply.",
    "Do not send proofStrategyId. The system binds one proof strategy per obligation.",
    "status is always the string ready. Ids match [A-Za-z0-9._:-]+ .",
    "",
    "Rules:",
    ...CANONICAL_PLAN_RULES.map((rule) => `- ${rule}`),
    "",
    "Enumerations:",
    ...CANONICAL_PLAN_ENUMS.map((value) => `- ${value}`),
    "",
    "A composite root over two leaves and one seam, in the exact accepted shape:",
    JSON.stringify(CANONICAL_PLAN_EXAMPLE, null, 2)
  ].join("\n");
}
