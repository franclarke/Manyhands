import {
  canonicalJson,
  GoalContractSchema,
  ProofStrategySchema,
  RepoRelativePathSchema,
  SemanticPlanSchema,
  validateGoalContract,
  verifyCanonicalDigest,
  validateProofCoverage,
  type DigestHasher,
  type GoalContract,
  type PlanningFinding,
  type ProofStrategy,
  type SemanticPlan,
  type WorkUnit
} from "@manyhands/contracts";
import type { RepositoryView } from "@manyhands/repository-index";

export interface VerifyPlanInput {
  plan: SemanticPlan;
  goal: GoalContract;
  proofStrategies: readonly ProofStrategy[];
  repositoryView: RepositoryView;
  hasher: DigestHasher;
}

export interface PlanVerificationResult {
  ok: boolean;
  findings: PlanningFinding[];
}

export function verifyPlan(input: VerifyPlanInput): PlanVerificationResult {
  const parsed = SemanticPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return result(parsed.error.issues.map((issue) => finding(
      "schema_invalid",
      `${issue.path.join(".")}: ${issue.message}`
    )));
  }
  const plan = parsed.data;
  const findings: PlanningFinding[] = [];
  const parsedGoal = GoalContractSchema.safeParse(input.goal);
  if (!parsedGoal.success) {
    return result(parsedGoal.error.issues.map((issue) => finding(
      "schema_invalid",
      `goal.${issue.path.join(".")}: ${issue.message}`
    )));
  }
  const goal = parsedGoal.data;
  for (const issue of validateGoalContract(goal).issues) {
    findings.push(finding(issue.code, issue.message, issue.criterionId));
  }
  const proofStrategies: ProofStrategy[] = [];
  const proofIds = new Set<string>();
  for (const [index, proofStrategy] of input.proofStrategies.entries()) {
    const parsedProof = ProofStrategySchema.safeParse(proofStrategy);
    if (!parsedProof.success) {
      findings.push(...parsedProof.error.issues.map((issue) => finding(
        "schema_invalid",
        `proofStrategies.${index}.${issue.path.join(".")}: ${issue.message}`
      )));
      continue;
    }
    const proof = parsedProof.data;
    proofStrategies.push(proof);
    if (proofIds.has(proof.id)) {
      findings.push(finding(
        "proof_strategy_id_duplicate",
        `ProofStrategy id ${proof.id} is declared more than once.`,
        proof.id
      ));
    }
    proofIds.add(proof.id);
    if (!verifyCanonicalDigest(proof, "digest", input.hasher)) {
      findings.push(finding(
        "proof_strategy_digest_mismatch",
        `ProofStrategy ${proof.id} digest does not identify its canonical content.`,
        proof.id
      ));
    }
    if (proof.repositoryViewDigest !== input.repositoryView.digest) {
      findings.push(finding(
        "proof_repository_view_mismatch",
        `ProofStrategy ${proof.id} is not bound to the exact RepositoryView.`,
        proof.id
      ));
    }
  }
  if (!verifyCanonicalDigest(plan, "digest", input.hasher)) {
    findings.push(finding("plan_digest_mismatch", "SemanticPlan digest does not identify its canonical content."));
  }
  if (!verifyCanonicalDigest(goal, "digest", input.hasher)) {
    findings.push(finding(
      "goal_contract_digest_mismatch",
      "GoalContract digest does not identify its canonical content.",
      goal.id
    ));
  }
  if (
    plan.goalContract.id !== goal.id ||
    plan.goalContract.revision !== goal.revision ||
    plan.goalContract.digest !== goal.digest
  ) {
    findings.push(finding("goal_contract_mismatch", "SemanticPlan is not bound to the supplied GoalContract."));
  }
  if (
    plan.repositoryView.digest !== input.repositoryView.digest ||
    plan.repositoryView.treeSha !== input.repositoryView.treeSha ||
    plan.repositoryView.resourceCatalogDigest !== input.repositoryView.catalog.digest
  ) {
    findings.push(finding("repository_view_mismatch", "SemanticPlan is not bound to the exact RepositoryView."));
  }
  if (
    goal.target.repositoryId !== input.repositoryView.model.repositoryId ||
    goal.target.baseCommit !== input.repositoryView.model.baseCommit
  ) {
    findings.push(finding(
      "goal_repository_identity_mismatch",
      "GoalContract target repository and base commit do not match the RepositoryView model.",
      goal.id
    ));
  }
  if (
    input.repositoryView.appliedManifestDigests.length === 0 &&
    goal.target.treeSha !== input.repositoryView.treeSha
  ) {
    findings.push(finding(
      "goal_repository_tree_mismatch",
      "GoalContract target tree does not match the exact RepositoryView tree.",
      goal.id
    ));
  }
  if (
    plan.repositorySnapshot.id !== input.repositoryView.model.snapshot.id ||
    plan.repositorySnapshot.digest !== input.repositoryView.model.snapshot.digest
  ) {
    findings.push(finding(
      "repository_snapshot_mismatch",
      "SemanticPlan repository snapshot does not match the RepositoryView model snapshot."
    ));
  }
  verifyCoverage(input.repositoryView, findings);

  for (const proofFinding of validateProofCoverage(goal, proofStrategies).issues) {
    findings.push(finding(proofFinding.code, proofFinding.message, proofFinding.criterionId));
  }

  verifyHierarchy(plan, findings);
  verifyCriteria(plan, goal, findings);
  verifyUnits(plan, proofStrategies, findings);
  verifyArtifacts(plan, goal, input.repositoryView, findings);
  verifySeams(plan, findings);
  verifyPaths(plan, findings);
  verifyResources(plan, goal, input.repositoryView, findings);
  verifyEvidence(plan, input.repositoryView, findings);
  return result(findings);
}

