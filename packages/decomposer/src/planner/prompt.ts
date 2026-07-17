import type { WorkBreakdownPlannerInput } from "./work-breakdown.js";

export interface WorkBreakdownPrompt {
  system: string;
  user: string;
}

export function buildWorkBreakdownPrompt(input: WorkBreakdownPlannerInput): WorkBreakdownPrompt {
  const evidence = input.repositorySnapshot.evidence
    .map((item) => `- ${item.id} [${item.kind}] ${item.reference}: ${item.observation} (confidence ${item.confidence})`)
    .join("\n");
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
      "Never invent repository evidence. Return only schema-valid JSON.",
      "Required JSON shape:",
      WORK_BREAKDOWN_OUTPUT_SHAPE
    ].join("\n"),
    user: [
      `Goal: ${input.goal}`,
      `Acceptance: ${input.acceptanceCriteria.join(" | ")}`,
      `Constraints: ${input.constraints.join(" | ") || "none"}`,
      `Ground against repository snapshot ${input.repositorySnapshot.snapshotId} (${input.repositorySnapshot.inspectionDisposition}).`,
      "Repository evidence:",
      evidence || "- none; mark uncertainty explicitly"
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
    "concerns": ["cohesive concern"], "expectedOutcomes": ["..."], "acceptanceIntentIds": ["intent-id"],
    "cut": { "criterion": "cohesion|integration|risk|verifiability", "rationale": "..." },
    "children": [
      { "key": "leaf-key", "kind": "leaf", "title": "...", "objective": "...", "concerns": ["ui", "api", "tests"], "expectedOutcomes": ["..."], "acceptanceIntentIds": ["intent-id"] }
    ]
  },
  "candidateArtifacts": [{ "id": "...", "artifactType": "...", "producerUnitKey": "...", "consumerUnitKeys": ["..."], "purpose": "...", "materializationHint": "logical|files|manifest|commit", "evidenceIds": ["..."] }],
  "candidateSeams": [{ "id": "...", "kind": "api|type|event|data|ui|command", "specification": "...", "producerUnitKey": "...", "consumerUnitKeys": ["..."], "evidenceIds": ["..."] }],
  "repositoryEvidence": [{ "id": "...", "kind": "path|symbol|script|stack|diagnostic", "reference": "...", "observation": "...", "confidence": 0.0 }],
  "uncertainties": [{ "id": "...", "description": "...", "impact": "...", "requiresHumanDecision": true, "evidenceIds": ["..."] }],
  "questions": [{ "id": "...", "question": "...", "reason": "...", "impact": "behavior|architecture|scope|risk|acceptance", "options": ["...", "..."], "evidenceIds": ["..."] }]
}`;
