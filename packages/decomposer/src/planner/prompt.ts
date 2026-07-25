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
  return {
    system: [
      "You are the semantic Planner for a software implementation system.",
      "Produce a grounded WorkBreakdown, not an executable graph.",
      "A leaf is a cohesive independently verifiable increment and may be a hybrid vertical slice across UI, API, domain, and tests.",
      "Justify composite cuts by cohesion, integration, risk, or verifiability.",
      "Do not target a fixed depth, child count, or layer template.",
      "Do not emit worktrees, exact commands, executor profiles, or generic dependency edges.",
      "Propose artifact and seam candidates only when their producer, consumers, purpose, and evidence are explicit.",
      "Raise a human question only when the answer changes behavior, architecture, scope, risk, or acceptance.",
      "Existing repository paths must be cited through path evidence. Files that a unit will create must be declared in plannedPaths and are not repository evidence.",
      "Every leaf must either cite existing path evidence or declare at least one concrete planned path.",
      "If an outcome adds or changes a package script, dependency, build, test, typecheck, lint, or workspace command, cite the relevant package manifest path evidence in the implementing unit so that configuration is inside its executable scope.",
      "Acceptance intents are a fidelity boundary. Preserve declared Contract, Protocol, or Schema sections verbatim in an acceptance intent; never flatten nested fields, rename literals, or weaken exact formats and thresholds.",
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
      granularityFeedback
    ].join("\n")
  };
}

const WORK_BREAKDOWN_OUTPUT_SHAPE = `{
  "schemaVersion": 2,
  "breakdownId": "semantic-id",
  "objective": "observable outcome",
  "repositorySnapshotId": "the supplied snapshot id",
  "acceptanceIntents": [{ "id": "intent-id", "description": "...", "required": true }],
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
  "repositoryEvidence": [{ "id": "...", "kind": "path|symbol|script|stack|diagnostic", "reference": "...", "observation": "...", "confidence": 0.0 }],
  "uncertainties": [{ "id": "...", "description": "...", "impact": "...", "requiresHumanDecision": true, "evidenceIds": ["..."] }],
  "questions": [{ "id": "...", "question": "...", "reason": "...", "impact": "behavior|architecture|scope|risk|acceptance", "options": ["...", "..."], "evidenceIds": ["..."] }]
}`;