function verifyHierarchy(plan: SemanticPlan, out: PlanningFinding[]): void {
  const root = plan.units[plan.rootUnitId];
  if (root?.parentId !== undefined) out.push(finding("invalid_root", "The root unit must be parentless.", root?.id));
  for (const unit of Object.values(plan.units)) {
    if (unit.id !== plan.rootUnitId && unit.parentId === undefined) {
      out.push(finding("missing_parent", `Unit ${unit.id} has no parent.`, unit.id));
    }
  }
  detectCycle(Object.keys(plan.units), (id) => {
    const parentId = plan.units[id]?.parentId;
    return parentId === undefined ? [] : [parentId];
  }, () => out.push(finding("hierarchy_cycle", "Work-unit hierarchy contains a cycle.")));
}

function verifyCriteria(plan: SemanticPlan, goal: GoalContract, out: PlanningFinding[]): void {
  const root = plan.units[plan.rootUnitId];
  if (root === undefined) return;
  const required = goal.acceptanceCriteria.filter((criterion) => criterion.required).map(({ id }) => id);
  const rootSources = new Set(root.criteria.map(({ sourceCriterionId }) => sourceCriterionId));
  for (const criterionId of required) {
    if (!rootSources.has(criterionId)) {
      out.push(finding("missing_root_criterion", `Required criterion ${criterionId} has no root obligation.`, criterionId));
    }
  }
  const goalIds = new Set(goal.acceptanceCriteria.map(({ id }) => id));
  for (const unit of Object.values(plan.units)) {
    const allowedSources = unit.parentId === undefined
      ? goalIds
      : new Set(plan.units[unit.parentId]?.criteria.map(({ criterionId }) => criterionId) ?? []);
    for (const criterion of unit.criteria) {
      if (!allowedSources.has(criterion.sourceCriterionId)) {
        out.push(finding(
          "unknown_criterion_refinement",
          `Unit ${unit.id} refines unknown criterion ${criterion.sourceCriterionId}.`,
          criterion.criterionId
        ));
      }
    }
  }
  const validatedGoalCriteria = new Set(Object.values(plan.units).flatMap((unit) =>
    unit.validation
      .filter(({ severity }) => severity === "required")
      .map(({ criterionId }) => rootCriterionFor(plan, unit, criterionId))
  ));
  for (const criterionId of required) {
    if (!validatedGoalCriteria.has(criterionId)) {
      out.push(finding(
        "required_criterion_without_validation",
        `Required criterion ${criterionId} has no connected required validation obligation.`,
        criterionId
      ));
    }
  }
}

