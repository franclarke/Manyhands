import type { WorkBreakdownPlannerInput } from "./work-breakdown.js";

export interface WorkBreakdownPrompt {
  system: string;
  user: string;
}

export function buildWorkBreakdownPrompt(input: WorkBreakdownPlannerInput): WorkBreakdownPrompt {
  const evidence = input.repositorySnapshot.evidence
    .map((item) => `- ${item.id} [${item.kind}] ${item.reference}: ${item.observation} (confidence ${item.confidence})`)
    .join("\n");
  const resolvedDecisions = Object.entries(input.questionAnswers ?? {})
    .map(([questionId, answer]) => `- ${questionId}: ${answer}`)
    .join("\n");
  const granularityFeedback = input.granularityFeedback === undefined
    ? "- none"
    : [
        `Granularity replan feedback for ${input.granularityFeedback.unitKey}:`,
        `- reason: ${input.granularityFeedback.reason}`,
        ...input.granularityFeedback.evidence.map((item) => `- evidence: ${item}`)
      ].join("\n");
  const candidateSetFeedback = input.candidateSetFeedback === undefined
    ? "- none"
    : [
        "The previous candidate set was rejected. Address these concrete findings in every new candidate:",
        ...input.candidateSetFeedback.rejectedCandidateIds.map((id) => `- rejected candidate: ${id}`),
        ...input.candidateSetFeedback.diagnostics.map((diagnostic) => `- finding: ${diagnostic}`)
      ].join("\n");
  const planningEnvelope = input.planningEnvelope === undefined
    ? "- none"
    : [
        `Policy ${input.planningEnvelope.policyVersion} requests ${input.planningEnvelope.candidateBudget.minimum}-${input.planningEnvelope.candidateBudget.maximum} semantic candidates.`,
        `Leaf budgets: contextTokens<=${input.planningEnvelope.executionBudget.maxLeafContextTokens}, scopePaths<=${input.planningEnvelope.executionBudget.maxLeafScopePaths}, plannedPaths<=${input.planningEnvelope.executionBudget.maxLeafPlannedPaths}, parallelism<=${input.planningEnvelope.executionBudget.maxParallelism}.`,
        "Acceptance ownership: local intents belong to one proving leaf; seam intents name the seam and its integration owner; global intents remain only on their integration composite.",
        "Hard gates: acceptance_owner, cross_leaf_materialization, local_validation, compiler_approvable."
      ].join("\n");
  const candidateRequest = input.candidateRequest === undefined
    ? "- single candidate"
    : [
        `Candidate ${input.candidateRequest.index} of ${input.candidateRequest.total}.`,
        input.candidateRequest.priorCandidateHashes.length === 0
          ? "No prior candidate exists."
          : `Do not reproduce prior candidate hashes: ${input.candidateRequest.priorCandidateHashes.join(", ")}.`,
        "Propose a genuinely different semantic cut or return the best cohesive single leaf; do not reshuffle paths to appear different."
      ].join("\n");
  return {
    system: [
      "You are the semantic Planner for a software implementation system.",
      "Produce a grounded WorkBreakdown, not an executable graph.",
      "Follow the Granularity Planning Brief before proposing units; the deterministic policy and Graph Compiler own final eligibility and selection.",
      "A leaf is a cohesive independently verifiable increment and may be a hybrid vertical slice across UI, API, domain, and tests.",
      "Justify composite cuts by cohesion, integration, risk, or verifiability.",
      "Do not target a fixed depth, child count, or layer template.",
      "Do not emit worktrees, exact commands, executor profiles, or generic dependency edges.",
      "Propose artifact and seam candidates only when their producer, consumers, purpose, and evidence are explicit.",
      "The producer owns or provides the named contract or output; a consumer imports, calls, or uses it. Do not reverse this direction just because the producer consumes a different artifact from the same unit.",
      "When a type or state contract crosses executable leaves, pair it with a materialized files or commit artifact for every consumer that compiles against producer code; a logical artifact alone is insufficient for execution ordering.",
      "A logical artifact must not be the only relation ordering a consumer that compiles against producer code. Use logical only for facts that do not require the consumer to see producer files or exported implementation state.",
      "Do not name one of a command unit's own dependencies as a consumer of that command. If no unit inside the breakdown consumes a command or API, omit that seam.",
      "Every candidate artifact and seam must name at least one consumer unit key. A candidate whose only consumer would be its own producer, or which has no consumer yet, is not a relation: omit it entirely rather than emitting an empty consumerUnitKeys array.",
      "Raise a human question only when the answer changes behavior, architecture, scope, risk, or acceptance.",
      "Existing repository paths must be cited through path evidence. Files that a unit will create must be declared in plannedPaths and are not repository evidence.",
      "The test is whether the file exists in the snapshot, not whether you will write to it. A file you will modify, extend, or rewrite already exists, so cite it as path evidence; plannedPaths is only for paths absent from the snapshot. Editing an existing package.json, tsconfig, or lockfile is evidence, never a planned path.",
      "Every leaf must either cite existing path evidence or declare at least one concrete planned path.",
      "When a leaf declares tests and an expected outcome says tests or test coverage, it must cite an exact existing test path or declare the new test file in plannedPaths; a source file is not test evidence.",
      "If an outcome adds or changes a package script, dependency, build, test, typecheck, lint, or workspace command, cite the relevant package manifest path evidence in the implementing unit so that configuration is inside its executable scope.",
      "Acceptance intents are a fidelity boundary. Preserve declared Contract, Protocol, or Schema sections verbatim in an acceptance intent; never flatten nested fields, rename literals, or weaken exact formats and thresholds.",
      "Assign every acceptance intent exactly once in acceptanceOwnership as local, seam, or global. A global intent stays on its integration composite and must not be copied into leaves. A seam intent names seamId and its integration owner.",
      "Specify every candidate seam once in seamSpecifications. Use delivery=contract_only only when consumers can implement against the frozen contract; use producer_files when they compile, import, or call producer implementation, and then declare a materialized artifact for every consumer.",
      "For every unit, estimate complexitySignals as 0-10 magnitudes: scopeRadius (breadth of affected files/modules), interfaceImpact (exported contracts or public APIs touched), validationSurface (validation obligations and suites needed), contextTokenMass (code context an agent must hold). Signals are evidence, not decisions: a deterministic policy owns the final leaf/composite boundary and will clamp signals inconsistent with the unit's declared paths.",
      "As soon as you decide each unit, emit one compact JSON line before the final document: {\"type\":\"planning.node\",\"unit\":{\"key\":\"...\",\"parentKey\":null,\"kind\":\"composite|leaf\",\"title\":\"...\",\"objective\":\"...\",\"siblingIndex\":0,\"siblingCount\":1}}.",
      "Emit planning.node lines in parent-first order. Then emit the complete schema-valid WorkBreakdown JSON. Never invent repository evidence.",
      "Resolved human decisions are authoritative requirements. Incorporate them into the WorkBreakdown and do not ask the same question again.",
      "Revise the semantic cut when granularity feedback is supplied. Preserve the objective and acceptance intents, and propose at least two cohesive children only when the evidence supports a real boundary.",
      "Never partition a task by mechanically distributing paths. A path list is evidence of scope, not a semantic decomposition.",
      "Required JSON shape:",
      WORK_BREAKDOWN_OUTPUT_SHAPE
    ].join("\n"),
    user: [
      `Goal: ${input.goal}`,
      `Acceptance: ${input.acceptanceCriteria.join(" | ")}`,
      `Constraints: ${input.constraints.join(" | ") || "none"}`,
      `Ground against repository snapshot ${input.repositorySnapshot.snapshotId} (${input.repositorySnapshot.inspectionDisposition}).`,
      "Repository evidence:",
      evidence || "- none; mark uncertainty explicitly",
      "Resolved human decisions:",
      resolvedDecisions || "- none",
      "Granularity feedback:",
      granularityFeedback,
      "Candidate-set feedback:",
      candidateSetFeedback,
      "Granularity Planning Brief:",
      planningEnvelope,
      "Candidate request:",
      candidateRequest
    ].join("\n")
  };
}