function verifyUnits(plan: SemanticPlan, strategies: readonly ProofStrategy[], out: PlanningFinding[]): void {
  const strategiesById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const obligationOwners = new Map<string, string>();
  for (const unit of Object.values(plan.units)) {
    const localCriterionIds = new Set<string>();
    for (const criterion of unit.criteria) {
      if (localCriterionIds.has(criterion.criterionId)) {
        out.push(finding(
          "unit_criterion_id_duplicate",
          `Unit ${unit.id} declares criterion ${criterion.criterionId} more than once.`,
          criterion.criterionId
        ));
      }
      localCriterionIds.add(criterion.criterionId);
    }
    if (unit.role === "leaf") {
      if (unit.expansion !== "leaf" || unit.granularity.disposition !== "leaf") {
        out.push(finding("granularity_role_mismatch", `Leaf ${unit.id} is not represented as a leaf decision.`, unit.id));
      }
      const feasibility = unit.granularity.feasibility;
      if (
        !feasibility.coherentResponsibility ||
        feasibility.boundedContext !== "yes" ||
        feasibility.boundedChangeSurface !== "yes" ||
        feasibility.independentlyValidatable !== "yes" ||
        feasibility.unresolvedArchitectureDecision
      ) {
        out.push(finding(
          "leaf_granularity_unproven",
          `Leaf ${unit.id} does not have a fully known feasibility decision.`,
          unit.id
        ));
      }
      if (unit.validation.length === 0) {
        out.push(finding("missing_leaf_validation", `Leaf ${unit.id} has no validation obligation.`, unit.id));
      }
      if (unit.integration !== undefined) {
        out.push(finding("leaf_integration_invalid", `Leaf ${unit.id} cannot own a composite integration contract.`, unit.id));
      }
    } else {
      const coherentComposite =
        (unit.expansion === "expanded" && unit.granularity.disposition === "split") ||
        (unit.expansion === "frontier" && unit.granularity.disposition === "frontier");
      if (!coherentComposite) {
        out.push(finding(
          "granularity_role_mismatch",
          `Composite ${unit.id} has incoherent expansion and granularity dispositions.`,
          unit.id
        ));
      }
      if (unit.integration === undefined) {
        out.push(finding("missing_composite_integration", `Composite ${unit.id} has no integration obligation.`, unit.id));
      }
      if (
        unit.expansion === "expanded" &&
        unit.granularity.disposition === "split" &&
        Object.values(plan.units).filter(({ parentId }) => parentId === unit.id).length < 2
      ) {
        out.push(finding(
          "composite_split_children_insufficient",
          `Expanded composite ${unit.id} must own at least two direct children.`,
          unit.id
        ));
      }
    }
    if (scopeContributors(plan, unit).length === 0) {
      out.push(finding("unit_scope_empty", `Unit ${unit.id} has no repository scope envelope.`, unit.id));
    }
    const intentKeys = new Set<string>();
    for (const intent of unit.resourceIntents) {
      const key = `${intent.resourceId}\0${intent.access}`;
      if (intentKeys.has(key)) {
        out.push(finding(
          "resource_intent_duplicate",
          `Unit ${unit.id} repeats the ${intent.access} intent for ${intent.resourceId}.`,
          unit.id
        ));
      }
      intentKeys.add(key);
    }
    for (const uncertainty of unit.uncertainty) {
      if (uncertainty.disposition !== "bounded") {
        out.push(finding("unresolved_uncertainty", uncertainty.statement, unit.id, uncertainty.evidenceRefs));
      }
    }
    for (const obligation of unit.validation) {
      if (!localCriterionIds.has(obligation.criterionId)) {
        out.push(finding(
          "validation_criterion_unresolved",
          `Validation ${obligation.obligationId} references criterion ${obligation.criterionId} outside ${unit.id}.`,
          obligation.obligationId
        ));
      }
      const existingOwner = obligationOwners.get(obligation.obligationId);
      if (existingOwner !== undefined) {
        out.push(finding(
          "validation_obligation_id_duplicate",
          `Validation obligation ${obligation.obligationId} is owned by both ${existingOwner} and ${unit.id}.`,
          obligation.obligationId
        ));
      } else {
        obligationOwners.set(obligation.obligationId, unit.id);
      }
      const strategy = strategiesById.get(obligation.proofStrategyId);
      if (strategy === undefined) {
        out.push(finding("missing_proof_strategy", `Validation ${obligation.obligationId} has no ProofStrategy.`, obligation.obligationId));
      } else if (strategy.obligationId !== obligation.obligationId) {
        out.push(finding("proof_obligation_mismatch", `Proof ${strategy.id} is bound to ${strategy.obligationId}, not ${obligation.obligationId}.`, obligation.obligationId));
      } else if (strategy.criterionId !== rootCriterionFor(plan, unit, obligation.criterionId)) {
        out.push(finding("proof_criterion_mismatch", `Proof ${strategy.id} does not cover validation ${obligation.obligationId}.`, obligation.obligationId));
      }
    }
    if (unit.integration !== undefined) {
      if (
        unit.granularity.integrationObligationId !== undefined &&
        unit.granularity.integrationObligationId !== unit.integration.obligationId
      ) {
        out.push(finding(
          "integration_obligation_mismatch",
          `Granularity and integration material for ${unit.id} name different obligations.`,
          unit.id
        ));
      }
      if (!unit.validation.some(({ obligationId }) => obligationId === unit.integration?.obligationId)) {
        out.push(finding("missing_integration_validation", `Integration ${unit.integration.obligationId} is not a validation obligation.`, unit.id));
      }
      if (!strategiesById.has(unit.integration.proofStrategyId)) {
        out.push(finding("missing_proof_strategy", `Integration ${unit.integration.obligationId} has no ProofStrategy.`, unit.id));
      } else if (strategiesById.get(unit.integration.proofStrategyId)?.obligationId !== unit.integration.obligationId) {
        out.push(finding("proof_obligation_mismatch", `Integration ${unit.integration.obligationId} uses a ProofStrategy bound to another obligation.`, unit.id));
      }
      const criterionIds = new Set(unit.criteria.flatMap((criterion) => [
        criterion.criterionId,
        rootCriterionFor(plan, unit, criterion.criterionId)
      ]));
      for (const criterionId of unit.integration.criterionIds) {
        if (!criterionIds.has(criterionId)) {
          out.push(finding(
            "integration_criterion_unresolved",
            `Integration ${unit.integration.obligationId} references criterion ${criterionId} outside ${unit.id}.`,
            unit.id
          ));
        }
      }
      for (const artifactId of unit.integration.artifactIds) {
        if (plan.artifacts[artifactId] === undefined || !unit.consumes.concat(unit.produces).includes(artifactId)) {
          out.push(finding(
            "integration_artifact_unresolved",
            `Integration ${unit.integration.obligationId} references artifact ${artifactId} outside ${unit.id}.`,
            unit.id
          ));
        }
      }
      for (const seamId of unit.integration.seamIds) {
        const seam = plan.seams[seamId];
        const ownsDirectly = seam !== undefined && unit.seamRefs.includes(seamId);
        const ownsDescendantBoundary = seam !== undefined &&
          unit.integration.artifactIds.includes(seam.artifactId) &&
          isStrictDescendant(plan, seam.producerUnitId, unit.id) &&
          seam.consumerUnitIds.every((consumerId) => isStrictDescendant(plan, consumerId, unit.id));
        if (!ownsDirectly && !ownsDescendantBoundary) {
          out.push(finding(
            "integration_seam_unresolved",
            `Integration ${unit.integration.obligationId} references seam ${seamId} outside ${unit.id}.`,
            unit.id
          ));
        }
      }
    }
  }
}

function verifyArtifacts(
  plan: SemanticPlan,
  goal: GoalContract,
  view: RepositoryView,
  out: PlanningFinding[]
): void {
  const edges: Array<readonly [string, string]> = [];
  const protectedPaths = goal.acceptanceCriteria.flatMap(({ protectedReferences }) => protectedReferences)
    .filter((reference) => reference.startsWith("path:"))
    .map((reference) => normalizePath(reference.slice("path:".length)));
  for (const artifact of Object.values(plan.artifacts)) {
    const producer = plan.units[artifact.producerUnitId];
    if (artifact.consumerUnitIds.includes(artifact.producerUnitId)) {
      out.push(finding(
        "artifact_self_consumer",
        `Artifact ${artifact.id} names producer ${artifact.producerUnitId} as a consumer.`,
        artifact.id
      ));
    }
    if (artifact.materialization === "files" && artifact.expectedPaths.length === 0) {
      out.push(finding(
        "artifact_files_paths_missing",
        `Artifact ${artifact.id} uses files materialization without expected paths.`,
        artifact.id
      ));
    }
    if (producer !== undefined) {
      const surfacePaths = [
        ...producer.repositorySurface.pathHints.map(normalizePath),
        ...producer.repositorySurface.resourceRefs.flatMap((resourceRef) => {
          const resolved = view.catalog.resolve(resourceRef);
          return resolved.state === "known" ? resourcePaths(resolved.resource) : [];
        })
      ];
      const writeResources = producer.resourceIntents
        .filter((intent) => intent.access === "modify" && intent.outputArtifactId === artifact.id)
        .flatMap((intent) => {
          const resolved = view.catalog.resolve(intent.resourceId);
          return resolved.state === "known" ? [resolved.resource] : [];
        });
      for (const expectedPath of artifact.expectedPaths.filter(validCompiledPath).map(normalizePath)) {
        const inSurface = surfacePaths.some((surfacePath) => pathIsWithin(expectedPath, surfacePath));
        const inWriteSurface = writeResources.some((resource) => resourceOwnsPath(resource, expectedPath));
        if (!inSurface || !inWriteSurface) {
          out.push(finding(
            "artifact_path_outside_write_surface",
            `Artifact ${artifact.id} expected path ${expectedPath} is outside its producer's write surface.`,
            artifact.id
          ));
        }
        if (protectedPaths.some((protectedPath) => pathsOverlap(expectedPath, protectedPath))) {
          out.push(finding(
            "artifact_protected_path",
            `Artifact ${artifact.id} expects protected path ${expectedPath}.`,
            artifact.id
          ));
        }
      }
    }
    if (producer === undefined) {
      out.push(finding("artifact_missing_producer", `Artifact ${artifact.id} has no producer unit.`, artifact.id));
    }
    if (!producer?.produces.includes(artifact.id)) {
      out.push(finding("artifact_producer_mismatch", `Producer ${artifact.producerUnitId} does not declare ${artifact.id}.`, artifact.id));
    }
    if (!producer?.resourceIntents.some((intent) =>
      intent.access === "modify" && intent.outputArtifactId === artifact.id
    )) {
      out.push(finding(
        "artifact_output_intent_missing",
        `Artifact ${artifact.id} has no modify output intent owned by ${artifact.producerUnitId}.`,
        artifact.id
      ));
    }
    for (const consumerId of artifact.consumerUnitIds) {
      if (plan.units[consumerId] === undefined) {
        out.push(finding("artifact_missing_consumer", `Artifact ${artifact.id} references missing consumer ${consumerId}.`, artifact.id));
      } else if (!plan.units[consumerId]!.consumes.includes(artifact.id)) {
        out.push(finding("artifact_consumer_mismatch", `Consumer ${consumerId} does not declare ${artifact.id}.`, artifact.id));
      }
      edges.push([artifact.producerUnitId, consumerId]);
    }
  }
  for (const unit of Object.values(plan.units)) {
    for (const artifactId of unit.produces) {
      const artifact = plan.artifacts[artifactId];
      if (artifact === undefined) {
        out.push(finding("artifact_unresolved", `Unit ${unit.id} references missing artifact ${artifactId}.`, unit.id));
      } else if (artifact.producerUnitId !== unit.id) {
        out.push(finding(
          "unit_artifact_producer_mismatch",
          `Unit ${unit.id} declares artifact ${artifactId}, whose producer is ${artifact.producerUnitId}.`,
          unit.id
        ));
      }
    }
    for (const artifactId of unit.consumes) {
      const artifact = plan.artifacts[artifactId];
      if (artifact === undefined) {
        out.push(finding("artifact_unresolved", `Unit ${unit.id} references missing artifact ${artifactId}.`, unit.id));
      } else if (!artifact.consumerUnitIds.includes(unit.id)) {
        out.push(finding(
          "unit_artifact_consumer_mismatch",
          `Unit ${unit.id} consumes artifact ${artifactId}, which does not name it as a consumer.`,
          unit.id
        ));
      }
    }
    for (const intent of unit.resourceIntents) {
      if (intent.access !== "modify") continue;
      const artifact = plan.artifacts[intent.outputArtifactId];
      if (artifact !== undefined && artifact.producerUnitId !== unit.id) {
        out.push(finding(
          "resource_output_owner_mismatch",
          `Modify output ${intent.outputArtifactId} is owned by ${artifact.producerUnitId}, not ${unit.id}.`,
          unit.id
        ));
      }
    }
  }
  detectCycle(Object.keys(plan.units), (id) => edges.filter(([producer]) => producer === id).map(([, consumer]) => consumer),
    () => out.push(finding("artifact_cycle", "Artifact dataflow contains a cycle.")));
}