const WORK_BREAKDOWN_OUTPUT_SHAPE = `{
  "schemaVersion": 2,
  "breakdownId": "semantic-id",
  "objective": "observable outcome",
  "repositorySnapshotId": "the supplied snapshot id",
  "acceptanceIntents": [{ "id": "intent-id", "description": "...", "required": true }],
  "acceptanceOwnership": [{ "intentId": "intent-id", "ownerUnitKey": "leaf-or-composite-key", "role": "local|seam|global", "seamId": "required-only-for-seam-role", "rationale": "..." }],
  "root": {
    "key": "semantic-unit-key", "kind": "composite", "title": "...", "objective": "...",
    "concerns": ["cohesive concern"], "expectedOutcomes": ["..."], "acceptanceIntentIds": ["intent-id"], "evidenceIds": ["repository-evidence-id"], "plannedPaths": ["src/new-file.ts"],
    "complexitySignals": { "scopeRadius": 0.0, "interfaceImpact": 0.0, "validationSurface": 0.0, "contextTokenMass": 0.0, "rationale": "optional short justification" },
    "cut": { "criterion": "cohesion|integration|risk|verifiability", "rationale": "..." },
    "children": [
      { "key": "leaf-key", "kind": "leaf", "title": "...", "objective": "...", "concerns": ["ui", "api", "tests"], "expectedOutcomes": ["..."], "acceptanceIntentIds": ["intent-id"], "evidenceIds": ["repository-evidence-id"], "plannedPaths": ["src/new-file.ts"], "complexitySignals": { "scopeRadius": 0.0, "interfaceImpact": 0.0, "validationSurface": 0.0, "contextTokenMass": 0.0 } }
    ]
  },
  "candidateArtifacts": [{ "id": "...", "artifactType": "...", "producerUnitKey": "...", "consumerUnitKeys": ["..."], "purpose": "...", "materializationHint": "logical|files|manifest|commit", "evidenceIds": ["..."] }],
  "candidateSeams": [{ "id": "...", "kind": "api|type|event|data|ui|command", "specification": "...", "producerUnitKey": "...", "consumerUnitKeys": ["..."], "evidenceIds": ["..."] }],
  "seamSpecifications": [{ "seamId": "...", "delivery": "contract_only|producer_files", "compatibility": "...", "validation": "..." }],
  "repositoryEvidence": [{ "id": "...", "kind": "path|symbol|script|stack|diagnostic", "reference": "...", "observation": "...", "confidence": 0.0 }],
  "uncertainties": [{ "id": "...", "description": "...", "impact": "...", "requiresHumanDecision": true, "evidenceIds": ["..."] }],
  "questions": [{ "id": "...", "question": "...", "reason": "...", "impact": "behavior|architecture|scope|risk|acceptance", "options": ["...", "..."], "evidenceIds": ["..."] }]
}`;