function verifySeams(plan: SemanticPlan, out: PlanningFinding[]): void {
  const obligations = new Set(Object.values(plan.units).flatMap((unit) => unit.validation.map(({ obligationId }) => obligationId)));
  for (const seam of Object.values(plan.seams)) {
    if (seam.consumerUnitIds.includes(seam.producerUnitId)) {
      out.push(finding(
        "seam_self_consumer",
        `Seam ${seam.id} names producer ${seam.producerUnitId} as a consumer.`,
        seam.id
      ));
    }
    if (plan.units[seam.producerUnitId] === undefined) {
      out.push(finding("seam_missing_producer", `Seam ${seam.id} has no producer.`, seam.id));
    }
    if (!plan.units[seam.producerUnitId]?.seamRefs.includes(seam.id)) {
      out.push(finding("seam_producer_mismatch", `Producer ${seam.producerUnitId} does not declare seam ${seam.id}.`, seam.id));
    }
    for (const consumerId of seam.consumerUnitIds) {
      if (plan.units[consumerId] === undefined) out.push(finding("seam_missing_consumer", `Seam ${seam.id} has missing consumer ${consumerId}.`, seam.id));
      else if (!plan.units[consumerId]!.seamRefs.includes(seam.id)) out.push(finding("seam_consumer_mismatch", `Consumer ${consumerId} does not declare seam ${seam.id}.`, seam.id));
      if (!plan.units[consumerId]?.consumes.includes(seam.artifactId)) {
        out.push(finding(
          "seam_consumer_missing_artifact",
          `Consumer ${consumerId} does not consume seam artifact ${seam.artifactId}.`,
          seam.id
        ));
      }
    }
    if (Object.keys(seam.semanticFacts).length === 0 || seam.compatibility.rules.length === 0) {
      out.push(finding("seam_semantics_missing", `Seam ${seam.id} lacks observable semantics or compatibility rules.`, seam.id));
    }
    if (plan.artifacts[seam.artifactId] === undefined) {
      out.push(finding("seam_artifact_missing", `Seam ${seam.id} references missing artifact ${seam.artifactId}.`, seam.id));
    } else if (plan.artifacts[seam.artifactId]!.producerUnitId !== seam.producerUnitId) {
      out.push(finding(
        "seam_artifact_producer_mismatch",
        `Seam ${seam.id} and artifact ${seam.artifactId} name different producers.`,
        seam.id
      ));
    } else {
      const artifactConsumers = new Set(plan.artifacts[seam.artifactId]!.consumerUnitIds);
      if (seam.consumerUnitIds.some((consumerId) => !artifactConsumers.has(consumerId))) {
        out.push(finding(
          "seam_artifact_consumer_mismatch",
          `Seam ${seam.id} has consumers not named by artifact ${seam.artifactId}.`,
          seam.id
        ));
      }
    }
    for (const obligationId of seam.validationObligationIds) {
      if (!obligations.has(obligationId)) {
        out.push(finding("seam_validation_missing", `Seam ${seam.id} references missing validation ${obligationId}.`, seam.id));
      }
    }
  }
  for (const unit of Object.values(plan.units)) {
    for (const seamId of unit.seamRefs) {
      const seam = plan.seams[seamId];
      if (seam === undefined) {
        out.push(finding("unit_seam_unresolved", `Unit ${unit.id} references missing seam ${seamId}.`, unit.id));
      } else if (seam.producerUnitId !== unit.id && !seam.consumerUnitIds.includes(unit.id)) {
        out.push(finding(
          "unit_seam_participant_mismatch",
          `Unit ${unit.id} references seam ${seamId} without participating in it.`,
          unit.id
        ));
      }
    }
  }
}

function verifyResources(
  plan: SemanticPlan,
  goal: GoalContract,
  view: RepositoryView,
  out: PlanningFinding[]
): void {
  const claims = Object.values(plan.units).flatMap((unit) => unit.resourceIntents.map((intent) => ({ unit, intent })));
  for (const unit of Object.values(plan.units)) {
    const surfaceResourceIds = new Set<string>();
    for (const resourceRef of unit.repositorySurface.resourceRefs) {
      const resolved = view.catalog.resolve(resourceRef);
      if (resolved.state !== "known") {
        out.push(finding(
          "repository_surface_resource_unresolved",
          `Repository surface ${resourceRef} for ${unit.id} is ${resolved.state}.`,
          unit.id
        ));
      } else {
        surfaceResourceIds.add(resolved.resource.id);
      }
    }
    for (const intent of unit.resourceIntents) {
      const resolved = view.catalog.resolve(intent.resourceId);
      if (resolved.state === "known" && !surfaceResourceIds.has(resolved.resource.id)) {
        out.push(finding(
          "resource_intent_outside_surface",
          `Resource intent ${intent.resourceId} is outside the declared surface of ${unit.id}.`,
          unit.id
        ));
      }
    }
  }
  for (const { unit, intent } of claims) {
    const resolved = view.catalog.resolve(intent.resourceId);
    if (resolved.state !== "known") {
      out.push(finding("resource_unresolved", `Resource ${intent.resourceId} is ${resolved.state}.`, unit.id));
      continue;
    }
    if (intent.access === "modify" && resolved.resource.generated.state === "generated") {
      out.push(finding("generated_resource_write", `Unit ${unit.id} writes generated resource ${intent.resourceId}.`, unit.id, resolved.evidenceRefs));
    }
    if (intent.access === "modify" && resolved.resource.generated.state === "unknown") {
      out.push(repositoryWarning(
        "resource_generated_state_unknown",
        `Unit ${unit.id} cannot safely write resource ${intent.resourceId} because its generated-file disposition is unknown.`,
        resolved.evidenceRefs
      ));
    }
    if (intent.access === "modify" && plan.artifacts[intent.outputArtifactId] === undefined) {
      out.push(finding("resource_output_missing", `Write ${intent.resourceId} has no output artifact.`, unit.id));
    }
    if (intent.inputArtifactId !== undefined && !unit.consumes.includes(intent.inputArtifactId)) {
      out.push(finding("resource_input_unordered", `Resource input ${intent.inputArtifactId} is not consumed by ${unit.id}.`, unit.id));
    }
    if (intent.inputArtifactId !== undefined) {
      const inputArtifact = plan.artifacts[intent.inputArtifactId];
      const predecessor = inputArtifact === undefined ? undefined : plan.units[inputArtifact.producerUnitId];
      const hasOverlappingWriter = predecessor?.resourceIntents.some((candidate) =>
        candidate.access === "modify" &&
        candidate.outputArtifactId === intent.inputArtifactId &&
        view.catalog.overlaps(candidate.resourceId, intent.resourceId) === "yes"
      ) ?? false;
      if (!hasOverlappingWriter) {
        out.push(finding(
          "resource_input_predecessor_mismatch",
          `Resource input ${intent.inputArtifactId} is not a predecessor version of ${intent.resourceId}.`,
          unit.id
        ));
      }
    }
  }
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex]!;
      const right = claims[rightIndex]!;
      if (left.intent.access !== "modify" && right.intent.access !== "modify") continue;
      if (view.catalog.overlaps(left.intent.resourceId, right.intent.resourceId) === "unknown") {
        out.push(finding(
          "resource_overlap_unknown",
          `Resource overlap for ${left.unit.id} and ${right.unit.id} is unknown.`
        ));
      }
    }
  }
  const writers = claims.filter((claim): claim is ModifyResourceIntentClaim => claim.intent.access === "modify");
  for (let leftIndex = 0; leftIndex < writers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < writers.length; rightIndex += 1) {
      const left = writers[leftIndex]!;
      const right = writers[rightIndex]!;
      const overlap = view.catalog.overlaps(left.intent.resourceId, right.intent.resourceId);
      if (
        overlap === "yes" && !orderedByResourceVersions(writers, view, left, right)
      ) {
        out.push(finding("resource_double_writer", `Writers ${left.unit.id} and ${right.unit.id} are not artifact-ordered.`));
      }
    }
  }
  const protectedPaths = goal.acceptanceCriteria.flatMap(({ protectedReferences }) => protectedReferences)
    .filter((reference) => reference.startsWith("path:"))
    .map((reference) => reference.slice("path:".length));
  for (const { unit, intent } of claims) {
    if (intent.access !== "modify") continue;
    const resolved = view.catalog.resolve(intent.resourceId);
    const catalogPaths = resolved.state === "known" ? resourcePaths(resolved.resource) : [];
    for (const path of [...unit.repositorySurface.pathHints, ...catalogPaths]) {
      if (protectedPaths.some((protectedPath) => pathsOverlap(path, protectedPath))) {
        out.push(finding("protected_path_write", `Unit ${unit.id} writes protected path ${path}.`, unit.id));
      }
    }
  }
}

type ModifyResourceIntentClaim = {
  unit: WorkUnit;
  intent: Extract<WorkUnit["resourceIntents"][number], { access: "modify" }>;
};

function orderedByResourceVersions(
  claims: readonly ModifyResourceIntentClaim[],
  view: RepositoryView,
  left: ModifyResourceIntentClaim,
  right: ModifyResourceIntentClaim
): boolean {
  return resourceVersionReachable(claims, view, left, right) || resourceVersionReachable(claims, view, right, left);
}

function resourceVersionReachable(
  claims: readonly ModifyResourceIntentClaim[],
  view: RepositoryView,
  from: ModifyResourceIntentClaim,
  target: ModifyResourceIntentClaim
): boolean {
  const pending = [from];
  const visited = new Set<ModifyResourceIntentClaim>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...claims.filter((candidate) =>
      candidate.intent.inputArtifactId === current.intent.outputArtifactId &&
      view.catalog.overlaps(current.intent.resourceId, candidate.intent.resourceId) === "yes"
    ));
  }
  return false;
}

function resourcePaths(resource: { path?: string; canonicalLocator: string }): string[] {
  const paths = resource.path === undefined ? [] : [resource.path];
  const locator = resource.canonicalLocator;
  if (locator.startsWith("path:")) paths.push(locator.slice("path:".length));
  if (locator.startsWith("module:")) paths.push(locator.slice("module:".length));
  if (locator.startsWith("symbol:")) paths.push(locator.slice("symbol:".length).split("#", 1)[0]!);
  if (locator.startsWith("package:")) paths.push(locator.slice("package:".length));
  const normalized = [...new Set(paths.map(normalizePath))];
  const named = normalized.filter((path) => path !== "" && path !== ".");
  if (named.length > 0) return named;
  // A package rooted at the repository is catalogued as `package:.` with an
  // empty path, and "." is a prefix of nothing. Dropping both left such a
  // package owning no path at all, so in a single-package repository no
  // resource could authorize writing a file that does not exist yet. The
  // repository root is the empty path, which `pathIsWithin` reads as containing
  // everything.
  return normalized.length > 0 ? [""] : [];
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`);
}

function pathIsWithin(candidate: string, surface: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedSurface = normalizePath(surface);
  if (normalizedSurface === "") return true;
  return normalizedCandidate === normalizedSurface || normalizedCandidate.startsWith(`${normalizedSurface}/`);
}

function resourceOwnsPath(
  resource: { path?: string; canonicalLocator: string; gitEntryKind?: string | undefined },
  candidate: string
): boolean {
  return resourcePaths(resource).some((resourcePath) => resource.gitEntryKind === undefined
    ? pathIsWithin(candidate, resourcePath)
    : normalizePath(candidate) === resourcePath
  );
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function verifyPaths(plan: SemanticPlan, out: PlanningFinding[]): void {
  for (const unit of Object.values(plan.units)) {
    for (const path of unit.repositorySurface.pathHints) {
      if (!validCompiledPath(path)) {
        out.push(finding(
          "repository_path_invalid",
          `Unit ${unit.id} has unsafe or empty repository path ${JSON.stringify(path)}.`,
          unit.id
        ));
      }
    }
  }
  for (const artifact of Object.values(plan.artifacts)) {
    for (const path of artifact.expectedPaths) {
      if (!validCompiledPath(path)) {
        out.push(finding(
          "artifact_path_invalid",
          `Artifact ${artifact.id} has unsafe or empty expected path ${JSON.stringify(path)}.`,
          artifact.id
        ));
      }
    }
  }
}

function validCompiledPath(path: string): boolean {
  return RepoRelativePathSchema.safeParse(normalizePath(path)).success;
}

function scopeContributors(plan: SemanticPlan, unit: WorkUnit): WorkUnit[] {
  if (hasDeclaredScope(unit)) return [unit];
  const contributors: WorkUnit[] = [];
  const pending = Object.values(plan.units).filter(({ parentId }) => parentId === unit.id);
  const visited = new Set<string>([unit.id]);
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    if (visited.has(candidate.id)) continue;
    visited.add(candidate.id);
    if (hasDeclaredScope(candidate)) {
      contributors.push(candidate);
    } else {
      pending.push(...Object.values(plan.units).filter(({ parentId }) => parentId === candidate.id));
    }
  }
  return contributors;
}

function hasDeclaredScope(unit: WorkUnit): boolean {
  return unit.repositorySurface.resourceRefs.length > 0 || unit.repositorySurface.pathHints.length > 0;
}

function verifyCoverage(view: RepositoryView, out: PlanningFinding[]): void {
  if (view.model.coverage !== undefined && view.model.coverage.disposition !== "known") {
    out.push(repositoryWarning(
      "repository_model_coverage_incomplete",
      `Repository model coverage is ${view.model.coverage.disposition}.`,
      view.model.coverage.evidenceRefs
    ));
  }
  if (view.catalog.coverage.state !== "known") {
    out.push(repositoryWarning(
      "resource_catalog_coverage_incomplete",
      `Resource catalog coverage is ${view.catalog.coverage.state}.`,
      view.catalog.coverage.evidenceRefs
    ));
  }
}

function verifyEvidence(plan: SemanticPlan, view: RepositoryView, out: PlanningFinding[]): void {
  const evidenceById = new Map<string, SemanticPlan["evidence"][number]>();
  const repositoryEvidenceById = new Map((view.model.evidence ?? []).map((evidence) => [evidence.id, evidence]));
  for (const evidence of plan.evidence) {
    if (evidenceById.has(evidence.id)) {
      out.push(finding("evidence_id_duplicate", `Evidence ${evidence.id} is declared more than once.`, evidence.id));
    }
    evidenceById.set(evidence.id, evidence);
    const repositoryEvidence = repositoryEvidenceById.get(evidence.id);
    if (repositoryEvidence === undefined || canonicalJson(repositoryEvidence) !== canonicalJson(evidence)) {
      out.push(finding(
        "evidence_repository_mismatch",
        `Evidence ${evidence.id} does not exactly match the RepositoryView evidence record.`,
        evidence.id
      ));
    }
    if (evidence.snapshotId !== plan.repositorySnapshot.id) {
      out.push(finding(
        "evidence_snapshot_mismatch",
        `Evidence ${evidence.id} belongs to snapshot ${evidence.snapshotId}, not ${plan.repositorySnapshot.id}.`,
        evidence.id
      ));
    }
  }
  const evidenceUsers = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "evidence"));
  for (const evidenceRef of collectEvidenceRefs(evidenceUsers)) {
    if (!evidenceById.has(evidenceRef)) {
      out.push(finding(
        "evidence_ref_unresolved",
        `Evidence reference ${evidenceRef} is not embedded in the SemanticPlan.`,
        evidenceRef
      ));
    }
  }
}

function collectEvidenceRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (key === "evidenceRefs" && Array.isArray(nested)) {
        for (const ref of nested) if (typeof ref === "string") refs.add(ref);
      } else {
        visit(nested);
      }
    }
  };
  visit(value);
  return [...refs].sort((left, right) => left.localeCompare(right));
}

function rootCriterionFor(plan: SemanticPlan, unit: WorkUnit, criterionId: string): string {
  let current: WorkUnit | undefined = unit;
  let currentCriterion = criterionId;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    const refinement = current.criteria.find(({ criterionId: id }) => id === currentCriterion);
    if (refinement === undefined) return currentCriterion;
    currentCriterion = refinement.sourceCriterionId;
    current = current.parentId === undefined ? undefined : plan.units[current.parentId];
  }
  return currentCriterion;
}

function isStrictDescendant(plan: SemanticPlan, unitId: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  let current = plan.units[unitId];
  while (current?.parentId !== undefined && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = plan.units[current.parentId];
  }
  return false;
}

function detectCycle(ids: readonly string[], edges: (id: string) => readonly string[], onCycle: () => void): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (edges(id).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (ids.some(visit)) onCycle();
}

function result(findings: PlanningFinding[]): PlanVerificationResult {
  const unique = [...new Map(findings.map((item) => [`${item.code}\0${item.subjectId ?? ""}\0${item.message}`, item])).values()]
    .sort((left, right) => `${left.code}\0${left.subjectId ?? ""}\0${left.message}`.localeCompare(`${right.code}\0${right.subjectId ?? ""}\0${right.message}`));
  return { ok: !unique.some(({ severity }) => severity === "error"), findings: unique };
}

function finding(code: string, message: string, subjectId?: string, evidenceRefs: readonly string[] = []): PlanningFinding {
  return {
    code,
    severity: "error",
    authority: "deterministic",
    message,
    ...(subjectId === undefined ? {} : { subjectId }),
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    resolution: "none"
  };
}

function repositoryWarning(code: string, message: string, evidenceRefs: readonly string[]): PlanningFinding {
  return {
    code,
    severity: "warning",
    authority: "repository",
    message,
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    resolution: "none"
  };
}
