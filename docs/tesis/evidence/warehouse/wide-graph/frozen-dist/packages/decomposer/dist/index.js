import "./chunk-6SJVMHOW.js";

// src/index.ts
import {
  AgentTaskContractSchema
} from "@manyhands/contracts";
import { EntityIdSchema as EntityIdSchema2, IsoTimestampSchema, NonEmptyStringSchema as NonEmptyStringSchema3, uniqueValues as uniqueValues2 } from "@manyhands/shared";
import {
  getLeafNodes,
  TaskGraphSchema,
  validateTaskGraph as validateTaskGraph2
} from "@manyhands/task-graph";

// src/scope.ts
function executionScopeFromAllowed(allowedPaths) {
  return {
    implementationPaths: allowedPaths,
    testPaths: [],
    configPaths: []
  };
}

// src/llm/recursive/step-schema.ts
import { z } from "zod";
import { validationCommandSafetyIssues } from "@manyhands/contracts";
var StepInterfaceSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "interface id must start with a letter and be alphanumeric/underscore"),
  kind: z.union([z.literal("type"), z.literal("function"), z.literal("module")]),
  signature: z.string().min(1).max(2e3),
  description: z.string().min(1).max(600)
});
var StepChildSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/, "id must be lowercase, start with a letter, and contain only [a-z0-9_-]"),
  title: z.string().min(1).max(160),
  goal: z.string().min(1).max(600),
  kind: z.union([z.literal("composite"), z.literal("leaf")]).optional(),
  /** Interface ids (from sharedInterfaces or inherited) this child builds against. */
  consumes: z.array(z.string().min(1)).max(40).default([]),
  /** Interface ids this child must expose. */
  produces: z.array(z.string().min(1)).max(40).default([])
});
var StepDependencySchema = z.object({
  fromTaskId: z.string().min(1),
  toTaskId: z.string().min(1),
  type: z.union([z.literal("contractual"), z.literal("structural"), z.literal("logical")]),
  rationale: z.string().max(400).optional()
});
var StepValidationCommandSchema = z.object({
  command: z.string().min(1).max(200),
  args: z.array(z.string()).max(40).default([])
}).superRefine((value, ctx) => {
  for (const issue of validationCommandSafetyIssues(value.command, value.args)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unsafe validation command: ${issue}` });
  }
});
var AtomicStepSchema = z.object({
  decision: z.literal("atomic"),
  reasoning: z.string().min(1).max(1600),
  allowedPaths: z.array(z.string().min(1)).max(60).default([]),
  forbiddenPaths: z.array(z.string().min(1)).max(60).default([]),
  expectedFiles: z.array(z.string().min(1)).max(60).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(400)).min(1).max(20),
  leafValidationCommands: z.array(StepValidationCommandSchema).max(20).default([])
});
var DecomposeStepSchema = z.object({
  decision: z.literal("decompose"),
  reasoning: z.string().min(1).max(1600),
  sharedInterfaces: z.array(StepInterfaceSchema).max(40).default([]),
  children: z.array(StepChildSchema).min(2).max(12),
  dependencies: z.array(StepDependencySchema).max(60).default([]),
  parentValidationCommands: z.array(StepValidationCommandSchema).max(20).default([])
});
var QuestionStepSchema = z.object({
  decision: z.literal("question"),
  reasoning: z.string().min(1).max(1600),
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(240)).min(2).max(10)
});
var DecomposeStepOutputSchema = z.discriminatedUnion("decision", [
  AtomicStepSchema,
  DecomposeStepSchema,
  QuestionStepSchema
]);

// src/index.ts
import { z as z5 } from "zod";

// src/planner/prompt.ts
function buildWorkBreakdownPrompt(input) {
  const evidence = input.repositorySnapshot.evidence.map((item) => `- ${item.id} [${item.kind}] ${item.reference}: ${item.observation} (confidence ${item.confidence})`).join("\n");
  const resolvedDecisions = Object.entries(input.questionAnswers ?? {}).map(([questionId, answer]) => `- ${questionId}: ${answer}`).join("\n");
  const granularityFeedback = input.granularityFeedback === void 0 ? "- none" : [
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
      "The producer owns or provides the named contract or output; a consumer imports, calls, or uses it. Do not reverse this direction just because the producer consumes a different artifact from the same unit.",
      "Do not name one of a command unit's own dependencies as a consumer of that command. If no unit inside the breakdown consumes a command or API, omit that seam.",
      "Every candidate artifact and seam must name at least one consumer unit key. A candidate whose only consumer would be its own producer, or which has no consumer yet, is not a relation: omit it entirely rather than emitting an empty consumerUnitKeys array.",
      "Raise a human question only when the answer changes behavior, architecture, scope, risk, or acceptance.",
      "Existing repository paths must be cited through path evidence. Files that a unit will create must be declared in plannedPaths and are not repository evidence.",
      "The test is whether the file exists in the snapshot, not whether you will write to it. A file you will modify, extend, or rewrite already exists, so cite it as path evidence; plannedPaths is only for paths absent from the snapshot. Editing an existing package.json, tsconfig, or lockfile is evidence, never a planned path.",
      "Every leaf must either cite existing path evidence or declare at least one concrete planned path.",
      "If an outcome adds or changes a package script, dependency, build, test, typecheck, lint, or workspace command, cite the relevant package manifest path evidence in the implementing unit so that configuration is inside its executable scope.",
      "Acceptance intents are a fidelity boundary. Preserve declared Contract, Protocol, or Schema sections verbatim in an acceptance intent; never flatten nested fields, rename literals, or weaken exact formats and thresholds.",
      "For every unit, estimate complexitySignals as 0-10 magnitudes: scopeRadius (breadth of affected files/modules), interfaceImpact (exported contracts or public APIs touched), validationSurface (validation obligations and suites needed), contextTokenMass (code context an agent must hold). Signals are evidence, not decisions: a deterministic policy owns the final leaf/composite boundary and will clamp signals inconsistent with the unit's declared paths.",
      'As soon as you decide each unit, emit one compact JSON line before the final document: {"type":"planning.node","unit":{"key":"...","parentKey":null,"kind":"composite|leaf","title":"...","objective":"...","siblingIndex":0,"siblingCount":1}}.',
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
var WORK_BREAKDOWN_OUTPUT_SHAPE = `{
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

// src/planner/schema.ts
import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z as z2 } from "zod";
var PlanningArchitectureVersionSchema = z2.enum(["v1", "v2"]);
var SemanticCutSchema = z2.object({
  criterion: z2.enum(["cohesion", "integration", "risk", "verifiability"]),
  rationale: NonEmptyStringSchema
}).strict();
var ComplexitySignalsSchema = z2.object({
  scopeRadius: z2.number().min(0).max(10),
  interfaceImpact: z2.number().min(0).max(10),
  validationSurface: z2.number().min(0).max(10),
  contextTokenMass: z2.number().min(0).max(10),
  rationale: NonEmptyStringSchema.optional()
}).strict();
var WorkUnitCommonShape = {
  key: EntityIdSchema,
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  concerns: z2.array(NonEmptyStringSchema).min(1),
  expectedOutcomes: z2.array(NonEmptyStringSchema).min(1),
  acceptanceIntentIds: z2.array(EntityIdSchema).min(1),
  evidenceIds: z2.array(EntityIdSchema),
  plannedPaths: z2.array(RepoRelativePathSchema).optional(),
  complexitySignals: ComplexitySignalsSchema.optional()
};
var WorkUnitLeafSchema = z2.object({
  ...WorkUnitCommonShape,
  kind: z2.literal("leaf")
}).strict();
var WorkUnitSchema = z2.lazy(() => z2.union([
  WorkUnitLeafSchema,
  z2.object({
    ...WorkUnitCommonShape,
    kind: z2.literal("composite"),
    cut: SemanticCutSchema,
    children: z2.array(WorkUnitSchema).min(1)
  }).strict()
]));
var AcceptanceIntentSchema = z2.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  required: z2.boolean()
}).strict();
var RepositoryEvidenceSchema = z2.object({
  id: EntityIdSchema,
  kind: z2.enum(["path", "symbol", "script", "stack", "diagnostic"]),
  reference: NonEmptyStringSchema,
  observation: NonEmptyStringSchema,
  confidence: z2.number().min(0).max(1)
}).strict();
var CandidateArtifactSchema = z2.object({
  id: EntityIdSchema,
  artifactType: NonEmptyStringSchema,
  producerUnitKey: EntityIdSchema,
  consumerUnitKeys: z2.array(EntityIdSchema).min(1),
  purpose: NonEmptyStringSchema,
  materializationHint: z2.enum(["logical", "files", "manifest", "commit"]),
  evidenceIds: z2.array(EntityIdSchema).default([])
}).strict();
var CandidateSeamSchema = z2.object({
  id: EntityIdSchema,
  kind: z2.enum(["api", "type", "event", "data", "ui", "command"]),
  specification: NonEmptyStringSchema,
  producerUnitKey: EntityIdSchema,
  consumerUnitKeys: z2.array(EntityIdSchema).min(1),
  evidenceIds: z2.array(EntityIdSchema).default([])
}).strict();
var WorkUncertaintySchema = z2.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  impact: NonEmptyStringSchema,
  requiresHumanDecision: z2.boolean(),
  evidenceIds: z2.array(EntityIdSchema).default([])
}).strict();
var WorkQuestionSchema = z2.object({
  id: EntityIdSchema,
  question: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
  impact: z2.enum(["behavior", "architecture", "scope", "risk", "acceptance"]),
  options: z2.array(NonEmptyStringSchema).min(2),
  evidenceIds: z2.array(EntityIdSchema).default([])
}).strict();
var WorkBreakdownSchema = z2.object({
  schemaVersion: z2.literal(2),
  breakdownId: EntityIdSchema,
  objective: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  acceptanceIntents: z2.array(AcceptanceIntentSchema).min(1),
  root: WorkUnitSchema,
  candidateArtifacts: z2.array(CandidateArtifactSchema).default([]),
  candidateSeams: z2.array(CandidateSeamSchema).default([]),
  repositoryEvidence: z2.array(RepositoryEvidenceSchema).default([]),
  uncertainties: z2.array(WorkUncertaintySchema).default([]),
  questions: z2.array(WorkQuestionSchema).default([])
}).strict().superRefine((breakdown, context) => {
  const units = flattenUnits(breakdown.root);
  checkUnique(units.map((unit) => unit.key), "unit key", context);
  checkUnique(breakdown.acceptanceIntents.map((intent) => intent.id), "acceptance intent id", context);
  checkUnique(breakdown.repositoryEvidence.map((evidence) => evidence.id), "repository evidence id", context);
  checkUnique([
    ...breakdown.candidateArtifacts.map((candidate) => candidate.id),
    ...breakdown.candidateSeams.map((candidate) => candidate.id)
  ], "candidate relation id", context);
  const unitKeys2 = new Set(units.map((unit) => unit.key));
  const acceptanceIds = new Set(breakdown.acceptanceIntents.map((intent) => intent.id));
  const evidenceIds = new Set(breakdown.repositoryEvidence.map((evidence) => evidence.id));
  const pathEvidenceIds = new Set(breakdown.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => evidence.id));
  for (const unit of units) {
    for (const id of unit.acceptanceIntentIds) if (!acceptanceIds.has(id)) addIssue(context, `unit ${unit.key} references unknown acceptance intent ${id}`);
    for (const evidenceId of unit.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `unit ${unit.key} references unknown evidence ${evidenceId}`);
    if (unit.kind === "leaf" && (unit.plannedPaths?.length ?? 0) === 0 && !unit.evidenceIds.some((evidenceId) => pathEvidenceIds.has(evidenceId))) {
      addIssue(context, `leaf ${unit.key} must reference an existing path or declare at least one planned path`);
    }
  }
  for (const relation of [...breakdown.candidateArtifacts, ...breakdown.candidateSeams]) {
    if (!unitKeys2.has(relation.producerUnitKey)) addIssue(context, `candidate ${relation.id} references unknown producer ${relation.producerUnitKey}`);
    for (const consumer of relation.consumerUnitKeys) {
      if (!unitKeys2.has(consumer)) addIssue(context, `candidate ${relation.id} references unknown consumer ${consumer}`);
      if (consumer === relation.producerUnitKey) addIssue(context, `candidate ${relation.id} cannot consume its own output`);
    }
    for (const evidenceId of relation.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `candidate ${relation.id} references unknown evidence ${evidenceId}`);
  }
  for (const item of [...breakdown.uncertainties, ...breakdown.questions]) for (const evidenceId of item.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `${item.id} references unknown evidence ${evidenceId}`);
});
function flattenUnits(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}
function checkUnique(values, label, context) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (seen.has(value)) addIssue(context, `duplicate ${label} ${value}`);
    seen.add(value);
  }
}
function addIssue(context, message) {
  context.addIssue({ code: z2.ZodIssueCode.custom, message });
}

// src/planner/work-breakdown.ts
import { createHash } from "crypto";
import { NonEmptyStringSchema as NonEmptyStringSchema2 } from "@manyhands/shared";
import { z as z3 } from "zod";

// src/llm/recursive/json.ts
function parseJsonObject(text, options = {}) {
  const parsed = parseJsonObjectCandidates(text);
  if (!parsed.ok) {
    return parsed;
  }
  const preferred = options.prefer !== void 0 ? parsed.candidates.find((candidate) => options.prefer?.(candidate.value) === true) : void 0;
  return preferred ?? parsed.candidates[0] ?? {
    ok: false,
    kind: "missing_json",
    message: "No JSON object found in response",
    invalidCandidateCount: parsed.invalidCandidateCount,
    parseErrors: []
  };
}
function parseJsonObjectCandidates(text) {
  if (text.trim().length === 0) {
    return {
      ok: false,
      kind: "empty_response",
      message: "Model response was empty",
      invalidCandidateCount: 0,
      parseErrors: []
    };
  }
  const rawCandidates = extractJsonObjectCandidates(text);
  if (rawCandidates.length === 0) {
    return {
      ok: false,
      kind: "missing_json",
      message: "No JSON object found in response",
      invalidCandidateCount: 0,
      parseErrors: []
    };
  }
  const candidates = [];
  const parseErrors = [];
  for (const candidate of rawCandidates) {
    try {
      candidates.push({ ...candidate, value: JSON.parse(candidate.raw) });
    } catch (error) {
      parseErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      kind: "invalid_json",
      message: `Found ${rawCandidates.length} JSON-like object(s), but none parsed as valid JSON`,
      invalidCandidateCount: rawCandidates.length,
      parseErrors
    };
  }
  return {
    ok: true,
    candidates,
    invalidCandidateCount: rawCandidates.length - candidates.length
  };
}
function extractJsonObjectCandidates(text) {
  const candidates = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch !== "}") {
      continue;
    }
    if (depth === 0) {
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      candidates.push({
        raw: text.slice(start, i + 1),
        start,
        end: i + 1,
        index: candidates.length
      });
      start = -1;
    }
  }
  return candidates;
}

// src/planner/work-breakdown.ts
var WorkBreakdownProgressUnitSchema = z3.object({
  key: NonEmptyStringSchema2,
  parentKey: NonEmptyStringSchema2.nullable(),
  kind: z3.enum(["composite", "leaf"]),
  title: NonEmptyStringSchema2,
  objective: NonEmptyStringSchema2,
  siblingIndex: z3.number().int().nonnegative(),
  siblingCount: z3.number().int().positive()
}).strict().superRefine((unit, context) => {
  if (unit.siblingIndex >= unit.siblingCount) {
    context.addIssue({ code: z3.ZodIssueCode.custom, message: "siblingIndex must be lower than siblingCount" });
  }
});
var WorkBreakdownProgressLineSchema = z3.object({
  type: z3.literal("planning.node"),
  unit: WorkBreakdownProgressUnitSchema
}).strict();
var NonRetryablePlanningError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "NonRetryablePlanningError";
  }
};
var PlanningCapacityError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanningCapacityError";
  }
};
var WorkBreakdownPlanner = class {
  architectureVersion = "v2";
  model;
  maxAttempts;
  retryDelayMs;
  capacityBackoffMs;
  maxCapacityRetries;
  cache;
  constructor(options) {
    this.model = options.model;
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.retryDelayMs = nonNegativeInteger(options.retryDelayMs ?? 250, "retryDelayMs");
    this.capacityBackoffMs = nonNegativeInteger(options.capacityBackoffMs ?? 6e4, "capacityBackoffMs");
    this.maxCapacityRetries = nonNegativeInteger(options.maxCapacityRetries ?? 3, "maxCapacityRetries");
    this.cache = options.cache;
  }
  async plan(input, observer = {}) {
    const cacheKey = planningCacheKey(input);
    const cached = this.cache?.get(cacheKey);
    if (cached !== void 0) {
      const parsedCached = WorkBreakdownSchema.parse(cached);
      if (planningIssues(parsedCached, input).length === 0) return parsedCached;
    }
    const prompt = buildWorkBreakdownPrompt(input);
    let repairIssues = cached === void 0 ? [] : planningIssues(WorkBreakdownSchema.parse(cached), input);
    let capacityRetries = 0;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await observer.onAttemptStarted?.({ attempt });
      const discovered = /* @__PURE__ */ new Set();
      const reportUnit = async (candidate) => {
        const unit = WorkBreakdownProgressUnitSchema.parse(candidate);
        if (discovered.has(unit.key)) return;
        discovered.add(unit.key);
        await observer.onUnitDiscovered?.({ attempt, unit });
      };
      let nonRetryable = false;
      try {
        const outputs = normalizeModelOutputs(await this.model.generate({ ...prompt, attempt, repairIssues, onProgress: reportUnit }));
        const failures = [];
        for (const output of outputs) {
          const parsed = WorkBreakdownSchema.safeParse(output);
          if (parsed.success) {
            const groundingIssues = planningIssues(parsed.data, input);
            if (groundingIssues.length > 0) {
              failures.push(...groundingIssues);
              continue;
            }
            for (const unit of progressUnits(parsed.data.root)) await reportUnit(unit);
            this.cache?.set(cacheKey, parsed.data);
            return parsed.data;
          }
          failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
        }
        repairIssues = failures;
      } catch (error) {
        if (error instanceof PlanningCapacityError) {
          capacityRetries += 1;
          if (capacityRetries > this.maxCapacityRetries) {
            throw new Error(
              `WorkBreakdown planning ran out of provider capacity after ${this.maxCapacityRetries} throttled retries: ${error.message}`
            );
          }
          await observer.onAttemptFailed?.({
            attempt,
            reason: `provider capacity: ${error.message} (throttle ${capacityRetries}/${this.maxCapacityRetries}; attempt not consumed)`
          });
          if (this.capacityBackoffMs > 0) await delay(this.capacityBackoffMs * capacityRetries);
          attempt -= 1;
          continue;
        }
        repairIssues = [error instanceof Error ? error.message : String(error)];
        nonRetryable = error instanceof NonRetryablePlanningError;
      }
      await observer.onAttemptFailed?.({ attempt, reason: repairIssues.join("; ") });
      if (nonRetryable) {
        throw new Error(`WorkBreakdown planning stopped after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${repairIssues.join("; ")}`);
      }
      if (attempt < this.maxAttempts && this.retryDelayMs > 0) await delay(this.retryDelayMs);
    }
    throw new Error(`WorkBreakdown planning failed after ${this.maxAttempts} attempts: ${repairIssues.join("; ")}`);
  }
};
function planningIssues(breakdown, input) {
  return [...commandSurfaceIssues(breakdown, input), ...contractFidelityIssues(breakdown, input.goal)];
}
function contractFidelityIssues(breakdown, goal) {
  const descriptions = breakdown.acceptanceIntents.map((intent) => normalizeContractText(intent.description));
  return declaredContractSections(goal).flatMap((section) => {
    const heading = section.split("\n", 1)[0];
    return loadBearingExcerpts(section).map((excerpt) => ({ heading, excerpt }));
  }).filter(({ excerpt }) => !descriptions.some((description) => description.includes(excerpt))).map(({ heading }) => `contract fidelity: reproduce the fenced specimen of ${heading} verbatim in one acceptance intent, including nesting and exact literals`);
}
function loadBearingExcerpts(section) {
  const fences = [...section.matchAll(/```[^\n]*\n[\s\S]*?\n```/gu)].map((match) => match[0]);
  return fences.length > 0 ? fences : [section];
}
function declaredContractSections(goal) {
  const lines = normalizeContractText(goal).split("\n");
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^##\s+.*\b(?:contract|protocol|schema|contrato|protocolo|esquema)\b/iu.test(lines[index] ?? "")) continue;
    let end = index + 1;
    while (end < lines.length && !/^##\s+/u.test(lines[end] ?? "")) end += 1;
    sections.push(lines.slice(index, end).join("\n").trim());
    index = end - 1;
  }
  return sections;
}
function normalizeContractText(value) {
  return value.replaceAll("\r\n", "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
function commandSurfaceIssues(breakdown, input) {
  const stubScripts = input.repositorySnapshot.evidence.filter(
    (item) => item.kind === "script" && /\b(?:console\.log|echo)\b/iu.test(item.observation)
  );
  if (stubScripts.length === 0) return [];
  const units = flattenWorkUnits(breakdown.root);
  const introducesImplementation = units.some(
    (unit) => (unit.plannedPaths ?? []).some((candidate) => /\.(?:[cm]?[jt]sx?|css|html)$/iu.test(candidate))
  );
  if (!introducesImplementation) return [];
  const manifestEvidenceIds = new Set(input.repositorySnapshot.evidence.filter((item) => item.kind === "path" && /(^|\/)package\.json$/iu.test(item.reference.replaceAll("\\", "/"))).map((item) => item.id));
  const manifestGrounded = units.some((unit) => unit.evidenceIds.some((id) => manifestEvidenceIds.has(id)));
  if (manifestGrounded) return [];
  return [
    `command surface: repository validation scripts are stubs (${stubScripts.map((item) => item.reference).join(", ")}); the implementation unit must cite package.json path evidence so its scope can replace those stubs with real checks`
  ];
}
function flattenWorkUnits(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenWorkUnits)];
}
function parseWorkBreakdownProgressLine(line) {
  let candidate;
  try {
    candidate = JSON.parse(line);
  } catch {
    return void 0;
  }
  const parsed = WorkBreakdownProgressLineSchema.safeParse(candidate);
  return parsed.success ? parsed.data.unit : void 0;
}
function progressUnits(root) {
  const output = [];
  const visit = (unit, parentKey, siblingIndex, siblingCount) => {
    output.push({ key: unit.key, parentKey, kind: unit.kind, title: unit.title, objective: unit.objective, siblingIndex, siblingCount });
    if (unit.kind === "composite") unit.children.forEach((child, index) => visit(child, unit.key, index, unit.children.length));
  };
  visit(root, null, 0, 1);
  return output;
}
function normalizeModelOutputs(output) {
  if (typeof output !== "string") return [output];
  const parsed = parseJsonObjectCandidates(output);
  if (!parsed.ok) throw new Error(parsed.message);
  const documents = parsed.candidates.map((candidate) => candidate.value).filter((candidate) => !isProgressEnvelope(candidate));
  if (documents.length === 0) {
    throw new Error("Model emitted planning progress but no complete WorkBreakdown JSON.");
  }
  return documents;
}
function isProgressEnvelope(candidate) {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) && candidate.type === "planning.node";
}
function planningCacheKey(input) {
  return `work-breakdown-v2:${createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex")}`;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/compiler/contract-compiler.ts
import { createHash as createHash2 } from "crypto";
import {
  TaskContractBundleSchema
} from "@manyhands/contracts";

// src/compiler/acceptance-allocation.ts
function allocateAcceptanceIntents(root) {
  const units = flattenUnits2(root);
  const parentByKey = collectParentKeys(root);
  const output = {};
  const intentIds = new Set(units.flatMap((unit) => unit.acceptanceIntentIds));
  for (const intentId of [...intentIds].sort()) {
    const references = units.filter((unit) => unit.acceptanceIntentIds.includes(intentId)).map((unit) => unit.key);
    const deepestReferences = references.filter(
      (candidate) => !references.some((other) => other !== candidate && isAncestor(candidate, other, parentByKey))
    );
    if (deepestReferences.length === 0) continue;
    output[intentId] = lowestCommonAncestor(deepestReferences, parentByKey);
  }
  return output;
}
function lowestCommonAncestor(unitKeys2, parentByKey) {
  const [first, ...rest] = unitKeys2;
  if (first === void 0) throw new Error("Cannot find an acceptance owner without referencing units.");
  const firstAncestry = ancestry(first, parentByKey);
  return firstAncestry.find(
    (candidate) => rest.every((unitKey) => ancestry(unitKey, parentByKey).includes(candidate))
  ) ?? first;
}
function ancestry(unitKey, parentByKey) {
  const output = [];
  let candidate = unitKey;
  while (candidate !== void 0) {
    output.push(candidate);
    candidate = parentByKey.get(candidate);
  }
  return output;
}
function isAncestor(ancestorKey, unitKey, parentByKey) {
  let candidate = parentByKey.get(unitKey);
  while (candidate !== void 0) {
    if (candidate === ancestorKey) return true;
    candidate = parentByKey.get(candidate);
  }
  return false;
}
function collectParentKeys(root) {
  const output = /* @__PURE__ */ new Map();
  const visit = (unit) => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}
function flattenUnits2(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits2)];
}

// src/compiler/validation-obligations.ts
function compileAcceptanceCriterion(unit, intent, dependencies) {
  return {
    id: dependencies.idFor("criterion", `${unit.key}-${intent.id}`),
    kind: validationLayerFor(unit),
    description: intent.description,
    required: intent.required
  };
}
function compileLocalAcceptanceCriterion(unit, dependencies) {
  return {
    id: dependencies.idFor("criterion", `${unit.key}-local-outcome`),
    kind: validationLayerFor(unit),
    description: `Local outcome: ${unit.expectedOutcomes.join("; ")}`,
    required: true
  };
}
function compileValidationObligation(unit, criterion, dependencies, evidence) {
  const layer = validationLayerFor(unit);
  return {
    id: dependencies.idFor("validation-obligation", `${unit.key}-${criterion.id}`),
    criterionId: criterion.id,
    layer,
    severity: criterion.required ? "required" : "advisory",
    acceptableEvidence: layer === "manual" ? ["manual_attestation"] : ["test_result"],
    baselinePolicy: "required",
    negativeControl: layer === "static" ? "not_required" : "when_feasible",
    flakyPolicy: "forbid",
    ...evidence !== void 0 ? { evidence } : {}
  };
}
function validationLayerFor(unit) {
  const concerns = new Set(unit.concerns.map((concern) => concern.toLowerCase()));
  if (concerns.has("accessibility")) return "accessibility";
  if (concerns.has("security")) return "security";
  if (concerns.has("ui") && (concerns.has("api") || concerns.has("domain"))) return "e2e";
  if (concerns.has("api") || concerns.has("integration") || unit.concerns.length > 2) return "integration";
  if (concerns.has("types") || concerns.has("static")) return "static";
  return "unit";
}

// src/compiler/contract-compiler.ts
function compileContractBundles(input, dependencies) {
  const units = flattenUnits3(input.breakdown.root);
  const evidence = new Map(input.breakdown.repositoryEvidence.map((item) => [item.id, item]));
  const indexedPaths = new Set(input.repositorySnapshot.index?.files.map((file) => file.path) ?? []);
  if (hasPackageManifest(input.repositorySnapshot)) indexedPaths.add("package.json");
  const scopePathsByNodeId = {};
  const directPaths = new Map(units.map((unit) => [unit.key, unit.evidenceIds.map((id) => evidence.get(id)).filter((item) => item?.kind === "path").map((item) => item.reference).filter((path2) => indexedPaths.has(path2)).concat(unit.plannedPaths ?? [])]));
  populateScopePaths(input.breakdown.root, input.nodeIdByUnitKey, directPaths, scopePathsByNodeId);
  const artifactContracts = input.breakdown.candidateArtifacts.map((candidate) => {
    const producerNodeId = requireNodeId(input.nodeIdByUnitKey, candidate.producerUnitKey);
    const consumerNodeIds = candidate.consumerUnitKeys.map((key) => requireNodeId(input.nodeIdByUnitKey, key));
    const producerUnit = units.find((unit) => unit.key === candidate.producerUnitKey);
    if (producerUnit === void 0) throw new Error(`Artifact producer ${candidate.producerUnitKey} does not exist.`);
    const producerEvidenceIds = new Set(producerUnit.evidenceIds);
    const expectedPaths = candidate.evidenceIds.filter((id) => producerEvidenceIds.has(id)).map((id) => evidence.get(id)).filter((item) => item?.kind === "path").map((item) => item.reference).filter((path2) => indexedPaths.has(path2)).concat(producerUnit.plannedPaths ?? []);
    const base = {
      schemaVersion: 2,
      id: dependencies.idFor("artifact-contract", candidate.id),
      provenance: "compiled",
      producerNodeId,
      consumerNodeIds,
      artifactType: candidate.artifactType,
      materialization: candidate.materializationHint,
      expectedPaths: [...new Set(expectedPaths)].sort()
    };
    return { ...base, revision: revisionFor(base) };
  });
  const parentKeyByUnitKey = collectParentKeys2(input.breakdown.root);
  const nodeOutputArtifactContracts = units.map((unit) => {
    const producerNodeId = requireNodeId(input.nodeIdByUnitKey, unit.key);
    const parentKey = parentKeyByUnitKey.get(unit.key);
    const consumerNodeIds = parentKey === void 0 ? [] : [requireNodeId(input.nodeIdByUnitKey, parentKey)];
    const base = {
      schemaVersion: 2,
      id: dependencies.idFor("artifact-contract", `${unit.key}-output`),
      provenance: "compiled",
      producerNodeId,
      consumerNodeIds,
      artifactType: parentKey === void 0 ? "final-candidate" : "node-result",
      mediaType: "application/vnd.manyhands.git-commit",
      materialization: "commit",
      expectedPaths: scopePathsByNodeId[producerNodeId] ?? []
    };
    return { ...base, revision: revisionFor(base) };
  });
  const allArtifactContracts = [...artifactContracts, ...nodeOutputArtifactContracts];
  const seamContracts = input.breakdown.candidateSeams.map((candidate) => {
    const base = {
      schemaVersion: 2,
      id: dependencies.idFor("seam-contract", candidate.id),
      provenance: "compiled",
      kind: candidate.kind,
      specification: candidate.specification,
      producerNodeId: requireNodeId(input.nodeIdByUnitKey, candidate.producerUnitKey),
      consumerNodeIds: candidate.consumerUnitKeys.map((key) => requireNodeId(input.nodeIdByUnitKey, key)),
      semanticFacts: Object.fromEntries(candidate.evidenceIds.map((id, index) => [`evidence.${index}`, id])),
      compatibility: { mode: "exact", rules: ["All participants bind the same compiled revision."] }
    };
    return { ...base, revision: revisionFor(base) };
  });
  const intents = new Map(input.breakdown.acceptanceIntents.map((intent) => [intent.id, intent]));
  const acceptanceOwnerByIntentId = allocateAcceptanceIntents(input.breakdown.root);
  for (const intent of input.breakdown.acceptanceIntents) {
    acceptanceOwnerByIntentId[intent.id] ??= input.breakdown.root.key;
  }
  const bundles = units.map((unit) => {
    const nodeId = requireNodeId(input.nodeIdByUnitKey, unit.key);
    const userCriteria = unit.acceptanceIntentIds.filter((intentId) => acceptanceOwnerByIntentId[intentId] === unit.key).map((intentId) => {
      const intent = intents.get(intentId);
      if (intent === void 0) throw new Error(`Unit ${unit.key} references missing acceptance intent ${intentId}.`);
      return compileAcceptanceCriterion(unit, intent, dependencies);
    });
    const criteria = userCriteria.length > 0 ? userCriteria : [compileLocalAcceptanceCriterion(unit, dependencies)];
    const scope = contractWithRevision({
      schemaVersion: 2,
      id: dependencies.idFor("scope-contract", unit.key),
      provenance: "compiled",
      nodeId,
      allowedPaths: scopePathsByNodeId[nodeId] ?? [],
      forbiddenPaths: [],
      coordinationPaths: coordinationPaths(nodeId, scopePathsByNodeId),
      outputRoots: deriveOutputRoots(scopePathsByNodeId[nodeId] ?? [])
    });
    const validation = contractWithRevision({
      schemaVersion: 2,
      id: dependencies.idFor("validation-contract", unit.key),
      provenance: "compiled",
      nodeId,
      obligations: criteria.map((criterion) => compileValidationObligation(
        unit,
        criterion,
        dependencies,
        criterionEvidence(unit, criteria, input.breakdown.repositoryEvidence)
      ))
    });
    const relevantArtifacts = allArtifactContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const relevantSeams = seamContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const task = contractWithRevision({
      schemaVersion: 2,
      id: dependencies.idFor("task-contract", unit.key),
      provenance: "compiled",
      nodeId,
      goal: unit.objective,
      acceptanceCriteria: criteria,
      scope: reference(scope),
      consumes: relevantArtifacts.filter((contract) => contract.consumerNodeIds.includes(nodeId)).map(reference),
      produces: relevantArtifacts.filter((contract) => contract.producerNodeId === nodeId).map(reference),
      seams: relevantSeams.map(reference),
      validation: reference(validation),
      constraints: []
    });
    return TaskContractBundleSchema.parse({
      schemaVersion: 2,
      task,
      scope,
      seams: structuredClone(relevantSeams),
      artifacts: structuredClone(relevantArtifacts),
      validation
    });
  });
  return {
    bundles,
    artifactContracts: allArtifactContracts,
    nodeOutputArtifactContracts,
    seamContracts,
    scopePathsByNodeId,
    acceptanceOwnerByIntentId
  };
}
function criterionEvidence(unit, criteria, repositoryEvidence) {
  if (criteria.length !== 1) return void 0;
  const evidenceById = new Map(repositoryEvidence.map((evidence) => [evidence.id, evidence]));
  const references = [...new Set([
    ...unit.plannedPaths ?? [],
    ...unit.evidenceIds.flatMap((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence?.kind === "path" ? [evidence.reference] : [];
    })
  ].filter(isTestReference))].sort();
  if (references.length === 0) return void 0;
  return { kind: "focused_command", selectors: references, references };
}
function isTestReference(reference2) {
  const normalized = reference2.replaceAll("\\", "/");
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(normalized);
}
function hasPackageManifest(snapshot) {
  return snapshot.capabilities.packageManager !== void 0 || Object.keys(snapshot.capabilities.scripts).length > 0 || snapshot.capabilities.stack.some((item) => item.evidence.some((entry) => entry.includes("package.json")));
}
function populateScopePaths(unit, nodeIdByUnitKey, directPaths, output) {
  const descendants = unit.kind === "composite" ? unit.children.flatMap((child) => populateScopePaths(child, nodeIdByUnitKey, directPaths, output)) : [];
  const paths = [.../* @__PURE__ */ new Set([...directPaths.get(unit.key) ?? [], ...descendants])].sort();
  if (paths.length === 0) {
    throw new Error(`Cannot compile an honest scope for unit ${unit.key}; no existing or explicitly planned path is available.`);
  }
  output[requireNodeId(nodeIdByUnitKey, unit.key)] = paths;
  return paths;
}
function collectParentKeys2(root) {
  const parents = /* @__PURE__ */ new Map();
  const visit = (unit) => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      parents.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return parents;
}
function contractWithRevision(contract) {
  return { ...contract, revision: revisionFor(contract) };
}
function revisionFor(value) {
  return `sha256:${createHash2("sha256").update(JSON.stringify(canonicalize2(value))).digest("hex")}`;
}
function canonicalize2(value) {
  if (Array.isArray(value)) return value.map(canonicalize2);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize2(item)]));
  return value;
}
function reference(contract) {
  return { id: contract.id, revision: contract.revision };
}
function requireNodeId(nodeIdByUnitKey, key) {
  const nodeId = nodeIdByUnitKey[key];
  if (nodeId === void 0) throw new Error(`No compiled node exists for semantic unit ${key}.`);
  return nodeId;
}
function flattenUnits3(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits3)];
}
function deriveOutputRoots(allowedPaths) {
  const roots = /* @__PURE__ */ new Set();
  for (const path2 of allowedPaths) {
    const normalized = path2.replaceAll("\\", "/");
    const cut = normalized.lastIndexOf("/");
    if (cut <= 0) continue;
    roots.add(normalized.slice(0, cut));
  }
  return [...roots].sort();
}
function coordinationPaths(nodeId, scopePathsByNodeId) {
  const own = new Set(scopePathsByNodeId[nodeId] ?? []);
  return [...own].filter((path2) => Object.entries(scopePathsByNodeId).some(([otherId, paths]) => otherId !== nodeId && paths.includes(path2))).sort();
}

// src/compiler/graph-compiler.ts
import { RepositorySnapshotSchema } from "@manyhands/repository-index";
import {
  GraphRevisionSchema
} from "@manyhands/task-graph";

// src/critics/review.ts
import { TaskContractBundleSchema as TaskContractBundleSchema2 } from "@manyhands/contracts";
import { validateGraphRevision } from "@manyhands/task-graph";
var PLAN_CRITIC_KINDS = [
  "completeness",
  "atomicity",
  "contract_compatibility",
  "dag_validity",
  "scope_isolation",
  "artifact_coverage",
  "risk_uncertainty",
  "validation_coverage"
];
function reviewCompiledPlan(input) {
  const findings = [];
  reviewCompleteness(input, findings);
  reviewAtomicity(input, findings);
  reviewContractCompatibility(input, findings);
  reviewDag(input, findings);
  reviewScopes(input, findings);
  reviewArtifacts(input, findings);
  reviewRisk(input, findings);
  reviewValidation(input, findings);
  return {
    checkedCritics: [...PLAN_CRITIC_KINDS],
    findings,
    approvable: findings.every((finding2) => finding2.severity !== "error")
  };
}
function assertPlanReview(review) {
  const errors = review.findings.filter((finding2) => finding2.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Compiled plan review failed: ${errors.map((finding2) => `${finding2.code}: ${finding2.message}`).join("; ")}`);
  }
}
function reviewCompleteness(input, findings) {
  const leafIntentIds = new Set(flattenUnits4(input.breakdown.root).filter((unit) => unit.kind === "leaf").flatMap((unit) => unit.acceptanceIntentIds));
  for (const intent of input.breakdown.acceptanceIntents) {
    if (intent.required && !leafIntentIds.has(intent.id)) findings.push(finding("completeness", "error", "unowned_acceptance", `Required acceptance intent ${intent.id} has no leaf owner.`, "Assign the intent to a cohesive leaf.", [intent.id]));
  }
  const expectedNodeCount = flattenUnits4(input.breakdown.root).length;
  if (input.contracts.length !== expectedNodeCount) findings.push(finding("completeness", "error", "missing_task_contract", `Expected ${expectedNodeCount} node contract bundles, found ${input.contracts.length}.`, "Compile one contract bundle for every graph node.", []));
}
function reviewAtomicity(input, findings) {
  for (const unit of flattenUnits4(input.breakdown.root)) {
    if (unit.kind === "leaf" && (unit.expectedOutcomes.length === 0 || unit.concerns.length === 0)) findings.push(finding("atomicity", "error", "ambiguous_leaf", `Leaf ${unit.key} has no cohesive concern or observable outcome.`, "Refine or split the leaf around a verifiable outcome.", unit.evidenceIds));
  }
}
function reviewContractCompatibility(input, findings) {
  for (const bundle of input.contracts) {
    const parsed = TaskContractBundleSchema2.safeParse(bundle);
    if (!parsed.success) findings.push(finding("contract_compatibility", "error", "invalid_contract_bundle", `Contract bundle for ${bundle.task.nodeId} is invalid: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`, "Regenerate the bundle from a single set of versioned contracts.", [], bundle.task.nodeId, bundle.task.id));
  }
  for (const binding of input.graph.seamBindings) {
    const participants = input.contracts.filter((bundle) => bundle.task.nodeId === binding.producerNodeId || bundle.task.nodeId === binding.consumerNodeId);
    if (participants.length !== 2 || participants.some((bundle) => !bundle.seams.some((seam) => seam.id === binding.seamContract.id && seam.revision === binding.seamContract.revision))) findings.push(finding("contract_compatibility", "error", "unresolved_seam_binding", `Seam binding ${binding.id} does not resolve to the same contract revision for both participants.`, "Compile and bind one shared seam revision.", [], void 0, binding.seamContract.id));
  }
}
function reviewDag(input, findings) {
  for (const issue of validateGraphRevision(input.graph)) findings.push(finding("dag_validity", issue.severity, issue.code, issue.message, "Repair the typed graph relation or hierarchy before approval.", [], issue.nodeId));
}
function reviewScopes(input, findings) {
  const isWin = input.options?.isWin ?? process.platform === "win32";
  const normalizePath3 = (p) => {
    const posix = p.replaceAll("\\", "/");
    return isWin ? posix.toLowerCase() : posix;
  };
  const indexedPathsNormalized = new Set([
    ...input.repositorySnapshot.index?.files.map((file) => file.path) ?? [],
    ...hasPackageManifest2(input.repositorySnapshot) ? ["package.json"] : []
  ].map(normalizePath3));
  const plannedPathsNormalized = new Set(flattenUnits4(input.breakdown.root).flatMap((unit) => unit.plannedPaths ?? []).map(normalizePath3));
  for (const path2 of plannedPathsNormalized) {
    if (indexedPathsNormalized.has(path2)) findings.push(finding("scope_isolation", "error", "planned_path_already_exists", `Planned path ${path2} already exists in the repository snapshot.`, "Cite the existing path as repository evidence instead of declaring it as a new output.", []));
  }
  for (const bundle of input.contracts) {
    for (const path2 of bundle.scope.allowedPaths) if (!indexedPathsNormalized.has(normalizePath3(path2)) && !plannedPathsNormalized.has(normalizePath3(path2))) findings.push(finding("scope_isolation", "error", "scope_path_not_grounded", `Scope path ${path2} for ${bundle.task.nodeId} is neither present in the repository snapshot nor declared as a planned output.`, "Ground the scope in repository evidence or declare a concrete planned output path.", [], bundle.task.nodeId, bundle.scope.id));
  }
  const parentByUnitKey = buildParentByUnitKey(input.breakdown.root);
  const unitsPerPlannedPath = /* @__PURE__ */ new Map();
  for (const unit of flattenUnits4(input.breakdown.root)) {
    for (const path2 of new Set((unit.plannedPaths ?? []).map(normalizePath3))) {
      unitsPerPlannedPath.set(path2, [...unitsPerPlannedPath.get(path2) ?? [], unit.key]);
    }
  }
  for (const [path2, units] of unitsPerPlannedPath) {
    const contestingUnitKeys = /* @__PURE__ */ new Set();
    for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
        const left = units[leftIndex];
        const right = units[rightIndex];
        if (isUnitAncestor(parentByUnitKey, left, right) || isUnitAncestor(parentByUnitKey, right, left)) continue;
        contestingUnitKeys.add(left);
        contestingUnitKeys.add(right);
      }
    }
    if (contestingUnitKeys.size === 0) continue;
    findings.push(finding("scope_isolation", "error", "contested_planned_output", `${contestingUnitKeys.size} independent units declare ${path2} as their own planned output.`, "Give each unit a distinct output path, or let one unit own the file and have the others consume it through an artifact.", []));
  }
  for (let leftIndex = 0; leftIndex < input.contracts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.contracts.length; rightIndex += 1) {
      const left = input.contracts[leftIndex];
      const right = input.contracts[rightIndex];
      if (isAncestor2(input, left.task.nodeId, right.task.nodeId) || isAncestor2(input, right.task.nodeId, left.task.nodeId)) continue;
      const rightNormalized = new Set(right.scope.allowedPaths.map(normalizePath3));
      const overlap = left.scope.allowedPaths.filter((path2) => rightNormalized.has(normalizePath3(path2)));
      if (overlap.length === 0) continue;
      const constrained = input.graph.conflictConstraints.some((constraint) => (/* @__PURE__ */ new Set([constraint.leftNodeId, constraint.rightNodeId])).size === 2 && [constraint.leftNodeId, constraint.rightNodeId].includes(left.task.nodeId) && [constraint.leftNodeId, constraint.rightNodeId].includes(right.task.nodeId));
      if (!constrained) findings.push(finding("scope_isolation", "error", "unmodeled_scope_overlap", `${left.task.nodeId} and ${right.task.nodeId} overlap on ${overlap.join(", ")} without a conflict constraint.`, "Add a scheduling conflict constraint or redraw scopes.", [], left.task.nodeId));
    }
  }
}
function hasPackageManifest2(snapshot) {
  return snapshot.capabilities.packageManager !== void 0 || Object.keys(snapshot.capabilities.scripts).length > 0 || snapshot.capabilities.stack.some((item) => item.evidence.some((entry) => entry.includes("package.json")));
}
function isAncestor2(input, ancestorId, descendantId) {
  let current = input.graph.nodes[descendantId]?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = input.graph.nodes[current]?.parentId ?? null;
  }
  return false;
}
function buildParentByUnitKey(root) {
  const parentByUnitKey = /* @__PURE__ */ new Map();
  const visit = (unit, parentKey) => {
    parentByUnitKey.set(unit.key, parentKey);
    if (unit.kind === "composite") {
      for (const child of unit.children) visit(child, unit.key);
    }
  };
  visit(root, null);
  return parentByUnitKey;
}
function isUnitAncestor(parentByUnitKey, ancestorKey, descendantKey) {
  let current = parentByUnitKey.get(descendantKey) ?? null;
  while (current !== null) {
    if (current === ancestorKey) return true;
    current = parentByUnitKey.get(current) ?? null;
  }
  return false;
}
function reviewArtifacts(input, findings) {
  for (const bundle of input.contracts) {
    for (const artifact of bundle.artifacts.filter((candidate) => candidate.producerNodeId === bundle.task.nodeId)) {
      const isFinalRootArtifact = bundle.task.nodeId === input.graph.rootId && artifact.artifactType === "final-candidate";
      if (artifact.consumerNodeIds.length === 0 && !isFinalRootArtifact) findings.push(finding("artifact_coverage", "error", "orphan_output", `Artifact ${artifact.id} has no consumer or declared final purpose.`, "Declare a consumer or model it as a final root artifact.", [], bundle.task.nodeId, artifact.id));
      for (const consumerId of artifact.consumerNodeIds) {
        const consumer = input.contracts.find((candidate) => candidate.task.nodeId === consumerId);
        if (consumer === void 0 || !consumer.task.consumes.some((reference2) => reference2.id === artifact.id)) findings.push(finding("artifact_coverage", "error", "artifact_consumer_missing", `Artifact ${artifact.id} names ${consumerId} but that task does not consume it.`, "Compile matching producer and consumer artifact references.", [], consumerId, artifact.id));
      }
    }
  }
}
function reviewRisk(input, findings) {
  for (const question of input.breakdown.questions) findings.push(finding("risk_uncertainty", "error", "unresolved_human_question", `Consequential question ${question.id} is unresolved: ${question.question}`, "Resolve the question and create a new WorkBreakdown revision.", question.evidenceIds));
  for (const uncertainty of input.breakdown.uncertainties) findings.push(finding("risk_uncertainty", uncertainty.requiresHumanDecision ? "error" : "warning", "unresolved_uncertainty", uncertainty.description, uncertainty.requiresHumanDecision ? "Obtain the required human decision." : "Expose the uncertainty and mitigation to approval.", uncertainty.evidenceIds));
}
function reviewValidation(input, findings) {
  for (const bundle of input.contracts) {
    const covered = new Set(bundle.validation.obligations.map((obligation) => obligation.criterionId));
    for (const criterion of bundle.task.acceptanceCriteria) if (criterion.required && !covered.has(criterion.id)) findings.push(finding("validation_coverage", "error", "criterion_without_obligation", `Required criterion ${criterion.id} for ${bundle.task.nodeId} has no validation obligation.`, "Compile an evidence obligation without inventing an exact command.", [], bundle.task.nodeId, bundle.validation.id));
  }
}
function finding(critic, severity, code, message, repair, evidenceIds, nodeId, contractId) {
  return { critic, severity, code, message, repair, evidenceIds, ...nodeId !== void 0 ? { nodeId } : {}, ...contractId !== void 0 ? { contractId } : {} };
}
function flattenUnits4(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits4)];
}

// src/compiler/graph-compiler.ts
function compileGraphRevision(rawInput, dependencies) {
  const breakdown = WorkBreakdownSchema.parse(rawInput.breakdown);
  RepositorySnapshotSchema.parse(rawInput.repositorySnapshot);
  const repositorySnapshot = rawInput.repositorySnapshot;
  if (breakdown.repositorySnapshotId !== repositorySnapshot.snapshotId) {
    throw new Error(`WorkBreakdown references repository snapshot ${breakdown.repositorySnapshotId}, received ${repositorySnapshot.snapshotId}.`);
  }
  if (repositorySnapshot.inspectionDisposition === "unavailable" || repositorySnapshot.index === void 0) {
    throw new Error("Cannot compile an executable graph from an unavailable repository snapshot.");
  }
  const units = flattenUnits5(breakdown.root);
  const nodeIdByUnitKey = Object.fromEntries(units.map((unit) => [unit.key, dependencies.idFor("node", unit.key)]));
  const nodes = compileNodes(breakdown.root, nodeIdByUnitKey);
  const contractResult = compileContractBundles({ breakdown, repositorySnapshot, nodeIdByUnitKey }, dependencies);
  const trace = [];
  const artifactRequirements = [];
  for (const candidate of breakdown.candidateArtifacts) {
    const contract = contractResult.artifactContracts.find((item) => item.id === dependencies.idFor("artifact-contract", candidate.id));
    if (contract === void 0) throw new Error(`Artifact contract for ${candidate.id} was not compiled.`);
    const relationIds = [];
    if (candidate.materializationHint !== "logical") {
      for (const consumerKey of candidate.consumerUnitKeys) {
        const consumerNodeId = requireNodeId2(nodeIdByUnitKey, consumerKey);
        const id = dependencies.idFor("artifact-requirement", `${candidate.id}-${consumerKey}`);
        artifactRequirements.push({
          id,
          artifactContract: { id: contract.id, revision: contract.revision },
          producerNodeId: contract.producerNodeId,
          consumerNodeId,
          requiredFor: "execution"
        });
        relationIds.push(id);
      }
    }
    trace.push({ sourceType: "candidate_artifact", sourceId: candidate.id, compiledRelationIds: relationIds, evidenceIds: [...candidate.evidenceIds] });
  }
  for (const contract of contractResult.nodeOutputArtifactContracts) {
    for (const consumerNodeId of contract.consumerNodeIds) {
      artifactRequirements.push({
        id: dependencies.idFor("artifact-requirement", `${contract.id}-${consumerNodeId}`),
        artifactContract: { id: contract.id, revision: contract.revision },
        producerNodeId: contract.producerNodeId,
        consumerNodeId,
        requiredFor: "integration"
      });
    }
  }
  const seamBindings = [];
  for (const candidate of breakdown.candidateSeams) {
    const contract = contractResult.seamContracts.find((item) => item.id === dependencies.idFor("seam-contract", candidate.id));
    if (contract === void 0) throw new Error(`Seam contract for ${candidate.id} was not compiled.`);
    const relationIds = [];
    for (const consumerKey of candidate.consumerUnitKeys) {
      const id = dependencies.idFor("seam-binding", `${candidate.id}-${consumerKey}`);
      seamBindings.push({
        id,
        seamContract: { id: contract.id, revision: contract.revision },
        producerNodeId: contract.producerNodeId,
        consumerNodeId: requireNodeId2(nodeIdByUnitKey, consumerKey),
        producerRevision: contract.revision,
        consumerRevision: contract.revision
      });
      relationIds.push(id);
    }
    trace.push({ sourceType: "candidate_seam", sourceId: candidate.id, compiledRelationIds: relationIds, evidenceIds: [...candidate.evidenceIds] });
  }
  const conflictConstraints = compileScopeConflicts(contractResult.scopePathsByNodeId, nodes, dependencies, trace);
  const graph = GraphRevisionSchema.parse({
    schemaVersion: 2,
    graphId: dependencies.idFor("graph", breakdown.breakdownId),
    revision: 1,
    rootId: requireNodeId2(nodeIdByUnitKey, breakdown.root.key),
    baseCommit: repositorySnapshot.baseCommit,
    repositorySnapshotId: repositorySnapshot.snapshotId,
    nodes,
    artifactRequirements,
    seamBindings,
    conflictConstraints,
    legacyOrderingConstraints: [],
    createdAt: dependencies.now()
  });
  const review = reviewCompiledPlan({ breakdown, repositorySnapshot, graph, contracts: contractResult.bundles });
  assertPlanReview(review);
  return {
    graph,
    contracts: contractResult.bundles,
    review,
    trace: { unitNodeIds: nodeIdByUnitKey, relations: trace }
  };
}
function compileNodes(root, nodeIdByUnitKey) {
  const nodes = {};
  const visit = (unit, parentId) => {
    const id = requireNodeId2(nodeIdByUnitKey, unit.key);
    nodes[id] = {
      id,
      parentId,
      kind: parentId === null && unit.kind === "composite" ? "root" : unit.kind,
      title: unit.title,
      goal: unit.objective
    };
    if (unit.kind === "composite") for (const child of unit.children) visit(child, id);
  };
  visit(root, null);
  return nodes;
}
function compileScopeConflicts(scopes, nodes, dependencies, trace) {
  const entries = Object.entries(scopes).sort(([left], [right]) => left.localeCompare(right));
  const constraints = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftNodeId, leftPaths] = entries[leftIndex];
      const [rightNodeId, rightPaths] = entries[rightIndex];
      if (isAncestor3(nodes, leftNodeId, rightNodeId) || isAncestor3(nodes, rightNodeId, leftNodeId)) continue;
      const overlap = leftPaths.filter((path2) => rightPaths.includes(path2));
      if (overlap.length === 0) continue;
      const id = dependencies.idFor("conflict-constraint", `${leftNodeId}-${rightNodeId}`);
      constraints.push({ id, leftNodeId, rightNodeId, reason: `Scopes overlap on ${overlap.join(", ")}.`, risk: "high" });
      trace.push({ sourceType: "scope_overlap", sourceId: `${leftNodeId}:${rightNodeId}`, compiledRelationIds: [id], evidenceIds: overlap });
    }
  }
  return constraints;
}
function isAncestor3(nodes, ancestorId, descendantId) {
  let current = nodes[descendantId]?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}
function flattenUnits5(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits5)];
}
function requireNodeId2(nodeIdByUnitKey, key) {
  const nodeId = nodeIdByUnitKey[key];
  if (nodeId === void 0) throw new Error(`Missing compiled node id for semantic unit ${key}.`);
  return nodeId;
}

// src/granularity/complexity-evaluator.ts
var LEAF_COMPLEXITY_THRESHOLD = 3.5;
var DEFAULT_COMPLEXITY_WEIGHTS = Object.freeze({
  scopeRadius: 0.3,
  interfaceImpact: 0.25,
  validationSurface: 0.25,
  contextTokenMass: 0.2
});
function evaluateIntrinsicComplexity(input, weights = DEFAULT_COMPLEXITY_WEIGHTS, leafThreshold = LEAF_COMPLEXITY_THRESHOLD) {
  assertNodeId(input.nodeId);
  const dimensions = {
    scopeRadius: normalizeDimension(input.scopeRadius, "scopeRadius"),
    interfaceImpact: normalizeDimension(input.interfaceImpact, "interfaceImpact"),
    validationSurface: normalizeDimension(input.validationSurface, "validationSurface"),
    contextTokenMass: normalizeDimension(input.contextTokenMass, "contextTokenMass")
  };
  const normalizedWeights = normalizeWeights(weights);
  const complexityScore = roundTo(
    dimensions.scopeRadius * normalizedWeights.scopeRadius + dimensions.interfaceImpact * normalizedWeights.interfaceImpact + dimensions.validationSurface * normalizedWeights.validationSurface + dimensions.contextTokenMass * normalizedWeights.contextTokenMass,
    2
  );
  const isLeaf = complexityScore <= leafThreshold;
  const assessment2 = {
    nodeId: input.nodeId,
    complexityScore,
    isLeaf,
    nodeKind: isLeaf ? "LeafNode" : "CompositeNode",
    rationale: input.rationale ?? `${isLeaf ? "Leaf" : "Composite"} at C_task=${complexityScore.toFixed(2)} (S_r=${dimensions.scopeRadius}, I_i=${dimensions.interfaceImpact}, V_s=${dimensions.validationSurface}, T_m=${dimensions.contextTokenMass}).`,
    dimensions
  };
  if (!isLeaf) {
    assessment2.recommendedBranchingFactor = recommendedBranchingFactor(complexityScore);
  }
  return assessment2;
}
var IntrinsicComplexityEvaluator = class {
  constructor(weights = DEFAULT_COMPLEXITY_WEIGHTS) {
    this.weights = weights;
  }
  weights;
  evaluate(input) {
    return evaluateIntrinsicComplexity(input, this.weights);
  }
};
function recommendedBranchingFactor(complexityScore) {
  if (!Number.isFinite(complexityScore)) {
    throw new RangeError("complexityScore must be finite.");
  }
  return Math.max(2, Math.min(5, Math.ceil(complexityScore / 2)));
}
function normalizeDimension(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
  return Math.min(10, value);
}
function normalizeWeights(weights) {
  const entries = Object.entries(weights);
  for (const [label, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} weight must be a finite, non-negative number.`);
    }
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) throw new RangeError("Complexity weights must have a positive sum.");
  return Object.fromEntries(entries.map(([label, value]) => [label, value / total]));
}
function assertNodeId(nodeId) {
  if (nodeId.trim().length === 0) throw new TypeError("nodeId must be non-empty.");
}
function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// src/granularity/coalescing-critic.ts
var EXCESSIVE_SCOPE_RADIUS = 3;
var SMALL_DIRECTORY_PATH_LIMIT = 3;
function reviewGranularityProposal(proposedUnits, coalescingEnabled = true) {
  const assessed = proposedUnits.map(reviewUnit);
  const groups = coalescingEnabled ? coalescingGroups(assessed) : assessed.map((unit) => [unit]);
  const decisions = [];
  const units = groups.map((group) => {
    if (group.length === 1) return group[0];
    const merged = mergeUnits(group);
    decisions.push({
      kind: "coalesced",
      unitIds: group.map((unit) => unit.nodeId),
      rationale: `Merged trivial, dependency-free siblings sharing ${sharedScopeLabel(group)}.`
    });
    return merged;
  });
  for (const unit of units) {
    if (unit.forceComposite) {
      decisions.push({
        kind: "resplit_required",
        unitIds: [unit.nodeId],
        rationale: `Leaf scope radius ${unit.complexity.scopeRadius} exceeds the maximum of ${EXCESSIVE_SCOPE_RADIUS} modules.`
      });
    }
  }
  return {
    units,
    decisions,
    coalescedUnitsCount: assessed.length - units.length
  };
}
function requiresResplitting(unit) {
  const assessment2 = evaluateIntrinsicComplexity({ nodeId: unit.nodeId, ...unit.complexity });
  return assessment2.isLeaf && unit.complexity.scopeRadius > EXCESSIVE_SCOPE_RADIUS;
}
function reviewUnit(unit) {
  validateUnit(unit);
  const assessment2 = evaluateIntrinsicComplexity({ nodeId: unit.nodeId, ...unit.complexity });
  return {
    ...unit,
    targetScopePaths: uniqueSorted(unit.targetScopePaths.map(normalizePath)),
    expectedDependencies: uniqueSorted(unit.expectedDependencies ?? []),
    assessment: assessment2,
    forceComposite: assessment2.isLeaf && unit.complexity.scopeRadius > EXCESSIVE_SCOPE_RADIUS,
    mergedFrom: [unit.nodeId]
  };
}
function coalescingGroups(units) {
  const groups = [];
  for (const unit of units) {
    const group = groups.find((candidate) => candidate.every((member) => canCoalesce(member, unit)));
    if (group === void 0) groups.push([unit]);
    else group.push(unit);
  }
  return groups;
}
function canCoalesce(left, right) {
  if (!left.assessment.isLeaf || !right.assessment.isLeaf || left.forceComposite || right.forceComposite || hasCrossDependency(left, right)) {
    return false;
  }
  const overlap = left.targetScopePaths.some((path2) => right.targetScopePaths.includes(path2));
  if (overlap) return true;
  const paths = uniqueSorted([...left.targetScopePaths, ...right.targetScopePaths]);
  return paths.length <= SMALL_DIRECTORY_PATH_LIMIT && paths.length > 0 && paths.every((path2) => directoryOf(path2) === directoryOf(paths[0]));
}
function hasCrossDependency(left, right) {
  return (left.expectedDependencies ?? []).includes(right.nodeId) || (right.expectedDependencies ?? []).includes(left.nodeId);
}
function mergeUnits(units) {
  const dimensions = {
    scopeRadius: average(units.map((unit) => unit.complexity.scopeRadius)),
    interfaceImpact: average(units.map((unit) => unit.complexity.interfaceImpact)),
    validationSurface: average(units.map((unit) => unit.complexity.validationSurface)),
    contextTokenMass: average(units.map((unit) => unit.complexity.contextTokenMass))
  };
  const nodeId = units.map((unit) => unit.nodeId).join(":");
  const assessment2 = evaluateIntrinsicComplexity({ nodeId, ...dimensions });
  return {
    nodeId,
    title: units.map((unit) => unit.title).join(" + "),
    goal: units.map((unit) => unit.goal).join("\n"),
    targetScopePaths: uniqueSorted(units.flatMap((unit) => unit.targetScopePaths)),
    expectedDependencies: uniqueSorted(units.flatMap((unit) => unit.expectedDependencies ?? []).filter((id) => !units.some((unit) => unit.nodeId === id))),
    complexity: dimensions,
    proposedUnits: units.flatMap((unit) => unit.proposedUnits ?? []),
    assessment: assessment2,
    forceComposite: false,
    mergedFrom: units.flatMap((unit) => unit.mergedFrom)
  };
}
function sharedScopeLabel(units) {
  const paths = uniqueSorted(units.flatMap((unit) => unit.targetScopePaths));
  const sharedFile = paths.find((path2) => units.every((unit) => unit.targetScopePaths.includes(path2)));
  return sharedFile ?? directoryOf(paths[0] ?? ".");
}
function validateUnit(unit) {
  if (unit.nodeId.trim().length === 0) throw new TypeError("Proposed unit nodeId must be non-empty.");
  if (unit.targetScopePaths.length === 0) throw new TypeError(`Proposed unit ${unit.nodeId} must declare targetScopePaths.`);
}
function normalizePath(path2) {
  return path2.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}
function directoryOf(path2) {
  const separator = path2.lastIndexOf("/");
  return separator === -1 ? "." : path2.slice(0, separator);
}
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// src/granularity/thesis-metrics.ts
var ThesisMetricsCollector = class {
  constructor(store) {
    this.store = store;
  }
  store;
  async collect(input) {
    validateInput(input);
    const attemptedNodes = input.nodes.filter((node) => node.successful !== void 0);
    const successes = attemptedNodes.filter((node) => node.successful).length;
    const successRatePercent = attemptedNodes.length === 0 ? 0 : successes / attemptedNodes.length * 100;
    const denominator = input.executionTimeSeconds * input.tokenCost;
    const compositeNodes = input.nodes.filter((node) => !node.isLeaf);
    const childCounts = new Map(compositeNodes.map((node) => [node.nodeId, 0]));
    for (const node of input.nodes) {
      if (node.parentId !== null && childCounts.has(node.parentId)) {
        childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
      }
    }
    const metrics = {
      runId: input.runId,
      granularityEfficiencyIndex: denominator === 0 ? 0 : roundTo2(successRatePercent / denominator, 6),
      maxGraphDepth: maximumDepth(input.nodes),
      totalLeafCount: input.nodes.filter((node) => node.isLeaf).length,
      averageBranchingFactor: compositeNodes.length === 0 ? 0 : roundTo2([...childCounts.values()].reduce((sum, count) => sum + count, 0) / compositeNodes.length, 4),
      coalescedUnitsCount: input.coalescedUnitsCount,
      attemptSuccessRateByComplexity: successRates(attemptedNodes)
    };
    await this.store.save(input.runId, metrics);
    return metrics;
  }
};
var InMemoryThesisMetricsStore = class {
  metricsByRun = /* @__PURE__ */ new Map();
  save(runId, metrics) {
    this.metricsByRun.set(runId, structuredClone(metrics));
  }
  get(runId) {
    const metrics = this.metricsByRun.get(runId);
    return metrics === void 0 ? void 0 : structuredClone(metrics);
  }
};
function maximumDepth(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  let maximum = 0;
  for (const node of nodes) {
    const visited = /* @__PURE__ */ new Set();
    let depth = 0;
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) throw new Error(`Cycle detected while computing depth for ${node.nodeId}.`);
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (parent === void 0) throw new Error(`Node ${node.nodeId} references missing parent ${parentId}.`);
      depth += 1;
      parentId = parent.parentId;
    }
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}
function successRates(nodes) {
  const output = {
    low: { attempts: 0, successes: 0, successRate: 0 },
    medium: { attempts: 0, successes: 0, successRate: 0 },
    high: { attempts: 0, successes: 0, successRate: 0 }
  };
  for (const node of nodes) {
    const level = complexityLevel(node.complexityScore);
    output[level].attempts += 1;
    if (node.successful) output[level].successes += 1;
  }
  for (const level of Object.keys(output)) {
    const bucket = output[level];
    bucket.successRate = bucket.attempts === 0 ? 0 : roundTo2(bucket.successes / bucket.attempts, 4);
  }
  return output;
}
function complexityLevel(score) {
  if (score <= 3.5) return "low";
  if (score <= 7) return "medium";
  return "high";
}
function validateInput(input) {
  if (input.runId.trim().length === 0) throw new TypeError("runId must be non-empty.");
  if (!Number.isFinite(input.executionTimeSeconds) || input.executionTimeSeconds < 0) {
    throw new RangeError("executionTimeSeconds must be finite and non-negative.");
  }
  if (!Number.isFinite(input.tokenCost) || input.tokenCost < 0) {
    throw new RangeError("tokenCost must be finite and non-negative.");
  }
  const ids = input.nodes.map((node) => node.nodeId);
  if (new Set(ids).size !== ids.length) throw new Error("Thesis metric node ids must be unique.");
}
function roundTo2(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// src/granularity/policy.ts
var ADAPTIVE_GRANULARITY_POLICY = Object.freeze({
  leafThreshold: LEAF_COMPLEXITY_THRESHOLD,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: true,
  versionSuffix: ""
});
var SINGLE_LEAF_POLICY = Object.freeze({
  leafThreshold: 10,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: false,
  versionSuffix: "+condA"
});
var FINE_SPLIT_POLICY = Object.freeze({
  leafThreshold: -1,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: false,
  versionSuffix: "+condB"
});
var GRANULARITY_CONDITIONS = ["A", "B", "C"];
var LEGACY_POLICY_BY_CONDITION = {
  A: SINGLE_LEAF_POLICY,
  B: FINE_SPLIT_POLICY,
  C1: ADAPTIVE_GRANULARITY_POLICY
};
function resolveGranularityCondition(condition) {
  if (condition === void 0 || condition === "C" || condition === "C1" || condition === "C2") return "C";
  if (GRANULARITY_CONDITIONS.includes(condition)) return condition;
  throw new Error(`Unknown granularity condition "${condition}"; expected one of ${GRANULARITY_CONDITIONS.join(", ")}.`);
}
function granularityPolicyFor(condition) {
  const normalized = condition === "C" || condition === void 0 ? "C1" : condition;
  const policy = LEGACY_POLICY_BY_CONDITION[normalized];
  if (policy === void 0) {
    throw new Error(`Condition "${condition}" does not use the historical C_task policy.`);
  }
  return policy;
}

// src/llm/architect-pass.ts
function runArchitectPass(input, policy = ADAPTIVE_GRANULARITY_POLICY) {
  if (input.title.trim().length === 0 || input.goal.trim().length === 0) {
    throw new TypeError("Architect tasks require a non-empty title and goal.");
  }
  if (input.targetScopePaths.length === 0) {
    throw new TypeError(`Architect task ${input.nodeId} must declare targetScopePaths.`);
  }
  return {
    ...input,
    targetScopePaths: [...new Set(input.targetScopePaths)].sort(),
    assessment: evaluateIntrinsicComplexity(
      {
        nodeId: input.nodeId,
        ...input.complexity,
        ...input.rationale === void 0 ? {} : { rationale: input.rationale }
      },
      policy.weights,
      policy.leafThreshold
    )
  };
}
var ArchitectPass = class {
  assess(input, policy) {
    return runArchitectPass(input, policy);
  }
};

// src/compiler/graph-compiler-v3.ts
var MAX_COMPILER_DEPTH = 8;
var DEFAULT_ACCEPTANCE_INTENT_ID = "adaptive-goal";
function compileAdaptiveWorkUnitTree(input, policy = ADAPTIVE_GRANULARITY_POLICY) {
  const units = [];
  const assessments = {};
  const seenIds = /* @__PURE__ */ new Set();
  const acceptanceIntentIds = input.acceptanceIntentIds?.length ? [...new Set(input.acceptanceIntentIds)] : [DEFAULT_ACCEPTANCE_INTENT_ID];
  let coalescedUnitsCount = 0;
  const mergedFrom = {};
  const criticDecisions = [];
  const compile = (task, depth, forceComposite = false) => {
    if (depth > MAX_COMPILER_DEPTH) {
      throw new Error(`Adaptive work-unit tree exceeded compiler depth ${MAX_COMPILER_DEPTH} at ${task.nodeId}.`);
    }
    if (seenIds.has(task.nodeId)) throw new Error(`Duplicate adaptive unit key: ${task.nodeId}.`);
    seenIds.add(task.nodeId);
    const architect = runArchitectPass(task, policy);
    const assessment2 = forceComposite ? {
      ...architect.assessment,
      isLeaf: false,
      nodeKind: "CompositeNode",
      recommendedBranchingFactor: architect.assessment.recommendedBranchingFactor ?? 2,
      rationale: `${architect.assessment.rationale} Under-splitting critic forced re-splitting.`
    } : architect.assessment;
    assessments[task.nodeId] = assessment2;
    const common = {
      key: task.nodeId,
      title: task.title,
      objective: task.goal,
      concerns: [task.goal],
      expectedOutcomes: [`Complete ${task.title} within its declared scope.`],
      acceptanceIntentIds,
      evidenceIds: [],
      plannedPaths: [...architect.targetScopePaths]
    };
    if (assessment2.isLeaf) {
      const leaf = { ...common, kind: "leaf" };
      units.push(leaf);
      return leaf;
    }
    const proposals = task.proposedUnits ?? [];
    if (proposals.length === 0) {
      criticDecisions.push({
        kind: "resplit_declined",
        unitIds: [task.nodeId],
        rationale: `C_task=${assessment2.complexityScore.toFixed(2)} exceeds the leaf threshold, but the Architect proposed no sub-units for ${task.nodeId}; a mechanical split would fabricate incoherent scopes.`
      });
      assessments[task.nodeId] = {
        ...assessment2,
        isLeaf: true,
        nodeKind: "LeafNode",
        rationale: `${assessment2.rationale} Kept as a leaf: the Architect proposed no semantic sub-units.`
      };
      const leaf = { ...common, kind: "leaf" };
      units.push(leaf);
      return leaf;
    }
    const review = reviewGranularityProposal(proposals, policy.coalescingEnabled);
    coalescedUnitsCount += review.coalescedUnitsCount;
    criticDecisions.push(...review.decisions);
    for (const reviewed of review.units) {
      if (reviewed.mergedFrom.length > 1) mergedFrom[reviewed.nodeId] = [...reviewed.mergedFrom];
    }
    const composite = {
      ...common,
      kind: "composite",
      cut: {
        criterion: "cohesion",
        rationale: assessment2.rationale
      },
      children: review.units.map(
        (unit) => compile(
          {
            nodeId: unit.nodeId,
            title: unit.title,
            goal: unit.goal,
            targetScopePaths: unit.targetScopePaths,
            complexity: unit.complexity,
            ...unit.expectedDependencies === void 0 ? {} : { expectedDependencies: unit.expectedDependencies },
            ...unit.proposedUnits === void 0 || unit.proposedUnits.length === 0 ? {} : { proposedUnits: unit.proposedUnits }
          },
          depth + 1,
          unit.forceComposite
        )
      )
    };
    units.push(composite);
    return composite;
  };
  const root = compile(input, 0);
  return { root, units, assessments, coalescedUnitsCount, mergedFrom, criticDecisions };
}
var AdaptiveGranularityCompiler = class {
  compile(input, policy) {
    return compileAdaptiveWorkUnitTree(input, policy);
  }
};

// src/granularity/adaptive-planning.ts
var ADAPTIVE_GRANULARITY_FORMULA_VERSION = "c-task/1.0.0";
function applyAdaptiveGranularity(input) {
  const policy = input.policy ?? ADAPTIVE_GRANULARITY_POLICY;
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  const sources = /* @__PURE__ */ new Map();
  const preserved = /* @__PURE__ */ new Map();
  const pathEvidenceById = new Map(
    breakdown.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => [evidence.id, evidence.reference])
  );
  const architectRoot = toArchitectInput(breakdown.root, { sources, preserved, pathEvidenceById });
  const compiled = compileAdaptiveWorkUnitTree(architectRoot, policy);
  const assessments = {};
  for (const [key, assessment2] of Object.entries(compiled.assessments)) {
    assessments[key] = { ...assessment2, signalSource: sources.get(key) ?? "derived" };
  }
  const criticDecisions = [
    ...compiled.criticDecisions,
    ...collapseDecisions(assessments, breakdown.root)
  ];
  const restoredRoot = propagateAncestorAcceptance(restoreSemanticFields(
    compiled.root,
    preserved,
    compiled.mergedFrom,
    breakdown.root.acceptanceIntentIds,
    pathEvidenceById
  ));
  const survivors = unitKeys(restoredRoot);
  const absorbedBy = absorptionMap(breakdown.root, restoredRoot, compiled.mergedFrom, survivors);
  const reshaped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: restoredRoot,
    candidateArtifacts: remapRelations(breakdown.candidateArtifacts, absorbedBy),
    candidateSeams: remapRelations(breakdown.candidateSeams, absorbedBy)
  });
  const metrics = structuralMetrics(reshaped.root, compiled.coalescedUnitsCount);
  return {
    breakdown: reshaped,
    formulaVersion: `${ADAPTIVE_GRANULARITY_FORMULA_VERSION}${policy.versionSuffix}`,
    weights: { ...policy.weights },
    leafThreshold: policy.leafThreshold,
    assessments,
    criticDecisions,
    coalescedUnitsCount: compiled.coalescedUnitsCount,
    metrics
  };
}
function toArchitectInput(unit, context) {
  const paths = unitPaths(unit, context);
  const { dimensions, source } = acceptSignals(unit, paths);
  context.sources.set(unit.key, source);
  context.preserved.set(unit.key, {
    title: unit.title,
    objective: unit.objective,
    concerns: [...unit.concerns],
    expectedOutcomes: [...unit.expectedOutcomes],
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    evidenceIds: [...unit.evidenceIds],
    plannedPaths: unit.plannedPaths === void 0 ? void 0 : [...unit.plannedPaths]
  });
  return {
    nodeId: unit.key,
    title: unit.title,
    goal: unit.objective,
    targetScopePaths: paths,
    complexity: dimensions,
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    ...unit.complexitySignals?.rationale === void 0 ? {} : { rationale: unit.complexitySignals.rationale },
    ...unit.kind === "composite" && unit.children.length > 0 ? { proposedUnits: unit.children.map((child) => toProposedUnit(child, context)) } : {}
  };
}
function toProposedUnit(unit, context) {
  const paths = unitPaths(unit, context);
  const { dimensions, source } = acceptSignals(unit, paths);
  context.sources.set(unit.key, source);
  context.preserved.set(unit.key, {
    title: unit.title,
    objective: unit.objective,
    concerns: [...unit.concerns],
    expectedOutcomes: [...unit.expectedOutcomes],
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    evidenceIds: [...unit.evidenceIds],
    plannedPaths: unit.plannedPaths === void 0 ? void 0 : [...unit.plannedPaths]
  });
  return {
    nodeId: unit.key,
    title: unit.title,
    goal: unit.objective,
    targetScopePaths: paths,
    complexity: dimensions,
    expectedDependencies: [],
    ...unit.kind === "composite" && unit.children.length > 0 ? { proposedUnits: unit.children.map((child) => toProposedUnit(child, context)) } : {}
  };
}
function unitPaths(unit, context) {
  const fromEvidence = unit.evidenceIds.map((id) => context.pathEvidenceById.get(id)).filter((reference2) => reference2 !== void 0);
  const own = [...unit.plannedPaths ?? [], ...fromEvidence];
  if (own.length > 0) return [...new Set(own)];
  if (unit.kind === "composite") {
    const fromChildren = unit.children.flatMap((child) => unitPaths(child, context));
    if (fromChildren.length > 0) return [...new Set(fromChildren)];
  }
  return [];
}
function acceptSignals(unit, paths) {
  if (unit.complexitySignals === void 0) {
    return { dimensions: deriveSignals(unit, paths), source: "derived" };
  }
  const raw = unit.complexitySignals;
  const clamped = {
    scopeRadius: clampScopeRadius(raw.scopeRadius, paths.length),
    interfaceImpact: clampDimension(raw.interfaceImpact),
    validationSurface: clampDimension(raw.validationSurface),
    contextTokenMass: clampDimension(raw.contextTokenMass)
  };
  const changed = clamped.scopeRadius !== raw.scopeRadius || clamped.interfaceImpact !== raw.interfaceImpact || clamped.validationSurface !== raw.validationSurface || clamped.contextTokenMass !== raw.contextTokenMass;
  return { dimensions: clamped, source: changed ? "clamped" : "llm" };
}
function deriveSignals(unit, paths) {
  const pathCount = Math.max(paths.length, 1);
  return {
    scopeRadius: Math.min(10, pathCount),
    interfaceImpact: Math.min(10, unit.kind === "composite" ? pathCount : Math.ceil(pathCount / 2)),
    validationSurface: Math.min(10, unit.acceptanceIntentIds.length * 2),
    contextTokenMass: Math.min(10, pathCount * 1.5)
  };
}
function clampDimension(value) {
  return Math.min(10, Math.max(0, value));
}
function clampScopeRadius(value, pathCount) {
  if (pathCount === 0) return clampDimension(value);
  const floor = Math.min(10, Math.ceil(pathCount / 2));
  const ceiling = Math.min(10, pathCount + 2);
  return Math.min(ceiling, Math.max(floor, clampDimension(value)));
}
function restoreSemanticFields(unit, preserved, mergedFrom, rootAcceptanceIntentIds, pathEvidenceById) {
  const own = preserved.get(unit.key);
  const mergedSources = (mergedFrom[unit.key] ?? []).map((part) => preserved.get(part)).filter((fields2) => fields2 !== void 0);
  const parentKey = unit.key.includes(":part-") ? unit.key.slice(0, unit.key.lastIndexOf(":part-")) : void 0;
  const parentFields = parentKey === void 0 ? void 0 : preserved.get(parentKey);
  const fields = own ?? (mergedSources.length > 0 ? {
    title: mergedSources.map((source) => source.title).join(" + "),
    objective: mergedSources.map((source) => source.objective).join("\n"),
    concerns: uniqueValues(mergedSources.flatMap((source) => source.concerns)),
    expectedOutcomes: uniqueValues(mergedSources.flatMap((source) => source.expectedOutcomes)),
    acceptanceIntentIds: uniqueValues(mergedSources.flatMap((source) => source.acceptanceIntentIds)),
    evidenceIds: uniqueValues(mergedSources.flatMap((source) => source.evidenceIds)),
    plannedPaths: mergedPlannedPaths(mergedSources)
  } : {
    title: unit.title,
    objective: unit.objective,
    concerns: [...unit.concerns],
    expectedOutcomes: [...unit.expectedOutcomes],
    acceptanceIntentIds: parentFields === void 0 ? [...rootAcceptanceIntentIds] : [...parentFields.acceptanceIntentIds],
    // A synthesized part must own only ITS slice of the parent's surface.
    // Inheriting every evidence id would give each part the parent's whole
    // scope, making the split meaningless and forcing siblings to conflict
    // over the same files.
    evidenceIds: partEvidenceIds(unit.plannedPaths, parentFields, pathEvidenceById),
    // Likewise for declared new outputs: keep only the part's own slice.
    plannedPaths: partPlannedPaths(unit.plannedPaths, parentFields)
  });
  const common = {
    key: unit.key,
    title: fields.title,
    objective: fields.objective,
    concerns: fields.concerns,
    expectedOutcomes: fields.expectedOutcomes,
    acceptanceIntentIds: fields.acceptanceIntentIds,
    evidenceIds: fields.evidenceIds,
    ...fields.plannedPaths === void 0 || fields.plannedPaths.length === 0 ? {} : { plannedPaths: fields.plannedPaths }
  };
  if (unit.kind === "leaf") return { ...common, kind: "leaf" };
  return {
    ...common,
    kind: "composite",
    cut: unit.cut,
    children: unit.children.map((child) => restoreSemanticFields(child, preserved, mergedFrom, rootAcceptanceIntentIds, pathEvidenceById))
  };
}
function propagateAncestorAcceptance(unit, inherited = []) {
  const acceptanceIntentIds = uniqueValues([...inherited, ...unit.acceptanceIntentIds]);
  if (unit.kind === "leaf") return { ...unit, acceptanceIntentIds };
  return {
    ...unit,
    acceptanceIntentIds,
    children: unit.children.map((child) => propagateAncestorAcceptance(child, acceptanceIntentIds))
  };
}
function unitKeys(root) {
  return new Set(flattenUnits6(root).map((unit) => unit.key));
}
function absorptionMap(originalRoot, reshapedRoot, mergedFrom, survivors) {
  const absorbed = /* @__PURE__ */ new Map();
  for (const [mergedKey, sourceKeys] of Object.entries(mergedFrom)) {
    if (!survivors.has(mergedKey)) continue;
    for (const sourceKey of sourceKeys) absorbed.set(sourceKey, mergedKey);
  }
  const parents = /* @__PURE__ */ new Map();
  const indexParents = (unit) => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      parents.set(child.key, unit.key);
      indexParents(child);
    }
  };
  indexParents(originalRoot);
  for (const unit of flattenUnits6(originalRoot)) {
    if (absorbed.has(unit.key)) continue;
    if (survivors.has(unit.key)) {
      absorbed.set(unit.key, unit.key);
      continue;
    }
    let ancestor = parents.get(unit.key);
    while (ancestor !== void 0 && !survivors.has(ancestor) && !absorbed.has(ancestor)) {
      ancestor = parents.get(ancestor);
    }
    const target = ancestor === void 0 ? reshapedRoot.key : absorbed.get(ancestor) ?? ancestor;
    absorbed.set(unit.key, survivors.has(target) ? target : reshapedRoot.key);
  }
  return absorbed;
}
function remapRelations(relations, absorbedBy) {
  const remapped = [];
  for (const relation of relations) {
    const producer = absorbedBy.get(relation.producerUnitKey) ?? relation.producerUnitKey;
    const consumers = [...new Set(
      relation.consumerUnitKeys.map((key) => absorbedBy.get(key) ?? key).filter((key) => key !== producer)
    )];
    if (consumers.length === 0) continue;
    remapped.push({ ...relation, producerUnitKey: producer, consumerUnitKeys: consumers });
  }
  return remapped;
}
function collapseDecisions(assessments, originalRoot) {
  const originalComposites = new Set(flattenUnits6(originalRoot).filter((unit) => unit.kind === "composite").map((unit) => unit.key));
  const decisions = [];
  for (const [key, assessment2] of Object.entries(assessments)) {
    if (assessment2.isLeaf && originalComposites.has(key)) {
      decisions.push({
        kind: "coalesced",
        unitIds: [key],
        rationale: `Composite ${key} collapsed into a single leaf at C_task=${assessment2.complexityScore.toFixed(2)}.`
      });
    }
  }
  return decisions;
}
function structuralMetrics(root, coalescedUnitsCount) {
  let maxDepth = 0;
  let leafCount = 0;
  const branchingFactors = [];
  const visit = (unit, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    if (unit.kind === "leaf") {
      leafCount += 1;
      return;
    }
    branchingFactors.push(unit.children.length);
    for (const child of unit.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return {
    maxGraphDepth: maxDepth,
    totalLeafCount: leafCount,
    averageBranchingFactor: branchingFactors.length === 0 ? 0 : branchingFactors.reduce((sum, value) => sum + value, 0) / branchingFactors.length,
    coalescedUnitsCount
  };
}
function flattenUnits6(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits6)];
}
function mergedPlannedPaths(sources) {
  const paths = uniqueValues(sources.flatMap((source) => source.plannedPaths ?? []));
  return paths.length === 0 ? void 0 : paths;
}
function partEvidenceIds(assignedPaths, parentFields, pathEvidenceById) {
  if (parentFields === void 0) return [];
  if (assignedPaths === void 0) return [...parentFields.evidenceIds];
  const assigned = new Set(assignedPaths);
  return parentFields.evidenceIds.filter((id) => {
    const reference2 = pathEvidenceById.get(id);
    return reference2 !== void 0 && assigned.has(reference2);
  });
}
function partPlannedPaths(compiledPaths, parentFields) {
  if (compiledPaths === void 0 || parentFields?.plannedPaths === void 0) return void 0;
  const authored = new Set(parentFields.plannedPaths);
  const kept = compiledPaths.filter((path2) => authored.has(path2));
  return kept.length === 0 ? void 0 : kept;
}
function uniqueValues(values) {
  return [...new Set(values)];
}

// src/granularity/repository-context-profile.ts
var CONTEXT_ESTIMATOR_VERSION = "utf8-bytes-div-4/1.0.0";
function buildRepositoryContextProfiles(input) {
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  if (breakdown.repositorySnapshotId !== input.repositorySnapshot.snapshotId) {
    throw new Error(
      `WorkBreakdown references repository snapshot ${breakdown.repositorySnapshotId}, received ${input.repositorySnapshot.snapshotId}.`
    );
  }
  const pathEvidence = new Map(
    breakdown.repositoryEvidence.filter((item) => item.kind === "path").map((item) => [item.id, item])
  );
  const indexedFiles = new Map(
    (input.repositorySnapshot.index?.files ?? []).map((file) => [normalizePath2(file.path), file])
  );
  const surfaces = /* @__PURE__ */ new Map();
  collectSurface(breakdown.root, pathEvidence, surfaces);
  return Object.fromEntries(
    flattenUnits7(breakdown.root).map((unit) => {
      const surface = surfaces.get(unit.key) ?? emptySurface();
      const scopePaths = [...surface.paths].sort();
      let measuredExistingBytes = 0;
      let measuredExistingLines = 0;
      let measuredExistingPathCount = 0;
      let unmeasuredExistingPathCount = 0;
      let plannedPathCount = 0;
      for (const path2 of scopePaths) {
        const indexed = indexedFiles.get(path2);
        if (indexed !== void 0) {
          if (indexed.byteSize === void 0) {
            unmeasuredExistingPathCount += 1;
          } else {
            measuredExistingBytes += indexed.byteSize;
            measuredExistingLines += indexed.lineCount ?? 0;
            measuredExistingPathCount += 1;
          }
          continue;
        }
        if (surface.plannedPaths.has(path2)) {
          plannedPathCount += 1;
        } else {
          unmeasuredExistingPathCount += 1;
        }
      }
      const evidence = [...surface.pathEvidenceIds].map((id) => pathEvidence.get(id)).filter((item) => item !== void 0);
      const evidenceConfidence = evidence.length === 0 ? scopePaths.length === 0 ? 1 : 0 : mean(evidence.map((item) => item.confidence));
      const unmeasuredPlannedPathCount = plannedPathCount;
      const structuralUncertainty = scopePaths.length === 0 ? 0 : (unmeasuredExistingPathCount + unmeasuredPlannedPathCount) / scopePaths.length;
      const confidenceUncertainty = evidence.length === 0 && plannedPathCount > 0 ? structuralUncertainty : 1 - evidenceConfidence;
      const dispositionUncertainty = input.repositorySnapshot.inspectionDisposition === "unavailable" ? 1 : input.repositorySnapshot.inspectionDisposition === "partial" ? 0.25 : 0;
      const uncertainty = round4(Math.max(
        structuralUncertainty,
        confidenceUncertainty,
        dispositionUncertainty
      ));
      const profile = {
        unitKey: unit.key,
        estimatorVersion: CONTEXT_ESTIMATOR_VERSION,
        repositorySnapshotId: input.repositorySnapshot.snapshotId,
        snapshotDisposition: input.repositorySnapshot.inspectionDisposition,
        scopePaths,
        measuredExistingBytes,
        measuredExistingTokens: Math.ceil(measuredExistingBytes / 4),
        measuredExistingLines,
        measuredExistingPathCount,
        unmeasuredExistingPathCount,
        plannedPathCount,
        unmeasuredPlannedPathCount,
        evidenceConfidence: round4(evidenceConfidence),
        uncertainty,
        evidenceRefs: [...surface.pathEvidenceIds, input.repositorySnapshot.snapshotId]
      };
      return [unit.key, profile];
    })
  );
}
function collectSurface(unit, pathEvidence, output) {
  const surface = emptySurface();
  for (const path2 of unit.plannedPaths ?? []) {
    const normalized = normalizePath2(path2);
    surface.paths.add(normalized);
    surface.plannedPaths.add(normalized);
  }
  for (const id of unit.evidenceIds) {
    const evidence = pathEvidence.get(id);
    if (evidence === void 0) continue;
    surface.paths.add(normalizePath2(evidence.reference));
    surface.pathEvidenceIds.add(id);
  }
  if (unit.kind === "composite") {
    for (const child of unit.children) mergeSurface(surface, collectSurface(child, pathEvidence, output));
  }
  output.set(unit.key, surface);
  return surface;
}
function emptySurface() {
  return { paths: /* @__PURE__ */ new Set(), plannedPaths: /* @__PURE__ */ new Set(), pathEvidenceIds: /* @__PURE__ */ new Set() };
}
function mergeSurface(target, source) {
  for (const path2 of source.paths) target.paths.add(path2);
  for (const path2 of source.plannedPaths) target.plannedPaths.add(path2);
  for (const id of source.pathEvidenceIds) target.pathEvidenceIds.add(id);
}
function flattenUnits7(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits7)];
}
function normalizePath2(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function round4(value) {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

// src/granularity/utility-policy.ts
var ADAPTIVE_UTILITY_POLICY_VERSION = "adaptive-utility/3.1.0-pilot";
var PILOT_UTILITY_POLICY = Object.freeze({
  policyVersion: ADAPTIVE_UTILITY_POLICY_VERSION,
  minimumAdvantage: 0.15,
  maxLeafContextTokens: 24e3,
  maxLeafScopePaths: 40,
  // Provisional. W1 delivered with 10 planned paths and W2 failed with 6, so
  // these observations cannot anchor a discriminating value. Keep this fixed
  // pilot ceiling rather than tuning it per run.
  maxLeafPlannedPaths: 12
});
function validateUtilityPolicyConfig(config) {
  assertNonEmpty(config.policyVersion, "policyVersion");
  assertFinite(config.minimumAdvantage, "minimumAdvantage");
  assertNonNegative(config.maxLeafContextTokens, "maxLeafContextTokens");
  assertPositiveInteger(config.maxLeafScopePaths, "maxLeafScopePaths");
  assertPositiveInteger(config.maxLeafPlannedPaths, "maxLeafPlannedPaths");
  return { ...config };
}
function assertNonEmpty(value, label) {
  if (value.trim().length === 0) throw new TypeError(`${label} must be non-empty.`);
}
function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
}
function assertNonNegative(value, label) {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative.`);
}
function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

// src/granularity/strategy-selector.ts
import { createHash as createHash3 } from "crypto";
function candidateBreakdownHash(breakdown) {
  return stableHash(WorkBreakdownSchema.parse(breakdown));
}
function selectGranularityStrategy(input) {
  const config = validateUtilityPolicyConfig(input.config);
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  const candidateTreeHash = stableHash({
    root: breakdown.root,
    candidateArtifacts: breakdown.candidateArtifacts,
    candidateSeams: breakdown.candidateSeams
  });
  const profiles = buildRepositoryContextProfiles({
    breakdown,
    repositorySnapshot: input.repositorySnapshot
  });
  const assessments = {};
  const selected = selectUnit({
    unit: breakdown.root,
    condition: input.condition,
    isRoot: true,
    breakdown,
    profiles,
    config,
    candidateTreeHash,
    assessments
  });
  const selectedKeys = new Set(flattenUnits8(selected.unit).map((unit) => unit.key));
  const parentByKey = parentMap(breakdown.root);
  const selectedRoot = propagateAncestorAcceptance2(selected.unit);
  const remapped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: selectedRoot,
    candidateArtifacts: remapRelations2(
      breakdown.candidateArtifacts,
      selectedKeys,
      parentByKey
    ),
    candidateSeams: remapRelations2(
      breakdown.candidateSeams,
      selectedKeys,
      parentByKey
    )
  });
  return {
    condition: input.condition,
    policyVersion: config.policyVersion,
    candidateTreeHash,
    config,
    selectedBreakdown: remapped,
    assessments,
    requiresSemanticReplan: selected.decision === "semantic_replan"
  };
}
function propagateAncestorAcceptance2(unit, inherited = []) {
  const acceptanceIntentIds = unique([...inherited, ...unit.acceptanceIntentIds]);
  if (unit.kind === "leaf") return { ...unit, acceptanceIntentIds };
  return {
    ...unit,
    acceptanceIntentIds,
    children: unit.children.map((child) => propagateAncestorAcceptance2(child, acceptanceIntentIds))
  };
}
function selectUnit(input) {
  const profile = requireProfile(input.profiles, input.unit.key);
  const leafFeasible = isLeafFeasible(profile, input.config);
  const emptyFeatures = features({ uncertainty: profile.uncertainty });
  if (input.condition === "A" && input.isRoot) {
    input.assessments[input.unit.key] = assessment({
      unitKey: input.unit.key,
      candidateTreeHash: input.candidateTreeHash,
      selected: "leaf",
      leafFeasible,
      splitViable: input.unit.kind === "composite" && input.unit.children.length >= 2,
      features: emptyFeatures,
      minimumAdvantage: input.config.minimumAdvantage,
      evidenceRefs: profile.evidenceRefs,
      rationale: "Condition A keeps the complete goal as one leaf."
    });
    return { unit: collapseToLeaf(input.unit), decision: "leaf" };
  }
  if (input.unit.kind === "leaf") {
    const selected2 = input.condition === "C" && !leafFeasible ? "semantic_replan" : "leaf";
    input.assessments[input.unit.key] = assessment({
      unitKey: input.unit.key,
      candidateTreeHash: input.candidateTreeHash,
      selected: selected2,
      leafFeasible,
      splitViable: false,
      features: emptyFeatures,
      minimumAdvantage: input.config.minimumAdvantage,
      evidenceRefs: profile.evidenceRefs,
      rationale: selected2 === "semantic_replan" ? "Leaf exceeds the effective execution budget and has no semantic cut." : "Semantic leaf remains one executable unit."
    });
    return { unit: input.unit, decision: selected2 };
  }
  const children = input.unit.children.map((child) => selectUnit({
    ...input,
    unit: child,
    isRoot: false
  }));
  const splitFeatures = cutFeatures(
    input.unit,
    input.breakdown,
    input.profiles
  );
  const benefit = mean2([
    splitFeatures.contextRelief,
    splitFeatures.parallelism,
    splitFeatures.faultIsolation
  ]);
  const cost = mean2([
    splitFeatures.coordination,
    splitFeatures.pathOverlap,
    splitFeatures.validationDuplication,
    splitFeatures.uncertainty
  ]);
  const splitAdvantage = round42(benefit - cost);
  const splitViable = input.unit.children.length >= 2 && children.every((child) => child.decision !== "semantic_replan");
  let selected;
  if (input.condition === "B") {
    selected = splitViable ? "split" : "leaf";
  } else if (!leafFeasible) {
    selected = splitViable ? "split" : "semantic_replan";
  } else {
    selected = splitViable && splitAdvantage >= input.config.minimumAdvantage ? "split" : "leaf";
  }
  input.assessments[input.unit.key] = assessment({
    unitKey: input.unit.key,
    candidateTreeHash: input.candidateTreeHash,
    selected,
    leafFeasible,
    splitViable,
    features: splitFeatures,
    benefit,
    cost,
    splitAdvantage,
    minimumAdvantage: input.config.minimumAdvantage,
    evidenceRefs: profile.evidenceRefs,
    rationale: rationaleFor(input.condition, selected, leafFeasible, splitViable, splitAdvantage, input.config)
  });
  if (selected === "leaf") return { unit: collapseToLeaf(input.unit), decision: selected };
  if (selected === "semantic_replan") return { unit: input.unit, decision: selected };
  return {
    unit: { ...input.unit, children: children.map((child) => child.unit) },
    decision: selected
  };
}
function cutFeatures(unit, breakdown, profiles) {
  const parent = requireProfile(profiles, unit.key);
  const childProfiles = unit.children.map((child) => requireProfile(profiles, child.key));
  const maxChildTokens = Math.max(0, ...childProfiles.map((profile) => profile.measuredExistingTokens));
  const contextRelief = parent.measuredExistingTokens === 0 ? 0 : clamp01(1 - maxChildTokens / parent.measuredExistingTokens);
  const childKeys = unit.children.map((child) => child.key);
  const parallelism = concurrency(
    childKeys,
    crossChildEdges(unit.children, breakdown.candidateArtifacts)
  );
  const coordination = coupling(
    childKeys,
    crossChildEdges(unit.children, [
      ...breakdown.candidateArtifacts,
      ...breakdown.candidateSeams
    ])
  );
  const pathOverlap = averagePairwise(
    childProfiles.map((profile) => new Set(profile.scopePaths)),
    jaccard
  );
  const intentSets = unit.children.map((child) => new Set(child.acceptanceIntentIds));
  const faultIsolation = averagePairwise(intentSets, (left, right) => 1 - jaccard(left, right));
  const allAssignments = unit.children.flatMap((child) => child.acceptanceIntentIds);
  const validationDuplication = allAssignments.length === 0 ? 0 : (allAssignments.length - new Set(allAssignments).size) / allAssignments.length;
  return features({
    contextRelief,
    parallelism,
    faultIsolation,
    coordination,
    pathOverlap,
    validationDuplication,
    uncertainty: mean2(childProfiles.map((profile) => profile.uncertainty))
  });
}
function crossChildEdges(children, relations) {
  const owner = /* @__PURE__ */ new Map();
  for (const child of children) {
    for (const descendant of flattenUnits8(child)) owner.set(descendant.key, child.key);
  }
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const relation of relations) {
    const from = owner.get(relation.producerUnitKey);
    if (from === void 0) continue;
    for (const consumerKey of relation.consumerUnitKeys) {
      const to = owner.get(consumerKey);
      if (to === void 0 || to === from) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }
  return edges;
}
function concurrency(childKeys, edges) {
  if (childKeys.length < 2) return 0;
  const levels = criticalPathLength(childKeys, edges);
  if (levels === void 0) return 0;
  return clamp01((childKeys.length - levels) / (childKeys.length - 1));
}
function coupling(childKeys, edges) {
  if (childKeys.length < 2) return 0;
  const reduced = independentDependencyCount(childKeys, edges);
  if (reduced === void 0) return 1;
  return clamp01(2 * reduced / (childKeys.length * (childKeys.length - 1)));
}
function criticalPathLength(nodes, edges) {
  const remaining = new Map(nodes.map((key) => [key, 0]));
  const outgoing = outgoingMap(nodes, edges);
  for (const edge of edges) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);
  const level = new Map(nodes.map((key) => [key, 1]));
  const ready = nodes.filter((key) => remaining.get(key) === 0);
  let ordered = 0;
  while (ready.length > 0) {
    const key = ready.shift();
    ordered += 1;
    for (const next of outgoing.get(key) ?? []) {
      level.set(next, Math.max(level.get(next), level.get(key) + 1));
      const pending = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, pending);
      if (pending === 0) ready.push(next);
    }
  }
  return ordered === nodes.length ? Math.max(...level.values()) : void 0;
}
function independentDependencyCount(nodes, edges) {
  if (criticalPathLength(nodes, edges) === void 0) return void 0;
  const outgoing = outgoingMap(nodes, edges);
  const reachable = /* @__PURE__ */ new Map();
  const reach = (key) => {
    const cached = reachable.get(key);
    if (cached !== void 0) return cached;
    const output = /* @__PURE__ */ new Set();
    reachable.set(key, output);
    for (const next of outgoing.get(key) ?? []) {
      output.add(next);
      for (const far of reach(next)) output.add(far);
    }
    return output;
  };
  return edges.filter((edge) => !(outgoing.get(edge.from) ?? []).some(
    (next) => next !== edge.to && reach(next).has(edge.to)
  )).length;
}
function outgoingMap(nodes, edges) {
  const outgoing = new Map(nodes.map((key) => [key, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  return outgoing;
}
function collapseToLeaf(unit) {
  const units = flattenUnits8(unit);
  const plannedPaths = unique(units.flatMap((candidate) => candidate.plannedPaths ?? []));
  return {
    key: unit.key,
    kind: "leaf",
    title: unit.title,
    objective: unit.objective,
    concerns: unique(units.flatMap((candidate) => candidate.concerns)),
    expectedOutcomes: unique(units.flatMap((candidate) => candidate.expectedOutcomes)),
    acceptanceIntentIds: unique(units.flatMap((candidate) => candidate.acceptanceIntentIds)),
    evidenceIds: unique(units.flatMap((candidate) => candidate.evidenceIds)),
    ...plannedPaths.length === 0 ? {} : { plannedPaths }
  };
}
function remapRelations2(relations, selectedKeys, parentByKey) {
  return relations.flatMap((relation) => {
    const producer = nearestSelected(relation.producerUnitKey, selectedKeys, parentByKey);
    const consumers = unique(relation.consumerUnitKeys.map(
      (key) => nearestSelected(key, selectedKeys, parentByKey)
    )).filter((key) => key !== producer);
    return consumers.length === 0 ? [] : [{ ...relation, producerUnitKey: producer, consumerUnitKeys: consumers }];
  });
}
function nearestSelected(key, selectedKeys, parentByKey) {
  let candidate = key;
  while (candidate !== void 0) {
    if (selectedKeys.has(candidate)) return candidate;
    candidate = parentByKey.get(candidate);
  }
  throw new Error(`No selected ancestor exists for semantic unit ${key}.`);
}
function parentMap(root) {
  const output = /* @__PURE__ */ new Map();
  const visit = (unit) => {
    if (unit.kind === "leaf") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}
function assessment(input) {
  const benefit = round42(input.benefit ?? mean2([
    input.features.contextRelief,
    input.features.parallelism,
    input.features.faultIsolation
  ]));
  const cost = round42(input.cost ?? mean2([
    input.features.coordination,
    input.features.pathOverlap,
    input.features.validationDuplication,
    input.features.uncertainty
  ]));
  return {
    unitKey: input.unitKey,
    candidateTreeHash: input.candidateTreeHash,
    selected: input.selected,
    leafFeasible: input.leafFeasible,
    splitViable: input.splitViable,
    features: input.features,
    benefit,
    cost,
    splitAdvantage: round42(input.splitAdvantage ?? benefit - cost),
    minimumAdvantage: input.minimumAdvantage,
    evidenceRefs: [...input.evidenceRefs],
    rationale: input.rationale
  };
}
function features(input) {
  return {
    contextRelief: round42(clamp01(input.contextRelief ?? 0)),
    parallelism: round42(clamp01(input.parallelism ?? 0)),
    faultIsolation: round42(clamp01(input.faultIsolation ?? 0)),
    coordination: round42(clamp01(input.coordination ?? 0)),
    pathOverlap: round42(clamp01(input.pathOverlap ?? 0)),
    validationDuplication: round42(clamp01(input.validationDuplication ?? 0)),
    uncertainty: round42(clamp01(input.uncertainty ?? 0))
  };
}
function rationaleFor(condition, selected, leafFeasible, splitViable, splitAdvantage, config) {
  if (condition === "B") {
    return selected === "split" ? "Condition B expands the finest valid semantic frontier." : "Condition B found no valid multi-child semantic cut.";
  }
  if (selected === "semantic_replan") {
    return "Leaf is infeasible and the candidate contains no viable semantic split.";
  }
  if (selected === "split" && !leafFeasible) {
    return "Leaf is infeasible; C selected the available semantic split.";
  }
  if (selected === "split") {
    return `Split advantage ${splitAdvantage.toFixed(4)} meets minimum ${config.minimumAdvantage.toFixed(4)}.`;
  }
  return splitViable ? `Split advantage ${splitAdvantage.toFixed(4)} is below minimum ${config.minimumAdvantage.toFixed(4)}.` : "No valid multi-child semantic split is available; leaf remains cohesive.";
}
function isLeafFeasible(profile, config) {
  return profile.measuredExistingTokens <= config.maxLeafContextTokens && profile.scopePaths.length <= config.maxLeafScopePaths && profile.plannedPathCount <= config.maxLeafPlannedPaths;
}
function requireProfile(profiles, unitKey) {
  const profile = profiles[unitKey];
  if (profile === void 0) throw new Error(`Missing repository context profile for ${unitKey}.`);
  return profile;
}
function flattenUnits8(root) {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits8)];
}
function averagePairwise(values, compare) {
  if (values.length < 2) return 0;
  const comparisons = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      comparisons.push(compare(values[left], values[right]));
    }
  }
  return mean2(comparisons);
}
function jaccard(left, right) {
  const union = /* @__PURE__ */ new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}
function stableHash(value) {
  return `sha256:${createHash3("sha256").update(JSON.stringify(canonicalize3(value))).digest("hex")}`;
}
function canonicalize3(value) {
  if (Array.isArray(value)) return value.map(canonicalize3);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize3(item)])
    );
  }
  return value;
}
function unique(values) {
  return [...new Set(values)];
}
function mean2(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
function round42(value) {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

// src/context-compressor.ts
import { createHash as createHash4 } from "crypto";
function compressContext(input) {
  const files = input.files.map((file) => ({ path: normalizeRepositoryPath(file.path), content: file.content })).filter((file) => isAllowedByScope(file.path, input.scope)).sort((left, right) => left.path.localeCompare(right.path));
  const treeSummary = summarizeTreeByScope(files);
  const signaturesByFile = files.map((file) => {
    const signatures = extractInterfaceSignatures(file.content);
    return signatures.length === 0 ? "" : `// ${file.path}
${signatures}`;
  }).filter((value) => value.length > 0);
  const fingerprintSource = {
    scope: {
      id: input.scope.id,
      revision: input.scope.revision,
      nodeId: input.scope.nodeId,
      allowedPaths: [...input.scope.allowedPaths].sort(),
      forbiddenPaths: [...input.scope.forbiddenPaths].sort()
    },
    files,
    inputs: input.inputs
  };
  return {
    scopeNodeId: input.scope.nodeId,
    files,
    treeSummary,
    interfaceSignatures: signaturesByFile.join("\n\n"),
    inputFingerprint: computeInputFingerprint(fingerprintSource)
  };
}
function summarizeTreeByScope(files) {
  return [...new Set(files.map((file) => normalizeRepositoryPath(file.path)))].sort();
}
function extractInterfaceSignatures(source) {
  const searchable = maskCommentsAndStrings(source);
  const declarationPattern = /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(interface|type|function)\s+[A-Za-z_$][\w$]*/g;
  const declarations = [];
  for (const match of searchable.matchAll(declarationPattern)) {
    const kind = match[1];
    const start = match.index;
    if (start === void 0 || kind === void 0) continue;
    const declaration = extractDeclaration(source, searchable, start, kind);
    if (declaration !== void 0) declarations.push(normalizeDeclaration(declaration, kind));
  }
  return declarations.join("\n");
}
function computeInputFingerprint(value) {
  const digest = createHash4("sha256").update(JSON.stringify(canonicalize4(value))).digest("hex");
  return `sha256:${digest}`;
}
function extractDeclaration(source, searchable, start, kind) {
  if (kind === "interface") {
    const open = searchable.indexOf("{", start);
    if (open === -1) return void 0;
    const close = matchingDelimiter(searchable, open, "{", "}");
    return close === -1 ? void 0 : source.slice(start, close + 1);
  }
  if (kind === "type") {
    const end = findTopLevelSemicolon(searchable, start);
    return end === -1 ? void 0 : source.slice(start, end + 1);
  }
  const openParameters = searchable.indexOf("(", start);
  if (openParameters === -1) return void 0;
  const closeParameters = matchingDelimiter(searchable, openParameters, "(", ")");
  if (closeParameters === -1) return void 0;
  const terminator = findFunctionTerminator(searchable, closeParameters + 1);
  if (terminator === -1) return void 0;
  return source.slice(start, terminator);
}
function findFunctionTerminator(source, start) {
  let returnTypeBraceDepth = 0;
  let returnTypeColon = -1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === ":" && returnTypeBraceDepth === 0 && returnTypeColon === -1) returnTypeColon = index;
    if (character === ";" && returnTypeBraceDepth === 0) return index + 1;
    if (character === "{") {
      const opensObjectReturnType = returnTypeBraceDepth > 0 || returnTypeColon !== -1 && source.slice(returnTypeColon + 1, index).trim().length === 0;
      if (!opensObjectReturnType) return index;
      returnTypeBraceDepth += 1;
    } else if (character === "}" && returnTypeBraceDepth > 0) {
      returnTypeBraceDepth -= 1;
    }
  }
  return -1;
}
function findTopLevelSemicolon(source, start) {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let angles = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "<") angles += 1;
    else if (character === ">") angles = Math.max(0, angles - 1);
    else if (character === ";" && braces === 0 && brackets === 0 && parentheses === 0 && angles === 0) return index;
  }
  return -1;
}
function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
function normalizeDeclaration(declaration, kind) {
  const compact = declaration.replace(/\s+/g, " ").trim();
  if (kind !== "function") return compact;
  return `${compact.replace(/[;{]\s*$/, "").trim()};`;
}
function maskCommentsAndStrings(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\r\n]/g, " ")
  );
}
function isAllowedByScope(path2, scope) {
  return scope.allowedPaths.some((pattern) => globMatches(path2, pattern)) && !scope.forbiddenPaths.some((pattern) => globMatches(path2, pattern));
}
function globMatches(path2, rawPattern) {
  const pattern = normalizeRepositoryPath(rawPattern);
  const expression = pattern.split("**").map((part) => part.split("*").map(escapeRegExp).join("[^/]*")).join(".*");
  return new RegExp(`^${expression}$`).test(path2) || !pattern.includes("*") && (path2 === pattern || path2.startsWith(`${pattern.replace(/\/$/, "")}/`));
}
function normalizeRepositoryPath(path2) {
  const normalized = path2.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Repository context path escapes scope: ${path2}`);
  }
  return normalized;
}
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
function canonicalize4(value) {
  if (Array.isArray(value)) return value.map(canonicalize4);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize4(item)])
    );
  }
  return value;
}

// src/llm/anthropic-decomposer.ts
import Anthropic from "@anthropic-ai/sdk";

// src/llm/errors.ts
var DecomposerLlmError = class extends Error {
  llmCause;
  stage;
  details;
  /**
   * Resumable decomposer state at the moment this node's attempts were
   * exhausted. Populated by the recursive decomposer (from its in-flight
   * accumulator) right before throwing, so a retry can pick up the already-
   * generated siblings instead of restarting the whole tree from root.
   */
  stepCache;
  constructor(message, cause, stage, details) {
    super(message);
    this.name = "DecomposerLlmError";
    this.llmCause = cause;
    if (stage !== void 0) {
      this.stage = stage;
    }
    if (details !== void 0) {
      this.details = details;
    }
  }
};
function isDecomposerLlmError(value) {
  return value instanceof DecomposerLlmError;
}
function classifyGraphGenerationError(value, context = {}) {
  const base = value instanceof DecomposerLlmError ? value.details : void 0;
  const originalMessage = value instanceof Error ? value.message : value === void 0 ? "Unknown error" : String(value);
  const kind = base?.kind ?? inferErrorKind(originalMessage);
  const stage = context.stage ?? base?.stage ?? inferStage(kind, value);
  return {
    kind,
    stage,
    recoverable: base?.recoverable ?? isRecoverableGraphGenerationKind(kind),
    message: base?.message ?? originalMessage,
    originalMessage,
    ...context.nodeId !== void 0 ? { nodeId: context.nodeId } : base?.nodeId !== void 0 ? { nodeId: base.nodeId } : {},
    ...context.parentId !== void 0 ? { parentId: context.parentId } : base?.parentId !== void 0 ? { parentId: base.parentId } : {},
    ...context.attempt !== void 0 ? { attempt: context.attempt } : base?.attempt !== void 0 ? { attempt: base.attempt } : {},
    ...context.maxAttempts !== void 0 ? { maxAttempts: context.maxAttempts } : base?.maxAttempts !== void 0 ? { maxAttempts: base.maxAttempts } : {},
    ...context.durationMs !== void 0 ? { durationMs: context.durationMs } : base?.durationMs !== void 0 ? { durationMs: base.durationMs } : {},
    ...base?.responseExcerpt !== void 0 ? { responseExcerpt: base.responseExcerpt } : {}
  };
}
function isRecoverableGraphGenerationKind(kind) {
  switch (kind) {
    case "provider_timeout":
    case "provider_request":
    case "empty_response":
    case "missing_json":
    case "invalid_json":
    case "schema_invalid":
    case "duplicate_node_id":
    case "dangling_dependency":
    case "cycle_detected":
    case "graph_invalid":
      return true;
    case "unknown":
      return false;
  }
}
var DecomposerQuestionError = class extends Error {
  nodeId;
  question;
  options;
  stepCache;
  reasoning;
  constructor(nodeId, question, options, stepCache, reasoning) {
    super(`Clarification needed for node ${nodeId}: ${question}`);
    this.name = "DecomposerQuestionError";
    this.nodeId = nodeId;
    this.question = question;
    this.options = options;
    this.stepCache = stepCache;
    this.reasoning = reasoning;
  }
};
function isDecomposerQuestionError(value) {
  return value instanceof DecomposerQuestionError;
}
function inferStage(kind, value) {
  if (value instanceof DecomposerLlmError && value.stage !== void 0) {
    return value.stage;
  }
  switch (kind) {
    case "provider_timeout":
    case "provider_request":
      return "request";
    case "empty_response":
    case "missing_json":
    case "invalid_json":
      return "parse";
    case "schema_invalid":
    case "duplicate_node_id":
    case "dangling_dependency":
    case "cycle_detected":
      return "validate";
    case "graph_invalid":
      return "normalize";
    case "unknown":
      return "request";
  }
}
function inferErrorKind(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return "provider_timeout";
  }
  if (normalized.includes("empty response") || normalized.includes("contained no text")) {
    return "empty_response";
  }
  if (normalized.includes("no json") || normalized.includes("could not locate a json")) {
    return "missing_json";
  }
  if (normalized.includes("json.parse") || normalized.includes("invalid json") || normalized.includes("parse json")) {
    return "invalid_json";
  }
  if (normalized.includes("schema validation") || normalized.includes("schema invalid")) {
    return "schema_invalid";
  }
  if (normalized.includes("duplicate node id") || normalized.includes("duplicate child id")) {
    return "duplicate_node_id";
  }
  if (normalized.includes("unknown") && normalized.includes("depend")) {
    return "dangling_dependency";
  }
  if (normalized.includes("cycle")) {
    return "cycle_detected";
  }
  if (normalized.includes("invalid graph") || normalized.includes("graph generation failed")) {
    return "graph_invalid";
  }
  if (normalized.includes("request failed") || normalized.includes("exit code") || normalized.includes("network") || normalized.includes("econnreset") || normalized.includes("socket hang up") || normalized.includes("rate limit") || normalized.includes("429") || normalized.includes("503")) {
    return "provider_request";
  }
  return "unknown";
}

// src/llm/guards.ts
var MAX_NODES_SAFETY_RAIL = 200;
function runDecomposerGuards(output) {
  if (output.nodes.length === 0) {
    throw new DecomposerLlmError("decomposition produced no nodes", void 0, "validate");
  }
  if (output.nodes.length > MAX_NODES_SAFETY_RAIL) {
    throw new DecomposerLlmError(
      `node count ${output.nodes.length} exceeds the safety rail of ${MAX_NODES_SAFETY_RAIL}`,
      void 0,
      "validate"
    );
  }
  const idSet = /* @__PURE__ */ new Set();
  for (const node of output.nodes) {
    if (idSet.has(node.id)) {
      throw new DecomposerLlmError(`duplicate node id: ${node.id}`, void 0, "validate");
    }
    idSet.add(node.id);
  }
  const roots = output.nodes.filter((node) => node.parentId === null);
  if (roots.length === 0) {
    throw new DecomposerLlmError("no root node (parentId === null) found", void 0, "validate");
  }
  if (roots.length > 1) {
    throw new DecomposerLlmError(`expected exactly one root, found ${roots.length}`, void 0, "validate");
  }
  const root = roots[0];
  if (root.depth !== 0) {
    throw new DecomposerLlmError(`root node ${root.id} must have depth 0, got ${root.depth}`, void 0, "validate");
  }
  for (const node of output.nodes) {
    if (node.parentId !== null && !idSet.has(node.parentId)) {
      throw new DecomposerLlmError(
        `node ${node.id} references unknown parentId ${node.parentId}`,
        void 0,
        "validate"
      );
    }
  }
  const byId = new Map(output.nodes.map((node) => [node.id, node]));
  for (const node of output.nodes) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent && node.depth !== parent.depth + 1) {
        throw new DecomposerLlmError(
          `node ${node.id} depth ${node.depth} does not equal parent ${parent.id} depth + 1`,
          void 0,
          "validate"
        );
      }
    }
  }
  for (const node of output.nodes) {
    if (node.kind === "leaf" && node.acceptanceCriteria.length === 0) {
      throw new DecomposerLlmError(
        `leaf node ${node.id} must declare at least one acceptanceCriteria entry`,
        void 0,
        "validate"
      );
    }
  }
  for (const dependency2 of output.dependencies) {
    if (!idSet.has(dependency2.fromTaskId)) {
      throw new DecomposerLlmError(
        `dependency references unknown fromTaskId ${dependency2.fromTaskId}`,
        void 0,
        "validate"
      );
    }
    if (!idSet.has(dependency2.toTaskId)) {
      throw new DecomposerLlmError(
        `dependency references unknown toTaskId ${dependency2.toTaskId}`,
        void 0,
        "validate"
      );
    }
    if (dependency2.fromTaskId === dependency2.toTaskId) {
      throw new DecomposerLlmError(
        `dependency self-loop on ${dependency2.fromTaskId}`,
        void 0,
        "validate"
      );
    }
  }
  const adjacency = /* @__PURE__ */ new Map();
  for (const dependency2 of output.dependencies) {
    const list = adjacency.get(dependency2.fromTaskId) ?? [];
    list.push(dependency2.toTaskId);
    adjacency.set(dependency2.fromTaskId, list);
  }
  const colors = /* @__PURE__ */ new Map();
  for (const node of output.nodes) colors.set(node.id, "white");
  function dfs(nodeId) {
    colors.set(nodeId, "gray");
    for (const neighbour of adjacency.get(nodeId) ?? []) {
      const colour = colors.get(neighbour);
      if (colour === "gray") {
        throw new DecomposerLlmError(
          `dependency cycle detected involving ${nodeId} \u2192 ${neighbour}`,
          void 0,
          "validate"
        );
      }
      if (colour === "white") dfs(neighbour);
    }
    colors.set(nodeId, "black");
  }
  for (const node of output.nodes) {
    if (colors.get(node.id) === "white") dfs(node.id);
  }
}

// src/llm/normalize.ts
var DEFAULT_MAX_DURATION_MS = 30 * 60 * 1e3;
var DEFAULT_MAX_COST_USD = 1.5;
function normalizeLlmDecomposition(input) {
  const granularity = granularityForMode(input.mode);
  const planId = `${input.feature.id}:${input.mode}:plan`;
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const node of input.output.nodes) {
    if (node.parentId !== null) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node.id);
      childrenByParent.set(node.parentId, list);
    }
  }
  const rootCandidate = input.output.nodes.find((node) => node.parentId === null);
  if (rootCandidate === void 0) {
    throw new DecomposerLlmError("no root node after validation; this should not happen", void 0, "normalize");
  }
  const nodes = {};
  const contracts = [];
  for (const llmNode of input.output.nodes) {
    const children = childrenByParent.get(llmNode.id) ?? [];
    const nodeKind = llmNode.parentId === null ? "root" : llmNode.kind;
    const node = {
      id: llmNode.id,
      parentId: llmNode.parentId,
      kind: nodeKind,
      title: llmNode.title,
      goal: llmNode.goal,
      status: "planned",
      granularity,
      depth: llmNode.depth,
      childrenIds: children,
      metadata: {
        authoredBy: "ai"
      }
    };
    if (llmNode.kind === "leaf") {
      const contract = buildContract(input.feature, llmNode);
      node.contract = contract;
      contracts.push(contract);
    }
    nodes[llmNode.id] = node;
  }
  const graph = {
    id: `${input.feature.id}:${input.mode}:graph`,
    planId,
    repo: input.repo,
    baseBranch: input.baseBranch,
    baseCommit: input.baseCommit,
    featureRequest: input.feature.title,
    nodes,
    dependencies: input.output.dependencies.map((dependency2) => ({
      fromTaskId: dependency2.fromTaskId,
      toTaskId: dependency2.toTaskId,
      type: dependency2.type,
      inferred: false,
      ...dependency2.rationale !== void 0 ? { rationale: dependency2.rationale } : {}
    })),
    rootId: rootCandidate.id,
    createdAt: input.generatedAt
  };
  const metadata = {
    mode: input.mode,
    generatedAt: input.generatedAt,
    decomposer: input.decomposerLabel,
    deterministic: false
  };
  return {
    feature: input.feature,
    graph,
    contracts,
    metadata,
    validation: {
      graphValid: true,
      contractValid: true,
      issues: []
    }
  };
}
function granularityForMode(mode) {
  switch (mode) {
    case "coarse":
      return "coarse";
    case "balanced":
      return "medium";
    case "fine":
      return "fine";
    case "auto":
      return "medium";
  }
}
function buildContract(feature, llmNode) {
  const acceptance = llmNode.acceptanceCriteria.map((description) => ({
    kind: "custom",
    description
  }));
  const allowedPaths = llmNode.allowedPaths.length > 0 ? llmNode.allowedPaths : [feature.repositoryPath ?? "src/**"];
  const objective = llmNode.objective !== void 0 && llmNode.objective.length > 0 ? llmNode.objective : llmNode.goal;
  return {
    taskId: llmNode.id,
    objective,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: feature.constraints,
      upstreamArtifacts: []
    },
    allowed: { paths: allowedPaths },
    forbidden: { paths: llmNode.forbiddenPaths },
    // V2 execution-time scope, derived from the same resolved paths so the
    // executor's ScopeChecker actually enforces (allowedPaths is non-empty here).
    executionScope: executionScopeFromAllowed(allowedPaths),
    forbiddenPaths: llmNode.forbiddenPaths,
    relevantSymbols: [],
    dependencies: [],
    acceptance: acceptance.length > 0 ? acceptance : [{ kind: "custom", description: `Complete: ${llmNode.title}` }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: llmNode.expectedFiles,
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
      maxCostUsd: DEFAULT_MAX_COST_USD
    },
    knownRisks: [],
    definitionOfDone: llmNode.acceptanceCriteria[0] ?? `Complete: ${llmNode.title}`
  };
}

// src/llm/output-schema.ts
import { z as z4 } from "zod";
var DecomposerLlmNodeSchema = z4.object({
  id: z4.string().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/, "id must be lowercase, start with a letter, and contain only [a-z0-9_-]"),
  parentId: z4.string().nullable(),
  title: z4.string().min(1).max(160),
  goal: z4.string().min(1).max(600),
  kind: z4.union([z4.literal("composite"), z4.literal("leaf")]),
  depth: z4.number().int().min(0).max(10),
  objective: z4.string().max(800).optional(),
  allowedPaths: z4.array(z4.string().min(1)).max(60).default([]),
  forbiddenPaths: z4.array(z4.string().min(1)).max(60).default([]),
  expectedFiles: z4.array(z4.string().min(1)).max(60).default([]),
  acceptanceCriteria: z4.array(z4.string().min(1).max(400)).max(20).default([])
});
var DecomposerLlmDependencySchema = z4.object({
  fromTaskId: z4.string().min(1),
  toTaskId: z4.string().min(1),
  type: z4.union([
    z4.literal("contractual"),
    z4.literal("structural"),
    z4.literal("logical")
  ]),
  rationale: z4.string().max(400).optional()
});
var DecomposerLlmOutputSchema = z4.object({
  title: z4.string().min(1).max(160),
  summary: z4.string().min(1).max(1200),
  assumptions: z4.array(z4.string().min(1).max(400)).max(20).default([]),
  risks: z4.array(z4.string().min(1).max(400)).max(20).default([]),
  nodes: z4.array(DecomposerLlmNodeSchema).min(1).max(40),
  dependencies: z4.array(DecomposerLlmDependencySchema).max(80).default([])
});

// src/llm/prompt-template.ts
var DECOMPOSER_PROMPT_TEMPLATE_VERSION = "manyhands.decomposer-prompt.v1";
var GRANULARITY_PROFILES = {
  coarse: {
    label: "coarse",
    aggressiveness: "Low pressure to split. Decompose only nodes that are clearly composite; leave naturally cohesive work as a single leaf.",
    cohesiveUnit: "a whole module or file (a group of related functions that ship together)"
  },
  balanced: {
    label: "balanced",
    aggressiveness: "Balanced pressure. Split tasks and subtasks as needed until each leaf is a reasonably executable unit.",
    cohesiveUnit: "a small group of closely-related functions"
  },
  fine: {
    label: "fine",
    aggressiveness: "High pressure to split. Keep decomposing until every leaf is small, concrete, assignable and verifiable.",
    cohesiveUnit: "a single function or a tightly-scoped pair of functions"
  },
  // Single-pass prompting cannot adapt per-branch, so "auto" maps to the
  // balanced profile here. True adaptive behaviour lives in the recursive
  // decomposer's per-node step prompt.
  auto: {
    label: "auto",
    aggressiveness: "Balanced pressure. Split tasks and subtasks as needed until each leaf is a reasonably executable unit.",
    cohesiveUnit: "a small group of closely-related functions"
  }
};
function buildDecomposerPrompt(inputs) {
  const profile = GRANULARITY_PROFILES[inputs.granularity];
  const workspaceHintsBlock = inputs.workspaceHints !== void 0 ? formatWorkspaceHints(inputs.workspaceHints) : "No workspace hints provided.";
  const system = SYSTEM_PROMPT.replace("{{outputSchema}}", OUTPUT_SCHEMA_LITERAL);
  const user = [
    "## User goal (free text from developer)",
    "",
    inputs.userPrompt.length > 0 ? inputs.userPrompt : "(empty prompt; use workspace hints to propose a small generic feature)",
    "",
    "## Decomposition aggressiveness",
    "",
    `- level: \`${profile.label}\``,
    `- ${profile.aggressiveness}`,
    `- A leaf is "a single cohesive unit" = ${profile.cohesiveUnit}. Keep splitting a branch until its`,
    "  leaves reach that size, then stop.",
    "- Decide per task by complexity: a simple branch may be a single leaf while a complex one nests",
    "  several levels deeper. Do NOT aim for a fixed node count or a uniform depth \u2014 an asymmetric,",
    "  irregular tree that mirrors real complexity is the correct outcome.",
    "",
    "## Workspace hints",
    "",
    workspaceHintsBlock,
    "",
    "## Output requirements",
    "",
    "- Return STRICTLY valid JSON matching the schema above. No prose, no markdown, no backticks.",
    "- Exactly one root node with `parentId: null` and `depth: 0`.",
    "- Each `parentId` must reference an existing node `id`.",
    "- `dependencies` may not include cycles. They reference task `id`s.",
    "- Each `leaf` node must have at least one `acceptanceCriteria` item.",
    "- IDs must be lowercase, start with a letter, contain only [a-z0-9_-].",
    '- Prefer concrete, scoped tasks. Avoid generic placeholders like "build feature".'
  ].join("\n");
  return { system, user };
}
function formatWorkspaceHints(hints) {
  const lines = [`- name: ${hints.name}`];
  if (hints.repoPath !== void 0) lines.push(`- repoPath: ${hints.repoPath}`);
  if (hints.packageManager !== void 0) lines.push(`- packageManager: ${hints.packageManager}`);
  if (hints.defaultBranch !== void 0) lines.push(`- defaultBranch: ${hints.defaultBranch}`);
  if (hints.allowedPaths !== void 0 && hints.allowedPaths.length > 0) {
    lines.push(`- allowedPaths: ${hints.allowedPaths.slice(0, 12).join(", ")}`);
  }
  if (hints.testCommand !== void 0) lines.push(`- testCommand: ${hints.testCommand}`);
  if (hints.buildCommand !== void 0) lines.push(`- buildCommand: ${hints.buildCommand}`);
  return lines.join("\n");
}
var OUTPUT_SCHEMA_LITERAL = `{
  "title": "string (max 160)",
  "summary": "string (max 1200)",
  "assumptions": ["string (max 400)", "..."],
  "risks": ["string (max 400)", "..."],
  "nodes": [
    {
      "id": "kebab-or-snake string [a-z][a-z0-9_-]*",
      "parentId": "string | null",
      "kind": "composite | leaf",
      "depth": 0,
      "title": "string",
      "goal": "string",
      "objective": "string (optional)",
      "allowedPaths": ["string", "..."],
      "forbiddenPaths": ["string", "..."],
      "expectedFiles": ["string", "..."],
      "acceptanceCriteria": ["string", "..."]
    }
  ],
  "dependencies": [
    {
      "fromTaskId": "string",
      "toTaskId": "string",
      "type": "contractual | structural | logical",
      "rationale": "string (optional)"
    }
  ]
}`;
var SYSTEM_PROMPT = [
  "You are a senior software engineer acting as a planning agent inside ManyHands, a multi-agent orchestration tool.",
  "",
  "Your job: decompose a free-text developer goal into a hierarchical DAG of atomic tasks that smaller subagents can implement in isolation.",
  "",
  "Rules:",
  "- Produce a tree of composite + leaf nodes. Leaves are the unit of subagent work.",
  "- Prefer narrow scopes per leaf: a focused file/module change with clear acceptance criteria.",
  "- Include explicit `allowedPaths` and `forbiddenPaths` per leaf when the workspace hints suggest a structure.",
  "- Add `dependencies` only when execution order matters (e.g., DB migration must precede repository layer).",
  "- Do NOT hallucinate file paths if no workspace hints exist; leave arrays empty.",
  "- The output is consumed by a strict JSON validator. Any deviation breaks the canvas; the system will fall back to a deterministic decomposer.",
  "",
  "Output JSON schema (must match exactly):",
  "",
  "{{outputSchema}}"
].join("\n");

// src/llm/anthropic-decomposer.ts
var AnthropicDecomposer = class {
  client;
  model;
  maxTokens;
  promptTemplateVersion;
  userPrompt;
  workspaceHints;
  lastResponse = null;
  constructor(options) {
    this.client = options.client ?? new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 6e4
    });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 8e3;
    this.promptTemplateVersion = options.promptTemplateVersion ?? DECOMPOSER_PROMPT_TEMPLATE_VERSION;
    this.userPrompt = options.userPrompt;
    if (options.workspaceHints !== void 0) {
      this.workspaceHints = options.workspaceHints;
    }
  }
  async decompose(input, options = {}) {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const mode = parsedOptions.mode;
    const { system, user } = buildDecomposerPrompt({
      userPrompt: this.userPrompt,
      granularity: mode,
      ...this.workspaceHints !== void 0 ? { workspaceHints: this.workspaceHints } : {}
    });
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      });
    } catch (error) {
      throw new DecomposerLlmError(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
        "request"
      );
    }
    const text = extractText(response.content);
    if (text.length === 0) {
      throw new DecomposerLlmError("Anthropic response contained no text block", void 0, "parse");
    }
    const json = extractJson(text);
    if (json === null) {
      throw new DecomposerLlmError("Could not locate a JSON object in the model response", void 0, "parse");
    }
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new DecomposerLlmError(
        `Failed to JSON.parse model output: ${error instanceof Error ? error.message : String(error)}`,
        error,
        "parse"
      );
    }
    const schemaResult = DecomposerLlmOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      const first = schemaResult.error.issues[0];
      throw new DecomposerLlmError(
        `Output schema validation failed: ${first?.path.join(".") ?? "?"} \u2014 ${first?.message ?? "unknown"}`,
        schemaResult.error,
        "validate"
      );
    }
    runDecomposerGuards(schemaResult.data);
    const generatedAt = parsedOptions.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
    const result = normalizeLlmDecomposition({
      feature,
      output: schemaResult.data,
      mode,
      generatedAt,
      decomposerLabel: `anthropic:${this.model}`,
      baseBranch: parsedOptions.baseBranch,
      baseCommit: parsedOptions.baseCommit,
      repo: parsedOptions.repo ?? feature.repositoryPath ?? "manyhands-workspace"
    });
    this.lastResponse = {
      result,
      rawResponse: capRawResponse(text),
      parsedOutput: schemaResult.data,
      promptTemplateVersion: this.promptTemplateVersion,
      ...response.usage !== void 0 ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } } : {}
    };
    return result;
  }
  /** Returns the metadata captured during the most recent `decompose` call (for RunRecord persistence). */
  getLastResponse() {
    return this.lastResponse;
  }
};
var MAX_RAW_RESPONSE_BYTES = 64 * 1024;
function capRawResponse(text) {
  if (Buffer.byteLength(text, "utf8") <= MAX_RAW_RESPONSE_BYTES) return text;
  return `${text.slice(0, MAX_RAW_RESPONSE_BYTES)}\u2026[truncated]`;
}
function extractText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}
function extractJson(text) {
  if (text.startsWith("{") && text.endsWith("}")) return text;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

// src/llm/recursive/recursive-decomposer.ts
import Anthropic2 from "@anthropic-ai/sdk";
import {
  validateTaskGraph
} from "@manyhands/task-graph";

// src/llm/recursive/step-prompt.ts
var RECURSIVE_DECOMPOSER_PROMPT_VERSION = "manyhands.recursive-decomposer-prompt.v3";
var COHESIVE_UNIT = {
  low: "a whole module or file (a group of related functions that ship together). Low pressure to split: only decompose nodes that are clearly composite.",
  medium: "a small group of closely-related functions. Balanced pressure: split until each leaf is a reasonably executable unit.",
  high: "a single function or a tightly-scoped pair of functions. High pressure: keep splitting until every leaf is small, concrete, assignable and verifiable.",
  // Adaptive: the model sets the threshold for THIS node from its own complexity.
  auto: "whatever size matches THIS node's complexity \u2014 you choose. First judge how complex this specific node is: a simple, self-contained node should stay a larger leaf (a whole module or file) and go atomic sooner; a complex, multi-concern node should split into smaller leaves (down to closely-related functions, or a single function when the concern is genuinely fine-grained). Calibrate the split pressure per branch, not uniformly across the tree."
};
function buildStepPrompt(inputs) {
  const system = SYSTEM_PROMPT2.replace("{{outputSchema}}", OUTPUT_SCHEMA_LITERAL2);
  const interfacesBlock = inputs.inheritedInterfaces.length > 0 ? inputs.inheritedInterfaces.map((i) => `- ${i.id} (${i.kind}): ${i.signature}
    ${i.description}`).join("\n") : "(none \u2014 this node is at or near the top of the tree)";
  const user = [
    "## Node to judge",
    "",
    `- title: ${inputs.title}`,
    `- goal: ${inputs.goal}`,
    "",
    "## Decomposition aggressiveness",
    "",
    `- level: \`${inputs.aggressiveness}\``,
    `- At this level, "a single cohesive unit" means: **${COHESIVE_UNIT[inputs.aggressiveness]}**.`,
    "- Decide locally: split only if this node is NOT yet a single cohesive unit at the level above.",
    "  Do not aim for any particular tree depth or node count \u2014 sibling branches may end at different",
    "  depths, and that is expected.",
    ...inputs.atDepthLimit ? [
      "- NOTE: a recursion safety limit has been reached for this branch. Return",
      '  `decision: "atomic"` now even if you would otherwise split.'
    ] : [],
    "",
    ...inputs.userQuestion !== void 0 && inputs.userAnswer !== void 0 ? [
      "## User feedback on this node",
      "",
      `- You previously asked: "${inputs.userQuestion}"`,
      `- The user responded: "${inputs.userAnswer}"`,
      "- Use this feedback to resolve the ambiguity and make your final decision (do NOT output a question decision again for this node).",
      ""
    ] : [],
    "## Interfaces already in scope (you may have children consume these)",
    "",
    interfacesBlock,
    "",
    "## Workspace hints",
    "",
    inputs.workspaceHints ?? "(none)",
    "",
    "## Your task",
    "",
    "Apply the atomicity rubric to the node above and return STRICTLY valid JSON",
    "matching the schema. If you decompose, define the shared interfaces (seams)",
    "the children build against, and wire each child's `consumes`/`produces` to",
    "those interface ids. No prose outside the JSON."
  ].join("\n");
  return { system, user };
}
var OUTPUT_SCHEMA_LITERAL2 = `// One of these three shapes (discriminated by "decision"):

// ATOMIC \u2014 the node is a single implementable unit:
{
  "decision": "atomic",
  "reasoning": "string (why it is atomic at this aggressiveness)",
  "allowedPaths": ["glob", "..."],
  "forbiddenPaths": ["glob", "..."],
  "expectedFiles": ["concrete/file/path.ts", "..."],
  "acceptanceCriteria": ["string", "..."],   // at least one
  "leafValidationCommands": [
    { "command": "npm", "args": ["test", "--", "src/x.test.ts"] }
  ]  // optional focused commands that verify this leaf after implementation
}

// DECOMPOSE \u2014 split into children sharing explicit seams:
{
  "decision": "decompose",
  "reasoning": "string (why it must be split)",
  "sharedInterfaces": [
    {
      "id": "PascalOrCamel identifier",
      "kind": "type | function | module",
      "signature": "the real TS signature/definition, not just the name",
      "description": "what it does and the guarantees it offers"
    }
  ],
  "children": [
    {
      "id": "kebab-or-snake [a-z][a-z0-9_-]*",
      "title": "string",
      "goal": "string",
      "kind": "composite | leaf (optional hint)",
      "consumes": ["interfaceId", "..."],
      "produces": ["interfaceId", "..."]
    }
  ],
  "dependencies": [
    { "fromTaskId": "childId", "toTaskId": "childId", "type": "contractual | structural | logical", "rationale": "string (optional)" }
  ],  // default to []; ordering only, never predecessor file materialization
  "parentValidationCommands": [
    { "command": "npm", "args": ["test"] }
  ]
}

// QUESTION \u2014 ask a clarifying question before deciding (only for true ambiguity or design forks):
{
  "decision": "question",
  "reasoning": "string (why you need clarification)",
  "question": "string (clear, direct multiple-choice question to the user)",
  "options": ["option 1 string", "option 2 string", "..."] // 2 to 10 options
}`;
var SYSTEM_PROMPT2 = [
  "You are a senior software architect acting as the recursive planning agent inside ManyHands.",
  "",
  "You judge ONE node at a time. Your decision: is this node a single implementable unit",
  "(`atomic`), or must it be split into children that smaller subagents implement in isolation",
  "(`decompose`)? Or, if there is a major architectural/scope ambiguity or a design fork that",
  "you must resolve before deciding, you can ask the user a clarifying question (`question`).",
  "",
  "## Atomicity rubric \u2014 a node is ATOMIC when ALL of these hold:",
  "1. It maps to a single cohesive unit of implementation (the size of that unit is set by the",
  "   aggressiveness level given in the user message).",
  "2. Its acceptance criteria are verifiable by a focused test.",
  "3. It is self-contained given only: its goal, the interfaces it consumes, and the current",
  "   contents of its target files.",
  "4. It does NOT need to define a new shared abstraction that sibling tasks would depend on.",
  "   If it does, that abstraction belongs in this node's `sharedInterfaces` and the node must",
  "   DECOMPOSE so the abstraction becomes an explicit seam.",
  "",
  "## Absolute floor (regardless of aggressiveness):",
  "A leaf is NEVER smaller than a single coherent function. Do not split a single function into",
  "sub-steps (e.g. 'validate input' + 'run logic' + 'return'). That would create artificial",
  "coordination and conflicts. If the smallest sensible unit is one function, the node is atomic.",
  "",
  "## Clarifying questions to the user:",
  'Use `decision: "question"` very sparingly, only when you face true design forks or ambiguity',
  "(such as choice of library, state management strategy, database vs localStorage persistency) that",
  "significantly alters the graph decomposition structure. State your query clearly as a",
  "multiple-choice question with 2 to 10 options in `options`. Keep each option a concise",
  "label (well under 240 characters) \u2014 put any rationale in `reasoning`, not in the options.",
  "List the single most reasonable default option FIRST: an unattended (autonomous) run",
  "picks options[0], so it must be the safe, sensible default.",
  "",
  "## When you decompose \u2014 design the seams:",
  "- `sharedInterfaces` are the contracts (types, function signatures) the children share. Define",
  "  them with REAL signatures so each child can be built independently against the same seam.",
  "- Do not redeclare an interface that is already in scope. If a child implements an inherited",
  "  interface, list that existing id in the child's `produces`; if it only builds against it,",
  "  list that existing id in `consumes`.",
  "- Each child declares which interface ids it `consumes` (built by siblings/ancestors) and which",
  "  it `produces` (exposes for others). This is what lets the children run in parallel safely.",
  "- A child MUST NOT both consume and produce the same interface id. A seam connects distinct",
  "  tasks; use different revisioned ids if one task transforms an interface into a new contract.",
  "- `consumes`/`produces` are interface contracts, not execution dependencies. A child can build",
  "  against a shared interface without waiting for another child to finish.",
  "- Default `dependencies` to [] for siblings. D1 dependencies are ordering-only dispatch barriers:",
  "  they wait for the source task to settle but never materialize the source child's files in the",
  "  target worktree; every child still starts from the same immutable base commit.",
  "- If one step truly requires another step's concrete generated files, keep that concrete work in one child",
  "  (or redesign it around an explicit sharedInterface). A dependency cannot provide those files.",
  "- Do not create dependency chains just because UI consumes state/types, tests use production",
  "  code, or multiple leaves touch related concepts. Those are normal parallel leaves.",
  "- Add `parentValidationCommands` that verify the integrated children honour the seams",
  "  (typically the project's test command).",
  "- NO crees nodos cuyo \xFAnico prop\xF3sito sea correr tests/typecheck/build/lint o verificar",
  "  la integraci\xF3n. La verificaci\xF3n se expresa como `leafValidationCommands` en la hoja",
  "  que produce el c\xF3digo, o como `parentValidationCommands` en el composite.",
  "- Crear una hoja solo cuando produce o modifica c\xF3digo fuente/tests como entregable.",
  "",
  "## Lowering variance:",
  "Reason locally about THIS node only. Do not plan the whole tree \u2014 you will be asked about each",
  "child separately. Keep ids stable and descriptive.",
  "",
  "## Tree shape:",
  "The stop criterion is local atomicity, never a target depth or node count. A simple branch may",
  "be atomic immediately (depth 1) while a complex sibling keeps splitting several levels deeper.",
  "An asymmetric, irregular tree that mirrors real complexity is the correct outcome \u2014 do not try to",
  "balance branches or hit a uniform depth.",
  "",
  "The output is consumed by a strict JSON validator. Any deviation breaks planning.",
  "",
  "Output JSON schema (must match exactly):",
  "",
  "{{outputSchema}}"
].join("\n");

// src/llm/recursive/recursive-decomposer.ts
var DEFAULT_DEPTH_BUDGET = 5;
var DEFAULT_MAX_TOKENS = 4e3;
var DEFAULT_MAX_PARALLEL_STEPS = 3;
var DEFAULT_MAX_DURATION_MS2 = 30 * 60 * 1e3;
var DEFAULT_MAX_COST_USD2 = 1.5;
var DEFAULT_STEP_MAX_ATTEMPTS = 3;
var DEFAULT_STEP_RETRY_BASE_DELAY_MS = 250;
var DEFAULT_STEP_RETRY_MAX_DELAY_MS = 2e3;
var ROOT_ID = "root";
var RecursiveDecomposer = class {
  client;
  model;
  maxTokens;
  userPrompt;
  aggressivenessOverride;
  depthBudget;
  maxParallelSteps;
  maxChildrenPerNode;
  maxDecomposerCalls;
  workspaceHints;
  maxStepAttempts;
  stepRetryBaseDelayMs;
  stepRetryMaxDelayMs;
  allowNonRootFallback;
  onStepStarted;
  onStepCompleted;
  onStepStatus;
  promptTemplateVersion;
  constructor(options) {
    if (options.client === void 0 && (options.apiKey === void 0 || options.apiKey.length === 0)) {
      throw new DecomposerLlmError("RecursiveDecomposer requires an apiKey or an injected client", void 0, "request");
    }
    this.client = options.client ?? createAnthropicClient(options.apiKey);
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.userPrompt = options.userPrompt;
    if (options.aggressiveness !== void 0) {
      this.aggressivenessOverride = options.aggressiveness;
    }
    this.depthBudget = options.depthBudget ?? DEFAULT_DEPTH_BUDGET;
    this.maxParallelSteps = normalizeParallelism(options.maxParallelSteps);
    this.maxChildrenPerNode = normalizePositiveInteger(options.maxChildrenPerNode, 24);
    this.maxDecomposerCalls = normalizePositiveInteger(options.maxDecomposerCalls, 500);
    if (options.workspaceHints !== void 0) {
      this.workspaceHints = options.workspaceHints;
    }
    this.maxStepAttempts = normalizePositiveInteger(options.maxStepAttempts, DEFAULT_STEP_MAX_ATTEMPTS);
    this.stepRetryBaseDelayMs = normalizeNonNegativeInteger(
      options.stepRetryBaseDelayMs,
      DEFAULT_STEP_RETRY_BASE_DELAY_MS
    );
    this.stepRetryMaxDelayMs = normalizeNonNegativeInteger(
      options.stepRetryMaxDelayMs,
      DEFAULT_STEP_RETRY_MAX_DELAY_MS
    );
    this.allowNonRootFallback = options.allowNonRootFallback === true;
    if (options.onStepStarted !== void 0) {
      this.onStepStarted = options.onStepStarted;
    }
    if (options.onStepCompleted !== void 0) {
      this.onStepCompleted = options.onStepCompleted;
    }
    if (options.onStepStatus !== void 0) {
      this.onStepStatus = options.onStepStatus;
    }
    this.promptTemplateVersion = options.promptTemplateVersion ?? RECURSIVE_DECOMPOSER_PROMPT_VERSION;
  }
  async decompose(input, options = {}) {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const mode = parsedOptions.mode;
    const aggressiveness = this.aggressivenessOverride ?? modeToAggressiveness(mode);
    const generatedAt = parsedOptions.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
    const accum = {
      nodes: {},
      contracts: [],
      dependencies: [],
      feature,
      granularity: aggressivenessToGranularity(aggressiveness),
      callCount: 0,
      reservedNodeIds: /* @__PURE__ */ new Set([ROOT_ID]),
      questionAnswers: parsedOptions.questionAnswers,
      stepCache: parsedOptions.stepCache ? { ...parsedOptions.stepCache } : {}
    };
    await this.expand(
      {
        nodeId: ROOT_ID,
        parentId: null,
        title: feature.title,
        goal: feature.description,
        depth: 0,
        depthBudget: this.depthBudget,
        inheritedInterfaces: [],
        consumes: [],
        produces: [],
        isRoot: true
      },
      accum,
      aggressiveness
    );
    const graph = {
      id: `${feature.id}:${aggressiveness}:graph`,
      planId: `${feature.id}:${aggressiveness}:plan`,
      repo: parsedOptions.repo ?? feature.repositoryPath ?? "manyhands-workspace",
      baseBranch: parsedOptions.baseBranch,
      baseCommit: parsedOptions.baseCommit,
      featureRequest: feature.title,
      nodes: accum.nodes,
      dependencies: accum.dependencies,
      rootId: ROOT_ID,
      createdAt: generatedAt
    };
    const issues = validateTaskGraph(graph).map((issue) => `${issue.code}: ${issue.message}`);
    if (issues.length > 0) {
      const details = {
        kind: "graph_invalid",
        stage: "normalize",
        recoverable: false,
        message: `Recursive decomposition produced an invalid graph: ${issues.join("; ")}`
      };
      throw new DecomposerLlmError(
        details.message,
        void 0,
        "normalize",
        details
      );
    }
    const metadata = {
      mode,
      generatedAt,
      decomposer: `recursive:${this.model}:${aggressiveness}`,
      deterministic: false
    };
    return {
      feature,
      graph,
      contracts: accum.contracts,
      metadata,
      validation: { graphValid: true, contractValid: true, issues: [] }
    };
  }
  /**
   * Run a single step of the recursive decomposer for a specific node context.
   */
  async executeStep(ctx, aggressiveness, accum) {
    return this.callStep(ctx, aggressiveness, accum);
  }
  /**
   * Reconstructs the TaskGraph and AgentTaskContracts from a stepCache.
   */
  reconstructGraph(feature, stepCache, questionAnswers, repoSpec) {
    const aggressiveness = this.aggressivenessOverride ?? "medium";
    const accum = {
      nodes: {},
      contracts: [],
      dependencies: [],
      feature,
      granularity: aggressivenessToGranularity(aggressiveness),
      callCount: 0,
      reservedNodeIds: /* @__PURE__ */ new Set([ROOT_ID]),
      questionAnswers,
      stepCache
    };
    const traverse = (ctx) => {
      const step = stepCache[ctx.nodeId];
      if (!step) {
        this.materializeAtomic(ctx, accum, void 0);
        return;
      }
      if (step.decision === "question") {
        this.materializeAtomic(ctx, accum, void 0);
        return;
      }
      if (step.decision === "atomic") {
        this.materializeAtomic(ctx, accum, step);
        return;
      }
      const newInterfaces = step.sharedInterfaces.map(
        (iface) => toInterfaceContract(iface, ctx.nodeId)
      );
      const pool = [...ctx.inheritedInterfaces, ...newInterfaces];
      const childIds = step.children.map((child) => child.id);
      const selfNode = {
        id: ctx.nodeId,
        parentId: ctx.parentId,
        kind: ctx.isRoot ? "root" : "composite",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: ctx.depth,
        childrenIds: childIds,
        metadata: { authoredBy: "ai" }
      };
      accum.nodes[ctx.nodeId] = selfNode;
      for (const child of step.children) {
        traverse({
          nodeId: child.id,
          parentId: ctx.nodeId,
          title: child.title,
          goal: child.goal,
          depth: ctx.depth + 1,
          depthBudget: ctx.depthBudget - 1,
          inheritedInterfaces: pool,
          consumes: child.consumes || [],
          produces: child.produces || [],
          isRoot: false
        });
      }
      for (const dep of step.dependencies) {
        accum.dependencies.push({
          fromTaskId: dep.fromTaskId,
          toTaskId: dep.toTaskId,
          type: dep.type,
          inferred: false,
          ...dep.rationale !== void 0 ? { rationale: dep.rationale } : {}
        });
      }
      selfNode.contract = buildCompositeContract({
        taskId: ctx.nodeId,
        title: ctx.title,
        goal: ctx.goal,
        coveredPaths: ["src/**", "tests/**"],
        sharedInterfaces: newInterfaces,
        parentValidationCommands: step.parentValidationCommands.map(toExecutionValidationCommand)
      });
    };
    traverse({
      nodeId: ROOT_ID,
      parentId: null,
      title: feature.title,
      goal: feature.description,
      depth: 0,
      depthBudget: this.depthBudget,
      inheritedInterfaces: [],
      consumes: [],
      produces: [],
      isRoot: true
    });
    const graph = {
      id: `${feature.id}:${aggressiveness}:graph`,
      planId: `${feature.id}:${aggressiveness}:plan`,
      repo: repoSpec?.repo ?? feature.repositoryPath ?? "manyhands-workspace",
      baseBranch: repoSpec?.baseBranch ?? "main",
      baseCommit: repoSpec?.baseCommit ?? "base-commit-placeholder",
      featureRequest: feature.title,
      nodes: accum.nodes,
      dependencies: accum.dependencies,
      rootId: ROOT_ID,
      createdAt: repoSpec?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
    };
    return { graph, contracts: accum.contracts };
  }
  async expand(ctx, accum, aggressiveness) {
    if (accum.callCount >= this.maxDecomposerCalls) {
      throw new DecomposerLlmError(`Planning decomposer-call budget (${this.maxDecomposerCalls}) was exhausted.`, void 0, "request");
    }
    await this.emitStepStarted(ctx);
    await this.emitStepStatus(ctx, { state: "generating", maxAttempts: this.maxStepAttempts });
    let resolution;
    try {
      resolution = await this.callStep(ctx, aggressiveness, accum);
    } catch (error) {
      const failure = this.toStepError(error, ctx);
      await this.emitStepStatus(ctx, {
        state: "failed",
        error: failure.details,
        attempt: failure.details?.attempt,
        maxAttempts: failure.details?.maxAttempts,
        durationMs: failure.details?.durationMs
      });
      if (!ctx.isRoot && this.allowNonRootFallback) {
        const fallback = this.materializeFallbackAtomic(ctx, accum, failure.details);
        await this.emitStepStatus(ctx, { state: "fallback", error: failure.details });
        await this.emitStepCompleted(ctx, fallback.step, fallback);
        return fallback.coveredPaths;
      }
      if (accum.stepCache !== void 0) {
        failure.stepCache = accum.stepCache;
      }
      throw failure;
    }
    const step = resolution.step;
    accum.callCount += resolution.attemptCount;
    if (accum.stepCache !== void 0) {
      accum.stepCache[ctx.nodeId] = step;
    }
    if (step.decision === "question") {
      await this.emitStepStatus(ctx, {
        state: resolution.state,
        attempt: resolution.attemptCount,
        maxAttempts: this.maxStepAttempts,
        error: resolution.error
      });
      await this.emitStepCompleted(ctx, step, resolution);
      throw new DecomposerQuestionError(
        ctx.nodeId,
        step.question,
        step.options,
        accum.stepCache ?? {},
        step.reasoning
      );
    }
    const forcedAtomic = ctx.depthBudget <= 0;
    if (step.decision === "atomic" || forcedAtomic) {
      await this.emitStepStatus(ctx, {
        state: resolution.state,
        attempt: resolution.attemptCount,
        maxAttempts: this.maxStepAttempts,
        error: resolution.error
      });
      await this.emitStepCompleted(ctx, step, resolution);
      const atomic = step.decision === "atomic" ? step : void 0;
      return this.materializeAtomic(ctx, accum, atomic);
    }
    if (step.children.length > this.maxChildrenPerNode) {
      throw new DecomposerLlmError(`Planning child budget (${this.maxChildrenPerNode}) was exceeded for ${ctx.nodeId}.`, void 0, "normalize");
    }
    const newInterfaces = step.sharedInterfaces.map(
      (iface) => toInterfaceContract(iface, ctx.nodeId)
    );
    const pool = [...ctx.inheritedInterfaces, ...newInterfaces];
    const childIds = step.children.map((child) => child.id);
    try {
      reserveNodeIds(accum, childIds);
    } catch (error) {
      const failure = this.toStepError(error, ctx);
      await this.emitStepStatus(ctx, { state: "failed", error: failure.details });
      if (!ctx.isRoot && this.allowNonRootFallback) {
        const fallback = this.materializeFallbackAtomic(ctx, accum, failure.details);
        await this.emitStepStatus(ctx, { state: "fallback", error: failure.details });
        await this.emitStepCompleted(ctx, fallback.step, fallback);
        return fallback.coveredPaths;
      }
      if (accum.stepCache !== void 0) {
        failure.stepCache = accum.stepCache;
      }
      throw failure;
    }
    await this.emitStepStatus(ctx, {
      state: resolution.state,
      attempt: resolution.attemptCount,
      maxAttempts: this.maxStepAttempts,
      error: resolution.error
    });
    await this.emitStepCompleted(ctx, step, resolution);
    const coveredPaths = [];
    const selfNode = {
      id: ctx.nodeId,
      parentId: ctx.parentId,
      kind: ctx.isRoot ? "root" : "composite",
      title: ctx.title,
      goal: ctx.goal,
      status: "planned",
      granularity: accum.granularity,
      depth: ctx.depth,
      childrenIds: childIds,
      metadata: { authoredBy: "ai" }
    };
    accum.nodes[ctx.nodeId] = selfNode;
    const childResults = await mapWithConcurrency(
      step.children,
      this.maxParallelSteps,
      (child) => this.expand(
        {
          nodeId: child.id,
          parentId: ctx.nodeId,
          title: child.title,
          goal: child.goal,
          depth: ctx.depth + 1,
          depthBudget: ctx.depthBudget - 1,
          inheritedInterfaces: pool,
          consumes: child.consumes,
          produces: child.produces,
          isRoot: false
        },
        accum,
        aggressiveness
      )
    );
    for (const childCovered of childResults) {
      coveredPaths.push(...childCovered);
    }
    for (const dep of step.dependencies) {
      accum.dependencies.push({
        fromTaskId: dep.fromTaskId,
        toTaskId: dep.toTaskId,
        type: dep.type,
        inferred: false,
        ...dep.rationale !== void 0 ? { rationale: dep.rationale } : {}
      });
    }
    const compositeScope = uniqueStrings(coveredPaths.length > 0 ? coveredPaths : ["src/**", "tests/**"]);
    selfNode.contract = buildCompositeContract({
      taskId: ctx.nodeId,
      title: ctx.title,
      goal: ctx.goal,
      coveredPaths: compositeScope,
      sharedInterfaces: newInterfaces,
      parentValidationCommands: step.parentValidationCommands.map(toExecutionValidationCommand)
    });
    return compositeScope;
  }
  /** Creates a leaf for an atomic node. The root, if atomic, becomes a root with one leaf child. */
  materializeAtomic(ctx, accum, atomic) {
    const allowedPaths = resolveAllowedPaths(atomic?.allowedPaths ?? [], accum.feature);
    const acceptance = atomic?.acceptanceCriteria ?? [`Complete: ${ctx.title}`];
    const expectedFiles = atomic?.expectedFiles ?? [];
    const forbiddenPaths = atomic?.forbiddenPaths ?? [];
    const leafValidationCommands = (atomic?.leafValidationCommands ?? []).map(toExecutionValidationCommand);
    const consumed = ctx.inheritedInterfaces.filter((i) => ctx.consumes.includes(i.id));
    const produced = ctx.inheritedInterfaces.filter((i) => ctx.produces.includes(i.id));
    if (ctx.isRoot) {
      const leafId = `${ROOT_ID}-impl`;
      reserveNodeIds(accum, [leafId]);
      accum.nodes[ROOT_ID] = {
        id: ROOT_ID,
        parentId: null,
        kind: "root",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: 0,
        childrenIds: [leafId],
        metadata: { authoredBy: "ai" }
      };
      const contract2 = buildLeafContract({
        taskId: leafId,
        title: ctx.title,
        goal: ctx.goal,
        allowedPaths,
        forbiddenPaths,
        expectedFiles,
        acceptance,
        leafValidationCommands,
        consumed,
        produced,
        feature: accum.feature
      });
      accum.nodes[leafId] = {
        id: leafId,
        parentId: ROOT_ID,
        kind: "leaf",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: 1,
        childrenIds: [],
        contract: contract2,
        metadata: { authoredBy: "ai" }
      };
      accum.contracts.push(contract2);
      return allowedPaths;
    }
    const contract = buildLeafContract({
      taskId: ctx.nodeId,
      title: ctx.title,
      goal: ctx.goal,
      allowedPaths,
      forbiddenPaths,
      expectedFiles,
      acceptance,
      leafValidationCommands,
      consumed,
      produced,
      feature: accum.feature
    });
    accum.nodes[ctx.nodeId] = {
      id: ctx.nodeId,
      parentId: ctx.parentId,
      kind: "leaf",
      title: ctx.title,
      goal: ctx.goal,
      status: "planned",
      granularity: accum.granularity,
      depth: ctx.depth,
      childrenIds: [],
      contract,
      metadata: { authoredBy: "ai" }
    };
    accum.contracts.push(contract);
    return allowedPaths;
  }
  materializeFallbackAtomic(ctx, accum, error) {
    const coveredPaths = this.materializeAtomic(ctx, accum, void 0);
    const node = accum.nodes[ctx.isRoot ? ROOT_ID : ctx.nodeId];
    if (node !== void 0) {
      node.metadata = {
        ...node.metadata,
        authoredBy: "ai",
        planningState: "fallback",
        planningError: error
      };
      node.metrics = {
        ...node.metrics,
        retries: Math.max(0, (error?.attempt ?? this.maxStepAttempts) - 1)
      };
    }
    return {
      step: {
        decision: "atomic",
        reasoning: "Fallback atomic leaf after non-root planning failure.",
        allowedPaths: coveredPaths,
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: [`Complete: ${ctx.title}`],
        leafValidationCommands: []
      },
      attemptCount: error?.attempt ?? this.maxStepAttempts,
      state: "fallback",
      error,
      coveredPaths
    };
  }
  async callStep(ctx, aggressiveness, accum) {
    const cacheKey = ctx.nodeId;
    const cachedStep = accum.stepCache?.[cacheKey];
    const answer = accum.questionAnswers?.[cacheKey];
    if (cachedStep !== void 0 && cachedStep.decision !== "question") {
      return { step: cachedStep, attemptCount: 0, state: "generated" };
    }
    const hasUserAnswer = cachedStep !== void 0 && cachedStep.decision === "question" && answer !== void 0;
    const { system, user } = buildStepPrompt({
      title: ctx.title,
      goal: ctx.goal,
      aggressiveness,
      inheritedInterfaces: ctx.inheritedInterfaces.map(toStepInterface),
      atDepthLimit: ctx.depthBudget <= 0,
      ...this.workspaceHints !== void 0 ? { workspaceHints: this.workspaceHints } : {},
      ...hasUserAnswer ? {
        userQuestion: cachedStep.question,
        userAnswer: answer
      } : {}
    });
    const stepSystem = `${system}

## Overall feature goal (for context)
${this.userPrompt}`;
    let stepUser = user;
    for (let attempt = 1; attempt <= this.maxStepAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      let response;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: stepSystem,
          messages: [{ role: "user", content: stepUser }],
          nodeId: ctx.nodeId
        });
      } catch (error) {
        const failure = this.toAttemptError(error, ctx, attempt, Date.now() - attemptStartedAt, "request");
        if (await this.shouldRetry(ctx, failure, attempt, user)) {
          stepUser = appendStepRecoveryFeedback(user, failure.details);
          continue;
        }
        throw failure;
      }
      const text = extractText2(response.content);
      try {
        const parsed = parseStepOutputCandidates(ctx, accum, text);
        return { step: parsed, attemptCount: attempt, state: "generated" };
      } catch (error) {
        const failure = this.toAttemptError(error, ctx, attempt, Date.now() - attemptStartedAt);
        if (await this.shouldRetry(ctx, failure, attempt, user)) {
          stepUser = appendStepRecoveryFeedback(user, failure.details);
          continue;
        }
        throw failure;
      }
    }
    const details = {
      kind: "unknown",
      stage: "request",
      recoverable: false,
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      maxAttempts: this.maxStepAttempts,
      message: `Step generation failed for "${ctx.nodeId}" after ${this.maxStepAttempts} attempt(s)`
    };
    throw new DecomposerLlmError(details.message, void 0, details.stage, details);
  }
  emitStepStarted(ctx) {
    return emitBestEffort(this.onStepStarted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget
    });
  }
  emitStepCompleted(ctx, step, resolution) {
    return emitBestEffort(this.onStepCompleted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget,
      decision: step.decision,
      childIds: step.decision === "decompose" ? step.children.map((child) => child.id) : [],
      attemptCount: resolution.attemptCount,
      state: resolution.state,
      ...resolution.error !== void 0 ? { error: resolution.error } : {},
      children: step.decision === "decompose" ? step.children.map((child) => ({
        nodeId: child.id,
        parentId: ctx.nodeId,
        title: child.title,
        goal: child.goal,
        depth: ctx.depth + 1,
        depthBudget: Math.max(0, ctx.depthBudget - 1)
      })) : []
    });
  }
  emitStepStatus(ctx, event) {
    return emitBestEffort(this.onStepStatus, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget,
      ...event
    });
  }
  async shouldRetry(ctx, error, attempt, _originalUserPrompt) {
    const details = error.details;
    if (details === void 0 || !details.recoverable || attempt >= this.maxStepAttempts) {
      return false;
    }
    console.warn(
      `[RecursiveDecomposer] Step "${ctx.nodeId}" attempt ${attempt}/${this.maxStepAttempts} failed (${details.kind}): ${details.message}. Retrying with stricter JSON instructions.` + (details.responseExcerpt !== void 0 ? ` Raw response: ${details.responseExcerpt}` : "")
    );
    await this.emitStepStatus(ctx, {
      state: "retrying",
      attempt,
      maxAttempts: this.maxStepAttempts,
      durationMs: details.durationMs,
      error: details
    });
    const delayMs = retryDelayMs(attempt, this.stepRetryBaseDelayMs, this.stepRetryMaxDelayMs);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    return true;
  }
  toAttemptError(error, ctx, attempt, durationMs, stage) {
    const details = classifyGraphGenerationError(error, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      attempt,
      maxAttempts: this.maxStepAttempts,
      durationMs,
      ...stage !== void 0 ? { stage } : {}
    });
    const message = `Graph generation failed for node "${ctx.nodeId}" (attempt ${attempt}/${this.maxStepAttempts}, ${details.kind}): ${details.message}`;
    return new DecomposerLlmError(message, error, details.stage, { ...details, message });
  }
  toStepError(error, ctx) {
    if (error instanceof DecomposerLlmError && error.details !== void 0) {
      return error;
    }
    const details = classifyGraphGenerationError(error, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      maxAttempts: this.maxStepAttempts
    });
    const message = `Graph generation failed for node "${ctx.nodeId}" (${details.kind}): ${details.message}`;
    return new DecomposerLlmError(message, error, details.stage, { ...details, message });
  }
};
function normalizeParallelism(value) {
  if (value === void 0 || !Number.isFinite(value)) {
    return DEFAULT_MAX_PARALLEL_STEPS;
  }
  return Math.max(1, Math.floor(value));
}
function normalizePositiveInteger(value, fallback) {
  if (value === void 0 || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}
function normalizeNonNegativeInteger(value, fallback) {
  if (value === void 0 || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}
var RESPONSE_EXCERPT_MAX_CHARS = 400;
function responseExcerptOf(text) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > RESPONSE_EXCERPT_MAX_CHARS ? `${collapsed.slice(0, RESPONSE_EXCERPT_MAX_CHARS)}\u2026` : collapsed;
}
function retryDelayMs(attempt, baseDelayMs, maxDelayMs) {
  if (baseDelayMs <= 0 || maxDelayMs <= 0) {
    return 0;
  }
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseStepOutputCandidates(ctx, accum, text) {
  const parsed = parseJsonObjectCandidates(text);
  if (!parsed.ok) {
    throw new DecomposerLlmError(
      `${parsed.message} for step "${ctx.nodeId}"`,
      void 0,
      "parse",
      {
        kind: parsed.kind,
        stage: "parse",
        recoverable: true,
        nodeId: ctx.nodeId,
        parentId: ctx.parentId,
        message: `${parsed.message} for step "${ctx.nodeId}"`,
        responseExcerpt: responseExcerptOf(text)
      }
    );
  }
  let firstFailure;
  for (const candidate of prioritizeStepCandidates(parsed.candidates)) {
    const result = DecomposeStepOutputSchema.safeParse(candidate.value);
    if (!result.success) {
      firstFailure ??= stepSchemaFailure(ctx, candidate, result.error);
      continue;
    }
    const semanticIssues = validateStepSemantics(ctx, accum, result.data);
    if (semanticIssues.length > 0) {
      firstFailure ??= stepSemanticFailure(ctx, semanticIssues);
      continue;
    }
    return result.data;
  }
  throw firstFailure ?? new DecomposerLlmError(
    `No parsed JSON candidate matched the step schema for "${ctx.nodeId}"`,
    void 0,
    "validate",
    {
      kind: "schema_invalid",
      stage: "validate",
      recoverable: true,
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      message: `No parsed JSON candidate matched the step schema for "${ctx.nodeId}"`
    }
  );
}
function prioritizeStepCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const scoreDelta = stepCandidateScore(right.value) - stepCandidateScore(left.value);
    return scoreDelta !== 0 ? scoreDelta : left.index - right.index;
  });
}
function stepCandidateScore(value) {
  if (!isRecord(value)) return 0;
  return typeof value.decision === "string" ? 2 : 1;
}
function stepSchemaFailure(ctx, candidate, error) {
  const detail = describeStepSchemaFailure(ctx.nodeId, candidate.value, error);
  return new DecomposerLlmError(detail, error, "validate", {
    kind: "schema_invalid",
    stage: "validate",
    recoverable: true,
    nodeId: ctx.nodeId,
    parentId: ctx.parentId,
    message: detail
  });
}
function stepSemanticFailure(ctx, issues) {
  const detail = `Step semantic validation failed for "${ctx.nodeId}": ${issues.join("; ")}`;
  return new DecomposerLlmError(detail, void 0, "validate", {
    kind: classifyStepSemanticIssues(issues),
    stage: "validate",
    recoverable: true,
    nodeId: ctx.nodeId,
    parentId: ctx.parentId,
    message: detail
  });
}
function validateStepSemantics(ctx, accum, step) {
  if (step.decision !== "decompose") {
    return [];
  }
  const issues = [];
  const childIds = /* @__PURE__ */ new Set();
  for (const child of step.children) {
    if (childIds.has(child.id)) {
      issues.push(`duplicate child id "${child.id}"`);
    }
    if (accum.reservedNodeIds.has(child.id) || accum.nodes[child.id] !== void 0) {
      issues.push(`duplicate node id "${child.id}" already exists in the recursive graph`);
    }
    childIds.add(child.id);
  }
  const interfaceIds = new Set(ctx.inheritedInterfaces.map((iface) => iface.id));
  for (const iface of step.sharedInterfaces) {
    if (interfaceIds.has(iface.id)) {
      issues.push(`duplicate interface id "${iface.id}" already exists in scope`);
    }
    interfaceIds.add(iface.id);
  }
  for (const child of step.children) {
    for (const ifaceId of [...child.consumes, ...child.produces]) {
      if (!interfaceIds.has(ifaceId)) {
        issues.push(`child "${child.id}" references unknown interface "${ifaceId}"`);
      }
    }
  }
  const producersByInterface = /* @__PURE__ */ new Map();
  for (const child of step.children) {
    for (const ifaceId of child.produces) {
      producersByInterface.set(ifaceId, [...producersByInterface.get(ifaceId) ?? [], child.id]);
    }
  }
  for (const [ifaceId, producerIds] of producersByInterface) {
    if (producerIds.length > 1) {
      issues.push(
        `interface "${ifaceId}" is produced by multiple children: ${producerIds.join(", ")}; assign each shared interface to exactly one producer child`
      );
    }
  }
  const producedHere = new Set(producersByInterface.keys());
  for (const iface of step.sharedInterfaces) {
    if (!producedHere.has(iface.id)) {
      issues.push(
        `interface "${iface.id}" is defined at this step but no child produces it; assign it to the "produces" of the child that builds it`
      );
    }
  }
  for (const obligation of ctx.produces) {
    if (!producedHere.has(obligation)) {
      issues.push(
        `this node must produce interface "${obligation}" (assigned by its parent) but no child produces it; assign it to the "produces" of the child that builds it`
      );
    }
  }
  for (const dependency2 of step.dependencies) {
    if (!childIds.has(dependency2.fromTaskId)) {
      issues.push(`dependency references unknown fromTaskId "${dependency2.fromTaskId}"`);
    }
    if (!childIds.has(dependency2.toTaskId)) {
      issues.push(`dependency references unknown toTaskId "${dependency2.toTaskId}"`);
    }
    if (dependency2.fromTaskId === dependency2.toTaskId) {
      issues.push(`dependency self-loop on "${dependency2.fromTaskId}"`);
    }
  }
  const cycle = findDependencyCycle(Array.from(childIds), step.dependencies);
  if (cycle.length > 0) {
    issues.push(`dependency cycle detected: ${cycle.join(" -> ")}`);
  }
  return issues;
}
function classifyStepSemanticIssues(issues) {
  const text = issues.join("; ").toLowerCase();
  if (text.includes("duplicate child id") || text.includes("duplicate node id")) return "duplicate_node_id";
  if (text.includes("unknown") || text.includes("self-loop")) return "dangling_dependency";
  if (text.includes("cycle")) return "cycle_detected";
  return "graph_invalid";
}
function findDependencyCycle(nodeIds, dependencies) {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const dependency2 of dependencies) {
    if (adjacency.has(dependency2.fromTaskId) && adjacency.has(dependency2.toTaskId)) {
      adjacency.get(dependency2.fromTaskId)?.push(dependency2.toTaskId);
    }
  }
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const stack = [];
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(Math.max(start, 0)), nodeId];
    }
    if (visited.has(nodeId)) {
      return [];
    }
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      const cycle = visit(nextId);
      if (cycle.length > 0) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return [];
  };
  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle.length > 0) {
      return cycle;
    }
  }
  return [];
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function reserveNodeIds(accum, nodeIds) {
  for (const nodeId of nodeIds) {
    if (accum.reservedNodeIds.has(nodeId) || accum.nodes[nodeId] !== void 0) {
      throw new DecomposerLlmError(
        `Duplicate node id "${nodeId}" produced during recursive decomposition`,
        void 0,
        "normalize"
      );
    }
  }
  for (const nodeId of nodeIds) {
    accum.reservedNodeIds.add(nodeId);
  }
}
function mapWithConcurrency(items, limit, mapper) {
  if (items.length === 0) {
    return Promise.resolve([]);
  }
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    let active = 0;
    let completed = 0;
    let failed = false;
    let firstError;
    const launch = () => {
      if (failed && active === 0) {
        reject(firstError);
        return;
      }
      if (completed === items.length) {
        resolve(results);
        return;
      }
      while (!failed && active < limit && nextIndex < items.length) {
        const index = nextIndex;
        const item = items[index];
        nextIndex += 1;
        active += 1;
        void mapper(item, index).then((result) => {
          results[index] = result;
        }).catch((error) => {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }).finally(() => {
          active -= 1;
          completed += 1;
          launch();
        });
      }
    };
    launch();
  });
}
function describeStepSchemaFailure(nodeId, parsed, error) {
  const first = error.issues[0];
  const path2 = first?.path.join(".") ?? "?";
  const message = first?.message ?? "unknown";
  const received = first !== void 0 ? formatRejectedValue(valueAtPath(parsed, first.path)) : void 0;
  const suffix = received !== void 0 ? ` (received ${received})` : "";
  return `Step schema validation failed for "${nodeId}": ${path2} - ${message}${suffix}`;
}
function appendStepRecoveryFeedback(userPrompt, detail) {
  return [
    userPrompt,
    "",
    "## Previous attempt was rejected",
    "",
    `- kind: ${detail.kind}`,
    `- stage: ${detail.stage}`,
    `- detail: ${detail.message}`,
    "",
    "Return a corrected JSON object for the same node.",
    "Return exactly one complete JSON object. Do not include prose, markdown, code fences, or logs.",
    "If a prior attempt timed out, make the JSON concise while preserving the required fields.",
    "Preserve the same decomposition unless a field must change to satisfy validation.",
    "For child ids, use lowercase kebab-case matching `^[a-z][a-z0-9_-]*$`.",
    "Dependencies must reference only child ids declared in this same JSON object and must not form cycles."
  ].join("\n");
}
function valueAtPath(value, path2) {
  let current = value;
  for (const segment of path2) {
    if (current === null || typeof current !== "object") {
      return void 0;
    }
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return void 0;
      }
      current = current[segment];
    } else {
      current = current[segment];
    }
  }
  return current;
}
function formatRejectedValue(value) {
  if (value === void 0) {
    return void 0;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function modeToAggressiveness(mode) {
  if (mode === "coarse") return "low";
  if (mode === "fine") return "high";
  if (mode === "auto") return "auto";
  return "medium";
}
function aggressivenessToGranularity(aggressiveness) {
  if (aggressiveness === "low") return "coarse";
  if (aggressiveness === "high") return "fine";
  return "medium";
}
function toInterfaceContract(iface, definedAtNodeId) {
  return {
    id: iface.id,
    kind: iface.kind,
    signature: iface.signature,
    description: iface.description,
    definedAtNodeId
  };
}
function toStepInterface(iface) {
  return { id: iface.id, kind: iface.kind, signature: iface.signature, description: iface.description };
}
function toExecutionValidationCommand(input) {
  return { command: input.command, args: input.args, timeoutMs: 6e4, cwd: "worktree" };
}
function resolveAllowedPaths(allowedPaths, feature) {
  return allowedPaths.length > 0 ? allowedPaths : [feature.repositoryPath ?? "src/**"];
}
function uniqueStrings(values) {
  return Array.from(new Set(values));
}
function buildLeafContract(input) {
  return {
    taskId: input.taskId,
    objective: input.goal,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: input.feature.constraints,
      upstreamArtifacts: []
    },
    allowed: { paths: input.allowedPaths },
    forbidden: { paths: input.forbiddenPaths },
    executionScope: executionScopeFromAllowed(input.allowedPaths),
    forbiddenPaths: input.forbiddenPaths,
    relevantSymbols: [],
    dependencies: [],
    acceptance: input.acceptance.map((description) => ({ kind: "custom", description })),
    validationCommands: [],
    leafValidationCommands: input.leafValidationCommands,
    expectedOutput: {
      changedFiles: input.expectedFiles,
      // Interface ids are compatibility seams, not concrete symbols produced
      // by another isolated worktree. Keep them solely in the explicit
      // consumed/produced interface fields so risk-aware scheduling can use
      // the seam as positive parallelism evidence.
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: { maxDurationMs: DEFAULT_MAX_DURATION_MS2, maxCostUsd: DEFAULT_MAX_COST_USD2 },
    knownRisks: [],
    definitionOfDone: input.acceptance[0] ?? `Complete: ${input.title}`,
    ...input.consumed.length > 0 ? { consumedInterfaces: input.consumed } : {},
    ...input.produced.length > 0 ? { producedInterfaces: input.produced } : {}
  };
}
function buildCompositeContract(input) {
  return {
    taskId: input.taskId,
    objective: input.goal,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: input.coveredPaths },
    forbidden: { paths: [] },
    executionScope: executionScopeFromAllowed(input.coveredPaths),
    forbiddenPaths: [],
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: `Integrate the children of: ${input.title}` }],
    validationCommands: [],
    expectedOutput: { changedFiles: [], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: DEFAULT_MAX_DURATION_MS2, maxCostUsd: DEFAULT_MAX_COST_USD2 },
    knownRisks: [],
    definitionOfDone: `The children of "${input.title}" integrate and honour their shared interfaces.`,
    ...input.parentValidationCommands.length > 0 ? { parentValidationCommands: input.parentValidationCommands } : {},
    ...input.sharedInterfaces.length > 0 ? { producedInterfaces: input.sharedInterfaces } : {}
  };
}
function createAnthropicClient(apiKey) {
  return new Anthropic2({ apiKey, timeout: 6e4 });
}
function extractText2(blocks) {
  return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
}
async function emitBestEffort(listener, event) {
  if (listener === void 0) return;
  try {
    await listener(event);
  } catch {
  }
}

// src/llm/recursive/claude-code-recursive-decomposer.ts
import { spawn } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  killCliProcessTree,
  resolveCliBinaryPath,
  resolveCliProcessInvocation
} from "@manyhands/shared/node-cli-process";
var DEFAULT_TIMEOUT_MS = 12e4;
var SPAWN_FAILURE_EXIT_CODE = 127;
var TIMEOUT_EXIT_CODE = 124;
var STDIN_DIRECTIVE = "Follow the planning instructions provided on stdin.";
var ClaudeCodeRecursiveDecomposer = class {
  inner;
  model;
  promptTemplateVersion;
  agentEnv;
  constructor(options) {
    this.model = options.model;
    this.agentEnv = options.agentEnv ?? process.env;
    this.promptTemplateVersion = options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.claude-code`;
    const clientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.binaryPath !== void 0) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== void 0) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== void 0) clientOptions.spawn = options.spawn;
    if (options.platform !== void 0) clientOptions.platform = options.platform;
    if (options.hostEnv !== void 0) clientOptions.hostEnv = options.hostEnv;
    if (options.agentEnv !== void 0) clientOptions.agentEnv = options.agentEnv;
    if (options.onCliOutput !== void 0) clientOptions.onCliOutput = options.onCliOutput;
    const client = new ClaudeCodeStepClient(clientOptions);
    const recursiveOptions = {
      client,
      model: options.model,
      userPrompt: options.userPrompt,
      promptTemplateVersion: this.promptTemplateVersion
    };
    if (options.workspaceHints !== void 0) recursiveOptions.workspaceHints = options.workspaceHints;
    if (options.aggressiveness !== void 0) recursiveOptions.aggressiveness = options.aggressiveness;
    if (options.depthBudget !== void 0) recursiveOptions.depthBudget = options.depthBudget;
    if (options.maxParallelSteps !== void 0) recursiveOptions.maxParallelSteps = options.maxParallelSteps;
    if (options.maxChildrenPerNode !== void 0) recursiveOptions.maxChildrenPerNode = options.maxChildrenPerNode;
    if (options.maxDecomposerCalls !== void 0) recursiveOptions.maxDecomposerCalls = options.maxDecomposerCalls;
    if (options.maxStepAttempts !== void 0) recursiveOptions.maxStepAttempts = options.maxStepAttempts;
    if (options.stepRetryBaseDelayMs !== void 0) recursiveOptions.stepRetryBaseDelayMs = options.stepRetryBaseDelayMs;
    if (options.stepRetryMaxDelayMs !== void 0) recursiveOptions.stepRetryMaxDelayMs = options.stepRetryMaxDelayMs;
    if (options.allowNonRootFallback !== void 0) recursiveOptions.allowNonRootFallback = options.allowNonRootFallback;
    if (options.onStepStarted !== void 0) recursiveOptions.onStepStarted = options.onStepStarted;
    if (options.onStepCompleted !== void 0) recursiveOptions.onStepCompleted = options.onStepCompleted;
    if (options.onStepStatus !== void 0) recursiveOptions.onStepStatus = options.onStepStatus;
    this.inner = new RecursiveDecomposer(recursiveOptions);
  }
  decompose(input, options) {
    return this.inner.decompose(input, options);
  }
  executeStep(...args) {
    return this.inner.executeStep(...args);
  }
  reconstructGraph(...args) {
    return this.inner.reconstructGraph(...args);
  }
};
var ClaudeCodeStepClient = class {
  messages;
  model;
  cwd;
  binaryPath;
  timeoutMs;
  spawnFn;
  platform;
  hostEnv;
  agentEnv;
  onCliOutput;
  constructor(options) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.platform = options.platform ?? process.platform;
    this.hostEnv = options.hostEnv ?? process.env;
    this.agentEnv = options.agentEnv ?? process.env;
    this.binaryPath = resolveCliBinaryPath(
      options.binaryPath ?? this.hostEnv.MANYHANDS_CLAUDE_BIN ?? "claude",
      { platform: this.platform, env: this.hostEnv }
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? spawn;
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args) => {
        const systemPrompt = [
          "CRITICAL: Do NOT call any tools. Do not search for files, do not read files, do not run grep, and do not execute any commands. All required context is fully provided in the prompt text.",
          "Analyze the input text locally and respond with strictly the JSON matching the schema \u2014 no prose, no plan file, no agents.",
          args.system
        ].join("\n\n");
        const prompt = args.messages.map((message) => message.content).join("\n\n");
        const text = await this.runClaude(prompt, systemPrompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }
  async runClaude(prompt, systemPrompt, nodeId) {
    const systemPromptDir = await mkdtemp(path.join(os.tmpdir(), "mh-plan-system-"));
    const systemPromptPath = path.join(systemPromptDir, "system-prompt.md");
    await writeFile(systemPromptPath, systemPrompt, "utf8");
    const args = [
      "-p",
      STDIN_DIRECTIVE,
      "--model",
      this.model,
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      "--append-system-prompt-file",
      systemPromptPath
    ];
    let outcome;
    try {
      const invocation = resolveCliProcessInvocation(this.binaryPath, args, {
        platform: this.platform,
        env: this.hostEnv
      });
      outcome = await spawnClaude({
        binaryPath: invocation.command,
        args: invocation.args,
        cwd: this.cwd,
        prompt,
        timeoutMs: this.timeoutMs,
        spawnFn: this.spawnFn,
        platform: this.platform,
        env: this.agentEnv,
        ...invocation.windowsVerbatimArguments !== void 0 ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {},
        onChunk: (chunk, stream) => {
          if (this.onCliOutput !== void 0 && nodeId !== void 0) {
            this.onCliOutput({ nodeId, chunk, stream });
          }
        }
      });
    } finally {
      await rm(systemPromptDir, { recursive: true, force: true }).catch(() => void 0);
    }
    if (outcome.timedOut) {
      const message2 = `Claude Code recursive planning timed out after ${this.timeoutMs}ms`;
      throw new DecomposerLlmError(message2, void 0, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...nodeId !== void 0 ? { nodeId } : {},
        message: message2
      });
    }
    if (outcome.exitCode !== 0) {
      const message2 = `Claude Code recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      throw new DecomposerLlmError(message2, void 0, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...nodeId !== void 0 ? { nodeId } : {},
        message: message2
      });
    }
    const cliJson = parseJsonObject(outcome.stdout, { prefer: isClaudeResultEnvelope });
    if ("ok" in cliJson) {
      const message2 = `${cliJson.message} in Claude Code stdout for node "${nodeId ?? "?"}"`;
      throw new DecomposerLlmError(`${message2}. Raw output was:
${outcome.stdout}`, void 0, "parse", {
        kind: cliJson.kind,
        stage: "parse",
        recoverable: true,
        ...nodeId !== void 0 ? { nodeId } : {},
        message: message2
      });
    }
    const parsedCli = cliJson.value;
    if (isRecord2(parsedCli) && parsedCli.type === "result" && typeof parsedCli.result === "string") {
      if (parsedCli.is_error === true) {
        const message2 = `Claude Code reported an error result for node "${nodeId ?? "?"}": ${parsedCli.result}`;
        throw new DecomposerLlmError(message2, void 0, "request", {
          kind: "provider_request",
          stage: "request",
          recoverable: true,
          ...nodeId !== void 0 ? { nodeId } : {},
          message: message2
        });
      }
      return parsedCli.result;
    }
    const message = `Claude Code JSON output for node "${nodeId ?? "?"}" did not contain a result field`;
    throw new DecomposerLlmError(`${message}. Raw output was:
${outcome.stdout}`, void 0, "parse", {
      kind: "schema_invalid",
      stage: "parse",
      recoverable: true,
      ...nodeId !== void 0 ? { nodeId } : {},
      message
    });
  }
};
function isClaudeResultEnvelope(value) {
  return isRecord2(value) && value.type === "result" && typeof value.result === "string";
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function spawnClaude(input) {
  return new Promise((resolve) => {
    const child = input.spawnFn(input.binaryPath, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: input.platform !== "win32",
      ...input.windowsVerbatimArguments !== void 0 ? { windowsVerbatimArguments: input.windowsVerbatimArguments } : {}
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminating = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminating = true;
      void killCliProcessTree(child, input.spawnFn, input.platform).then((terminationVerified) => {
        finish({
          exitCode: TIMEOUT_EXIT_CODE,
          stdout,
          stderr: stderr + (terminationVerified ? "" : `${stderr ? "\n" : ""}process-tree termination could not be verified`),
          timedOut: true
        });
      });
    }, input.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      input.onChunk?.(text, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      input.onChunk?.(text, "stderr");
    });
    child.on("error", (error) => {
      if (terminating) return;
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false
      });
    });
    child.on("close", (code) => {
      if (terminating) return;
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });
    child.stdin?.on("error", () => void 0);
    child.stdin?.end(input.prompt);
  });
}

// src/llm/recursive/codex-recursive-decomposer.ts
import { spawn as spawn2 } from "child_process";
import {
  killCliProcessTree as killCliProcessTree2,
  resolveCliBinaryPath as resolveCliBinaryPath2,
  resolveCliProcessInvocation as resolveCliProcessInvocation2
} from "@manyhands/shared/node-cli-process";
var DEFAULT_TIMEOUT_MS2 = 12e4;
var SPAWN_FAILURE_EXIT_CODE2 = 127;
var TIMEOUT_EXIT_CODE2 = 124;
var CodexRecursiveDecomposer = class {
  inner;
  model;
  promptTemplateVersion;
  agentEnv;
  constructor(options) {
    this.model = options.model;
    this.agentEnv = options.agentEnv ?? process.env;
    this.promptTemplateVersion = options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.codex`;
    const clientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.reasoningEffort !== void 0) clientOptions.reasoningEffort = options.reasoningEffort;
    if (options.binaryPath !== void 0) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== void 0) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== void 0) clientOptions.spawn = options.spawn;
    if (options.platform !== void 0) clientOptions.platform = options.platform;
    if (options.hostEnv !== void 0) clientOptions.hostEnv = options.hostEnv;
    if (options.agentEnv !== void 0) clientOptions.agentEnv = options.agentEnv;
    if (options.onCliOutput !== void 0) clientOptions.onCliOutput = options.onCliOutput;
    const client = new CodexStepClient(clientOptions);
    const recursiveOptions = {
      client,
      model: options.model,
      userPrompt: options.userPrompt,
      promptTemplateVersion: this.promptTemplateVersion
    };
    if (options.workspaceHints !== void 0) recursiveOptions.workspaceHints = options.workspaceHints;
    if (options.aggressiveness !== void 0) recursiveOptions.aggressiveness = options.aggressiveness;
    if (options.depthBudget !== void 0) recursiveOptions.depthBudget = options.depthBudget;
    if (options.maxParallelSteps !== void 0) recursiveOptions.maxParallelSteps = options.maxParallelSteps;
    if (options.maxChildrenPerNode !== void 0) recursiveOptions.maxChildrenPerNode = options.maxChildrenPerNode;
    if (options.maxDecomposerCalls !== void 0) recursiveOptions.maxDecomposerCalls = options.maxDecomposerCalls;
    if (options.maxStepAttempts !== void 0) recursiveOptions.maxStepAttempts = options.maxStepAttempts;
    if (options.stepRetryBaseDelayMs !== void 0) recursiveOptions.stepRetryBaseDelayMs = options.stepRetryBaseDelayMs;
    if (options.stepRetryMaxDelayMs !== void 0) recursiveOptions.stepRetryMaxDelayMs = options.stepRetryMaxDelayMs;
    if (options.allowNonRootFallback !== void 0) recursiveOptions.allowNonRootFallback = options.allowNonRootFallback;
    if (options.onStepStarted !== void 0) recursiveOptions.onStepStarted = options.onStepStarted;
    if (options.onStepCompleted !== void 0) recursiveOptions.onStepCompleted = options.onStepCompleted;
    if (options.onStepStatus !== void 0) recursiveOptions.onStepStatus = options.onStepStatus;
    this.inner = new RecursiveDecomposer(recursiveOptions);
  }
  decompose(input, options) {
    return this.inner.decompose(input, options);
  }
  executeStep(...args) {
    return this.inner.executeStep(...args);
  }
  reconstructGraph(...args) {
    return this.inner.reconstructGraph(...args);
  }
};
var CodexStepClient = class {
  messages;
  model;
  cwd;
  reasoningEffort;
  binaryPath;
  timeoutMs;
  spawnFn;
  platform;
  hostEnv;
  agentEnv;
  onCliOutput;
  constructor(options) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.reasoningEffort = options.reasoningEffort;
    this.platform = options.platform ?? process.platform;
    this.hostEnv = options.hostEnv ?? process.env;
    this.agentEnv = options.agentEnv ?? process.env;
    this.binaryPath = resolveCliBinaryPath2(
      options.binaryPath ?? this.hostEnv.MANYHANDS_CODEX_BIN ?? "codex",
      { platform: this.platform, env: this.hostEnv }
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS2;
    this.spawnFn = options.spawn ?? spawn2;
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args) => {
        const systemPrompt = [
          "CRITICAL: Do NOT call any tools. Do not search for files, do not read files, do not run grep, and do not execute any commands. All required context is fully provided in the prompt text.",
          "Analyze the input text locally and return strictly the JSON matching the schema.",
          args.system
        ].join("\n\n");
        const prompt = [
          "## System",
          systemPrompt,
          "",
          "## User",
          args.messages.map((message) => message.content).join("\n\n")
        ].join("\n");
        const text = await this.runCodex(prompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }
  async runCodex(prompt, nodeId) {
    const args = [
      "exec",
      "--model",
      this.model,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      ...this.reasoningEffort !== void 0 ? ["-c", `model_reasoning_effort="${this.reasoningEffort}"`] : [],
      "-"
    ];
    const invocation = resolveCliProcessInvocation2(this.binaryPath, args, {
      platform: this.platform,
      env: this.hostEnv
    });
    const outcome = await spawnCodex({
      binaryPath: invocation.command,
      args: invocation.args,
      cwd: this.cwd,
      prompt,
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      platform: this.platform,
      env: this.agentEnv,
      ...invocation.windowsVerbatimArguments !== void 0 ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {},
      onChunk: (chunk, stream) => {
        if (this.onCliOutput !== void 0 && nodeId !== void 0) {
          this.onCliOutput({ nodeId, chunk, stream });
        }
      }
    });
    if (outcome.timedOut) {
      const message = `Codex recursive planning timed out after ${this.timeoutMs}ms`;
      throw new DecomposerLlmError(message, void 0, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...nodeId !== void 0 ? { nodeId } : {},
        message
      });
    }
    if (outcome.exitCode !== 0) {
      const message = `Codex recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      throw new DecomposerLlmError(message, void 0, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...nodeId !== void 0 ? { nodeId } : {},
        message
      });
    }
    return outcome.stdout;
  }
};
function spawnCodex(input) {
  return new Promise((resolve) => {
    const child = input.spawnFn(input.binaryPath, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: input.platform !== "win32",
      ...input.windowsVerbatimArguments !== void 0 ? { windowsVerbatimArguments: input.windowsVerbatimArguments } : {}
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminating = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminating = true;
      void killCliProcessTree2(child, input.spawnFn, input.platform).then((terminationVerified) => {
        finish({
          exitCode: TIMEOUT_EXIT_CODE2,
          stdout,
          stderr: stderr + (terminationVerified ? "" : `${stderr ? "\n" : ""}process-tree termination could not be verified`),
          timedOut: true
        });
      });
    }, input.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      input.onChunk?.(text, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      input.onChunk?.(text, "stderr");
    });
    child.on("error", (error) => {
      if (terminating) return;
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE2,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false
      });
    });
    child.on("close", (code) => {
      if (terminating) return;
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE2, stdout, stderr, timedOut: false });
    });
    child.stdin?.on("error", () => void 0);
    child.stdin?.end(input.prompt);
  });
}

// src/index.ts
var FeatureRequestSchema = z5.object({
  id: EntityIdSchema2,
  title: NonEmptyStringSchema3,
  description: NonEmptyStringSchema3,
  repositoryPath: NonEmptyStringSchema3.optional(),
  targetStack: z5.array(NonEmptyStringSchema3).default([]),
  constraints: z5.array(NonEmptyStringSchema3).default([]),
  acceptanceCriteria: z5.array(NonEmptyStringSchema3).min(1)
});
var DecompositionModeSchema = z5.union([
  z5.literal("coarse"),
  z5.literal("balanced"),
  z5.literal("fine"),
  // "auto" is adaptive: the recursive decomposer lets each node pick its own
  // split pressure from its assessed complexity. Non-recursive consumers
  // (deterministic templates, single-pass prompt) treat it as "balanced".
  z5.literal("auto")
]);
var DecompositionOptionsSchema = z5.object({
  mode: DecompositionModeSchema.default("balanced"),
  generatedAt: IsoTimestampSchema.optional(),
  baseBranch: NonEmptyStringSchema3.default("main"),
  baseCommit: NonEmptyStringSchema3.default("mock-base-commit"),
  repo: NonEmptyStringSchema3.optional(),
  questionAnswers: z5.record(z5.string()).optional(),
  stepCache: z5.record(DecomposeStepOutputSchema).optional()
});
var DecompositionMetadataSchema = z5.object({
  mode: DecompositionModeSchema,
  generatedAt: IsoTimestampSchema,
  decomposer: NonEmptyStringSchema3,
  deterministic: z5.boolean()
});
var DecompositionValidationSchema = z5.object({
  graphValid: z5.boolean(),
  contractValid: z5.boolean(),
  issues: z5.array(z5.string())
});
var DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";
var MOCK_DECOMPOSER_NAME = "mock-decomposer/passwordless-login@0.1.0";
var SINGLE_TASK_DECOMPOSER_NAME = "single-task-decomposer/mock@0.1.0";
var METADATA_DRIVEN_DECOMPOSER_NAME = "metadata-driven-mock-decomposer@0.1.0";
var FeaturePlanningMetadataSchema = z5.object({
  tags: z5.array(NonEmptyStringSchema3).default([]),
  expectedModules: z5.array(NonEmptyStringSchema3).default([]),
  expectedRiskAreas: z5.array(NonEmptyStringSchema3).default([]),
  expectedConflictNotes: z5.array(NonEmptyStringSchema3).default([]),
  controlledScenarios: z5.array(NonEmptyStringSchema3).default([]),
  fixtureVersion: NonEmptyStringSchema3.optional()
}).passthrough();
var MockDecomposer = class {
  async decompose(input, options = {}) {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const generatedAt = parsedOptions.generatedAt ?? DEFAULT_GENERATED_AT;
    const mode = parsedOptions.mode;
    const graphId = `${feature.id}:${mode}:graph`;
    const planId = `${feature.id}:${mode}:plan`;
    const rootId = `${feature.id}:${mode}:root`;
    const template = templateForMode(mode);
    const granularity = modeToGranularityLevel(mode);
    const contracts = template.leaves.map(
      (leaf) => buildContract2(feature, mode, leaf)
    );
    const contractsById = contractsByTaskId(contracts);
    const nodes = {
      [rootId]: {
        id: rootId,
        parentId: null,
        kind: "composite",
        title: feature.title,
        goal: feature.description,
        status: "planned",
        granularity,
        depth: 0,
        childrenIds: template.areas.map((area) => taskId(feature.id, mode, area.id))
      }
    };
    for (const area of template.areas) {
      const areaId = taskId(feature.id, mode, area.id);
      nodes[areaId] = {
        id: areaId,
        parentId: rootId,
        kind: "composite",
        title: area.title,
        goal: area.goal,
        status: "planned",
        granularity,
        depth: 1,
        childrenIds: template.leaves.filter((leaf) => leaf.parentId === area.id).map((leaf) => taskId(feature.id, mode, leaf.id))
      };
    }
    for (const leaf of template.leaves) {
      const id = taskId(feature.id, mode, leaf.id);
      const parentId = taskId(feature.id, mode, leaf.parentId);
      const contract = contractsById[id];
      if (!contract) {
        throw new Error(`MockDecomposer internal error: missing contract for ${id}`);
      }
      nodes[id] = {
        id,
        parentId,
        kind: "leaf",
        title: leaf.title,
        goal: leaf.goal,
        status: "planned",
        granularity,
        depth: 2,
        childrenIds: [],
        contract
      };
    }
    const graph = TaskGraphSchema.parse({
      id: graphId,
      planId,
      repo: parsedOptions.repo ?? feature.repositoryPath ?? "mock-target-repository",
      baseBranch: parsedOptions.baseBranch,
      baseCommit: parsedOptions.baseCommit,
      featureRequest: `${feature.title}

${feature.description}`,
      nodes,
      dependencies: template.dependencies.map((dependency2) => ({
        ...dependency2,
        fromTaskId: taskId(feature.id, mode, dependency2.fromTaskId),
        toTaskId: taskId(feature.id, mode, dependency2.toTaskId)
      })),
      rootId,
      createdAt: generatedAt
    });
    const validation = validateDecomposition(graph, contracts);
    return {
      feature,
      graph,
      contracts,
      metadata: {
        mode,
        generatedAt,
        decomposer: MOCK_DECOMPOSER_NAME,
        deterministic: true
      },
      validation
    };
  }
};
var SingleTaskDecomposer = class {
  async decompose(input, options = {}) {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse({
      ...options,
      mode: "coarse"
    });
    const generatedAt = parsedOptions.generatedAt ?? DEFAULT_GENERATED_AT;
    const metadata = FeaturePlanningMetadataSchema.parse(input);
    const template = singleTaskTemplate(feature, metadata);
    return buildDecompositionFromTemplate({
      feature,
      parsedOptions,
      generatedAt,
      mode: "coarse",
      decomposerName: SINGLE_TASK_DECOMPOSER_NAME,
      template
    });
  }
};
var MetadataDrivenMockDecomposer = class {
  async decompose(input, options = {}) {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const generatedAt = parsedOptions.generatedAt ?? DEFAULT_GENERATED_AT;
    const metadata = FeaturePlanningMetadataSchema.parse(input);
    const template = metadataDrivenTemplate(feature, metadata, parsedOptions.mode);
    return buildDecompositionFromTemplate({
      feature,
      parsedOptions,
      generatedAt,
      mode: parsedOptions.mode,
      decomposerName: METADATA_DRIVEN_DECOMPOSER_NAME,
      template
    });
  }
};
function modeToGranularityLevel(mode) {
  if (mode === "balanced" || mode === "auto") {
    return "medium";
  }
  return mode;
}
function contractsByTaskId(contracts) {
  return Object.fromEntries(contracts.map((contract) => [contract.taskId, contract]));
}
function buildDecompositionFromTemplate(input) {
  const graphId = `${input.feature.id}:${input.mode}:graph`;
  const planId = `${input.feature.id}:${input.mode}:plan`;
  const rootId = `${input.feature.id}:${input.mode}:root`;
  const granularity = modeToGranularityLevel(input.mode);
  const contracts = input.template.leaves.map((leaf) => buildContract2(input.feature, input.mode, leaf));
  const contractsById = contractsByTaskId(contracts);
  const nodes = {
    [rootId]: {
      id: rootId,
      parentId: null,
      kind: "composite",
      title: input.feature.title,
      goal: input.feature.description,
      status: "planned",
      granularity,
      depth: 0,
      childrenIds: input.template.areas.map((area) => taskId(input.feature.id, input.mode, area.id))
    }
  };
  for (const area of input.template.areas) {
    const areaId = taskId(input.feature.id, input.mode, area.id);
    nodes[areaId] = {
      id: areaId,
      parentId: rootId,
      kind: "composite",
      title: area.title,
      goal: area.goal,
      status: "planned",
      granularity,
      depth: 1,
      childrenIds: input.template.leaves.filter((leaf) => leaf.parentId === area.id).map((leaf) => taskId(input.feature.id, input.mode, leaf.id))
    };
  }
  for (const leaf of input.template.leaves) {
    const id = taskId(input.feature.id, input.mode, leaf.id);
    const parentId = taskId(input.feature.id, input.mode, leaf.parentId);
    const contract = contractsById[id];
    if (!contract) {
      throw new Error(`Metadata decomposer internal error: missing contract for ${id}`);
    }
    nodes[id] = {
      id,
      parentId,
      kind: "leaf",
      title: leaf.title,
      goal: leaf.goal,
      status: "planned",
      granularity,
      depth: 2,
      childrenIds: [],
      contract
    };
  }
  const graph = TaskGraphSchema.parse({
    id: graphId,
    planId,
    repo: input.parsedOptions.repo ?? input.feature.repositoryPath ?? "mock-target-repository",
    baseBranch: input.parsedOptions.baseBranch,
    baseCommit: input.parsedOptions.baseCommit,
    featureRequest: `${input.feature.title}

${input.feature.description}`,
    nodes,
    dependencies: input.template.dependencies.map((dependency2) => ({
      ...dependency2,
      fromTaskId: taskId(input.feature.id, input.mode, dependency2.fromTaskId),
      toTaskId: taskId(input.feature.id, input.mode, dependency2.toTaskId)
    })),
    rootId,
    createdAt: input.generatedAt
  });
  const validation = validateDecomposition(graph, contracts);
  return {
    feature: input.feature,
    graph,
    contracts,
    metadata: {
      mode: input.mode,
      generatedAt: input.generatedAt,
      decomposer: input.decomposerName,
      deterministic: true
    },
    validation
  };
}
function validateDecomposition(graph, contracts) {
  const graphIssues = validateTaskGraph2(graph).map((issue) => `${issue.code}: ${issue.message}`);
  const leafIds = getLeafNodes(graph).map((node) => node.id).sort();
  const contractIds = contracts.map((contract) => contract.taskId).sort();
  const contractIssues = contracts.flatMap((contract) => {
    const parsed = AgentTaskContractSchema.safeParse(contract);
    if (parsed.success) {
      return [];
    }
    return parsed.error.issues.map((issue) => `${contract.taskId}.${issue.path.join(".")}: ${issue.message}`);
  });
  const missingContractIssues = leafIds.filter((leafId) => !contractIds.includes(leafId)).map((leafId) => `missing_contract: ${leafId}`);
  const extraContractIssues = contractIds.filter((contractId) => !leafIds.includes(contractId)).map((contractId) => `extra_contract: ${contractId}`);
  const duplicateContractIssues = uniqueValues2(contractIds).filter((contractId) => contractIds.filter((id) => id === contractId).length > 1).map((contractId) => `duplicate_contract: ${contractId}`);
  const issues = [
    ...graphIssues,
    ...contractIssues,
    ...missingContractIssues,
    ...extraContractIssues,
    ...duplicateContractIssues
  ];
  return {
    graphValid: graphIssues.length === 0,
    contractValid: contractIssues.length === 0 && missingContractIssues.length === 0 && extraContractIssues.length === 0 && duplicateContractIssues.length === 0,
    issues
  };
}
function buildContract2(feature, mode, leaf) {
  const task = taskId(feature.id, mode, leaf.id);
  const producedSymbols = leaf.producedSymbols ?? [];
  const consumedSymbols = leaf.consumedSymbols ?? [];
  const relevantSymbols = uniqueValues2([
    ...leaf.relevantSymbols ?? [],
    ...producedSymbols,
    ...consumedSymbols
  ]);
  const acceptance = leaf.acceptance.map((description) => ({
    kind: "custom",
    description
  }));
  const validationCommands = (leaf.validationCommands ?? ["pnpm test"]).map((command) => ({
    kind: "unit",
    command,
    blocking: true
  }));
  return AgentTaskContractSchema.parse({
    taskId: task,
    objective: leaf.objective,
    context: {
      typeSignatures: relevantSymbols.map((symbol) => `declare const ${symbol}: unknown;`),
      referenceSnippets: [],
      conventions: [
        "Keep the change inside the declared allowed scope.",
        "Prefer small, reviewable edits with explicit validation."
      ],
      upstreamArtifacts: consumedSymbols
    },
    allowed: {
      paths: leaf.allowedPaths,
      maxFilesTouched: Math.max(leaf.changedFiles.length + 1, 2)
    },
    forbidden: {
      paths: leaf.forbiddenPaths ?? ["**/.env*", "infra/**", "deploy/**"],
      reasons: {
        "**/.env*": "Never read or modify real secrets.",
        "infra/**": "Infrastructure is outside the mock planning scope.",
        "deploy/**": "Deployment changes are outside the mock planning scope."
      }
    },
    // V2 execution-time scope, derived from the same paths so the executor's
    // ScopeChecker enforces (leaf.allowedPaths is non-empty).
    executionScope: executionScopeFromAllowed(leaf.allowedPaths),
    forbiddenPaths: leaf.forbiddenPaths ?? ["**/.env*", "infra/**", "deploy/**"],
    relevantSymbols,
    dependencies: [],
    acceptance,
    validationCommands,
    expectedOutput: {
      changedFiles: leaf.changedFiles,
      producedSymbols,
      consumedSymbols,
      diffShapeHint: `Expected ${mode} mock-plan change for ${leaf.title}.`
    },
    limits: {
      maxDurationMs: 6e4,
      maxCostUsd: 0
    },
    knownRisks: leaf.risks ?? [],
    definitionOfDone: `The ${leaf.title} task satisfies its acceptance criteria and validation commands.`
  });
}
function taskId(featureId, mode, localId) {
  return `${featureId}:${mode}:${localId}`;
}
function singleTaskTemplate(feature, metadata) {
  const files = moduleListForFeature(feature, metadata);
  const featureSymbol = `${pascalCase(feature.id)}Feature`;
  return {
    areas: [
      {
        id: "baseline",
        title: "Single Task Baseline",
        goal: "Represent the whole feature as one structural mock task."
      }
    ],
    leaves: [
      {
        id: "single-task",
        parentId: "baseline",
        title: "Single Task Mock Implementation",
        goal: "Plan the entire feature as one broad baseline task without observable internal decomposition.",
        objective: `Implement the full ${feature.title} fixture as one deterministic mock baseline task.`,
        allowedPaths: scopePatternsForFiles(files),
        changedFiles: files,
        producedSymbols: [featureSymbol],
        relevantSymbols: [featureSymbol, ...symbolsForFeature(feature.id, metadata)],
        acceptance: feature.acceptanceCriteria,
        validationCommands: validationCommandsForFeature(feature),
        risks: [
          "This is a structural mock baseline and does not represent a real single-agent result.",
          ...metadata.expectedConflictNotes
        ]
      }
    ],
    dependencies: []
  };
}
function metadataDrivenTemplate(feature, metadata, mode) {
  if (mode === "balanced" && metadata.controlledScenarios.length > 0) {
    return controlledConflictTemplate(feature, metadata);
  }
  if (mode === "coarse") {
    return metadataCoarseTemplate(feature, metadata);
  }
  if (mode === "fine") {
    return metadataFineTemplate(feature, metadata);
  }
  return metadataBalancedTemplate(feature, metadata);
}
function metadataCoarseTemplate(feature, metadata) {
  const groups = categorizeModules(moduleListForFeature(feature, metadata));
  const domainAndBackend = ensureFiles(
    [...groups.domain, ...groups.backend],
    [`src/${feature.id}/service.ts`]
  );
  const uiFiles = ensureFiles(groups.ui, [`src/components/${feature.id}/panel.tsx`]);
  const testFiles = ensureFiles(groups.tests, [`tests/${feature.id}.test.ts`]);
  const symbols = symbolsForFeature(feature.id, metadata);
  const leaves = [
    {
      id: "domain-and-backend",
      parentId: "domain",
      title: "Domain And Backend Slice",
      goal: `Model and implement the backend behavior for ${feature.title}.`,
      objective: `Plan domain and backend changes for ${feature.title}.`,
      allowedPaths: scopePatternsForFiles(domainAndBackend),
      changedFiles: domainAndBackend,
      producedSymbols: symbols.slice(0, 2),
      relevantSymbols: symbols,
      acceptance: acceptanceSlice(feature, 0, 3),
      risks: metadata.expectedRiskAreas
    },
    {
      id: "ui-and-tests",
      parentId: "quality",
      title: "UI And Test Slice",
      goal: `Add user-visible behavior and tests for ${feature.title}.`,
      objective: `Plan UI feedback and focused tests for ${feature.title}.`,
      allowedPaths: scopePatternsForFiles([...uiFiles, ...testFiles]),
      changedFiles: [...uiFiles, ...testFiles],
      producedSymbols: [symbols[2] ?? `${pascalCase(feature.id)}Surface`],
      consumedSymbols: symbols.slice(0, 2),
      relevantSymbols: symbols,
      acceptance: acceptanceSlice(feature, 2, feature.acceptanceCriteria.length),
      validationCommands: validationCommandsForFeature(feature),
      risks: metadata.expectedConflictNotes
    }
  ];
  const parentIds = new Set(leaves.map((leaf) => leaf.parentId));
  return {
    areas: metadataAreas().filter((area) => parentIds.has(area.id)),
    leaves,
    dependencies: [
      dependency("domain-and-backend", "ui-and-tests", "logical", "UI and tests consume the domain/backend contract.")
    ]
  };
}
function metadataBalancedTemplate(feature, metadata) {
  const groups = categorizeModules(moduleListForFeature(feature, metadata));
  const symbols = symbolsForFeature(feature.id, metadata);
  const domainFiles = ensureFiles(groups.domain, [`src/${feature.id}/model.ts`]);
  const backendFiles = ensureFiles(groups.backend, [`src/${feature.id}/service.ts`]);
  const uiFiles = ensureFiles(groups.ui, [`src/components/${feature.id}/panel.tsx`]);
  const testFiles = ensureFiles(groups.tests, [`tests/${feature.id}.test.ts`]);
  return {
    areas: metadataAreas(),
    leaves: [
      {
        id: "domain-model",
        parentId: "domain",
        title: "Domain Model",
        goal: `Define the data and type surface for ${feature.title}.`,
        objective: `Plan domain model changes for ${feature.title}.`,
        allowedPaths: scopePatternsForFiles(domainFiles),
        changedFiles: domainFiles,
        producedSymbols: [symbols[0] ?? `${pascalCase(feature.id)}Record`],
        relevantSymbols: [symbols[0] ?? `${pascalCase(feature.id)}Record`],
        acceptance: acceptanceSlice(feature, 0, 2),
        risks: metadata.expectedRiskAreas
      },
      {
        id: "backend-action",
        parentId: "backend",
        title: "Backend Action",
        goal: `Implement backend workflow behavior for ${feature.title}.`,
        objective: `Plan backend action changes for ${feature.title}.`,
        allowedPaths: scopePatternsForFiles(backendFiles),
        changedFiles: backendFiles,
        producedSymbols: [symbols[1] ?? `${pascalCase(feature.id)}Service`],
        consumedSymbols: [symbols[0] ?? `${pascalCase(feature.id)}Record`],
        relevantSymbols: symbols.slice(0, 2),
        acceptance: acceptanceSlice(feature, 1, 3),
        risks: metadata.expectedConflictNotes
      },
      {
        id: "ui-surface",
        parentId: "ui",
        title: "UI Surface",
        goal: `Expose ${feature.title} through the user-facing surface.`,
        objective: `Plan UI changes for ${feature.title}.`,
        allowedPaths: scopePatternsForFiles(uiFiles),
        changedFiles: uiFiles,
        producedSymbols: [symbols[2] ?? `${pascalCase(feature.id)}Surface`],
        consumedSymbols: [symbols[0] ?? `${pascalCase(feature.id)}Record`],
        relevantSymbols: [symbols[0] ?? `${pascalCase(feature.id)}Record`, symbols[2] ?? `${pascalCase(feature.id)}Surface`],
        acceptance: acceptanceSlice(feature, 2, 4),
        risks: metadata.expectedRiskAreas.filter((risk) => risk.toLowerCase().includes("ui"))
      },
      {
        id: "feature-tests",
        parentId: "quality",
        title: "Feature Tests",
        goal: `Cover ${feature.title} with deterministic fixture tests.`,
        objective: `Plan test coverage for ${feature.title}.`,
        allowedPaths: scopePatternsForFiles(testFiles),
        changedFiles: testFiles,
        consumedSymbols: symbols.slice(0, 3),
        relevantSymbols: symbols.slice(0, 3),
        acceptance: acceptanceSlice(feature, 0, feature.acceptanceCriteria.length),
        validationCommands: validationCommandsForFeature(feature),
        risks: metadata.expectedConflictNotes
      }
    ],
    dependencies: [
      dependency("domain-model", "backend-action", "contractual", "Backend action consumes the domain model."),
      dependency("domain-model", "ui-surface", "contractual", "UI surface renders domain state."),
      dependency("backend-action", "feature-tests", "logical", "Tests cover backend behavior."),
      dependency("ui-surface", "feature-tests", "logical", "Tests cover user-visible behavior.")
    ]
  };
}
function controlledConflictTemplate(feature, metadata) {
  const scenario = metadata.controlledScenarios[0] ?? "controlled_conflict";
  const leaves = controlledLeavesForScenario(feature, metadata, scenario);
  const parentIds = new Set(leaves.map((leaf) => leaf.parentId));
  return {
    areas: metadataAreas().filter((area) => parentIds.has(area.id)),
    leaves,
    dependencies: []
  };
}
function controlledLeavesForScenario(feature, metadata, scenario) {
  const risks = [
    `Controlled conflict scenario: ${scenario}`,
    ...metadata.expectedRiskAreas,
    ...metadata.expectedConflictNotes
  ];
  if (scenario === "shared_schema_conflict") {
    return [
      controlledLeaf(feature, {
        id: "schema-customer-fields",
        parentId: "domain",
        title: "Schema Customer Fields",
        file: "src/lib/db/schema.ts",
        producedSymbols: ["UserRecord"],
        relevantSymbols: ["UserRecord", "authSchemaVersion"],
        acceptance: acceptanceSlice(feature, 0, 2),
        risks
      }),
      controlledLeaf(feature, {
        id: "schema-auth-index",
        parentId: "domain",
        title: "Schema Auth Index",
        file: "src/lib/db/schema.ts",
        producedSymbols: ["authSchemaVersion"],
        relevantSymbols: ["UserRecord", "authSchemaVersion"],
        acceptance: acceptanceSlice(feature, 2, 4),
        risks
      })
    ];
  }
  if (scenario === "public_api_contract_conflict") {
    return [
      controlledLeaf(feature, {
        id: "public-api-provider",
        parentId: "backend",
        title: "Public API Provider",
        file: "src/quotes/approval/approval-service.ts",
        producedSymbols: ["recordQuoteApprovalDecision"],
        relevantSymbols: ["recordQuoteApprovalDecision", "QuoteApprovalResult"],
        acceptance: acceptanceSlice(feature, 0, 2),
        risks
      }),
      controlledLeaf(feature, {
        id: "public-api-consumer",
        parentId: "ui",
        title: "Public API Consumer",
        file: "src/components/quotes/quote-approval-panel.tsx",
        consumedSymbols: ["recordQuoteApprovalDecision"],
        relevantSymbols: ["recordQuoteApprovalDecision", "QuoteApprovalPanel"],
        acceptance: acceptanceSlice(feature, 2, 4),
        risks
      })
    ];
  }
  if (scenario === "shared_auth_session_conflict") {
    return [
      controlledLeaf(feature, {
        id: "session-state",
        parentId: "backend",
        title: "Session State",
        file: "src/auth/session/passwordless-session.ts",
        producedSymbols: ["Session"],
        relevantSymbols: ["Session", "createSessionForUser"],
        acceptance: acceptanceSlice(feature, 0, 2),
        risks
      }),
      controlledLeaf(feature, {
        id: "session-token-bridge",
        parentId: "backend",
        title: "Session Token Bridge",
        file: "src/auth/session/passwordless-session.ts",
        producedSymbols: ["createSessionForUser"],
        consumedSymbols: ["MagicLinkTokenStore"],
        relevantSymbols: ["Session", "createSessionForUser", "MagicLinkTokenStore"],
        acceptance: acceptanceSlice(feature, 2, 4),
        risks
      })
    ];
  }
  if (scenario === "shared_test_fixture_conflict") {
    return [
      controlledLeaf(feature, {
        id: "auth-test-success",
        parentId: "quality",
        title: "Auth Test Success Fixture",
        file: "tests/auth/passwordless-login.test.ts",
        consumedSymbols: ["requestMagicLink"],
        relevantSymbols: ["requestMagicLink", "validateMagicLinkToken"],
        validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"],
        acceptance: acceptanceSlice(feature, 0, 2),
        risks
      }),
      controlledLeaf(feature, {
        id: "auth-test-error",
        parentId: "quality",
        title: "Auth Test Error Fixture",
        file: "tests/auth/passwordless-login.test.ts",
        consumedSymbols: ["validateMagicLinkToken"],
        relevantSymbols: ["requestMagicLink", "validateMagicLinkToken"],
        validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"],
        acceptance: acceptanceSlice(feature, 2, 4),
        risks
      })
    ];
  }
  return [
    controlledLeaf(feature, {
      id: "scope-escape",
      parentId: "ui",
      title: "Scope Escape Simulation",
      file: "src/components/auth/magic-link-form.tsx",
      producedSymbols: ["MagicLinkRequestForm"],
      relevantSymbols: ["MagicLinkRequestForm"],
      acceptance: acceptanceSlice(feature, 0, 2),
      risks
    }),
    controlledLeaf(feature, {
      id: "scope-guard-test",
      parentId: "quality",
      title: "Scope Guard Test",
      file: "tests/auth/passwordless-login.test.ts",
      consumedSymbols: ["MagicLinkRequestForm"],
      relevantSymbols: ["MagicLinkRequestForm"],
      validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"],
      acceptance: acceptanceSlice(feature, 2, 4),
      risks
    })
  ];
}
function controlledLeaf(feature, input) {
  const leaf = {
    id: input.id,
    parentId: input.parentId,
    title: input.title,
    goal: `Exercise a controlled conflict for ${feature.title}.`,
    objective: `Represent the ${input.title} conflict scenario deterministically.`,
    allowedPaths: scopePatternsForFiles([input.file]),
    changedFiles: [input.file],
    acceptance: input.acceptance,
    risks: input.risks
  };
  if (input.producedSymbols !== void 0) {
    leaf.producedSymbols = input.producedSymbols;
  }
  if (input.consumedSymbols !== void 0) {
    leaf.consumedSymbols = input.consumedSymbols;
  }
  if (input.relevantSymbols !== void 0) {
    leaf.relevantSymbols = input.relevantSymbols;
  }
  if (input.validationCommands !== void 0) {
    leaf.validationCommands = input.validationCommands;
  }
  return leaf;
}
function metadataFineTemplate(feature, metadata) {
  const files = moduleListForFeature(feature, metadata);
  const symbols = symbolsForFeature(feature.id, metadata);
  const leaves = files.map((file, index) => {
    const localId = localIdFromFile(file, index);
    const parentId = parentIdForFile(file);
    const producedSymbol = symbols[index] ?? `${pascalCase(feature.id)}Part${index + 1}`;
    const leaf = {
      id: localId,
      parentId,
      title: titleFromFile(file),
      goal: `Plan the ${file} slice for ${feature.title}.`,
      objective: `Create the deterministic fine-grained mock task for ${file}.`,
      allowedPaths: scopePatternsForFiles([file]),
      changedFiles: [file],
      producedSymbols: isTestFile(file) ? [] : [producedSymbol],
      consumedSymbols: index === 0 ? [] : [symbols[0] ?? `${pascalCase(feature.id)}Record`],
      relevantSymbols: uniqueValues2([producedSymbol, symbols[0] ?? `${pascalCase(feature.id)}Record`]),
      acceptance: acceptanceSlice(feature, index, index + 1),
      risks: metadata.expectedRiskAreas
    };
    if (isTestFile(file)) {
      leaf.validationCommands = validationCommandsForFeature(feature);
    }
    return leaf;
  });
  const dependencyInputs = [];
  const firstDomain = leaves.find((leaf) => leaf.parentId === "domain")?.id;
  const backendIds = leaves.filter((leaf) => leaf.parentId === "backend").map((leaf) => leaf.id);
  const uiIds = leaves.filter((leaf) => leaf.parentId === "ui").map((leaf) => leaf.id);
  const testIds = leaves.filter((leaf) => leaf.parentId === "quality").map((leaf) => leaf.id);
  if (firstDomain) {
    for (const leafId of [...backendIds, ...uiIds]) {
      dependencyInputs.push(dependency(firstDomain, leafId, "contractual", `${leafId} consumes the domain surface.`));
    }
  }
  for (const testId of testIds) {
    for (const producerId of [...backendIds, ...uiIds].slice(0, 4)) {
      dependencyInputs.push(dependency(producerId, testId, "logical", `${testId} validates ${producerId}.`));
    }
  }
  return {
    areas: metadataAreas(),
    leaves,
    dependencies: dependencyInputs
  };
}
function metadataAreas() {
  return [
    {
      id: "domain",
      title: "Domain And Data",
      goal: "Model data, types and shared domain contracts."
    },
    {
      id: "backend",
      title: "Backend Workflow",
      goal: "Implement deterministic backend actions or services."
    },
    {
      id: "ui",
      title: "User Surface",
      goal: "Represent UI, public pages and feedback surfaces."
    },
    {
      id: "quality",
      title: "Tests And Quality",
      goal: "Represent focused test coverage and quality checks."
    }
  ];
}
function moduleListForFeature(feature, metadata) {
  return metadata.expectedModules.length > 0 ? uniqueValues2(metadata.expectedModules) : [
    `src/${feature.id}/model.ts`,
    `src/${feature.id}/service.ts`,
    `src/components/${feature.id}/panel.tsx`,
    `tests/${feature.id}.test.ts`
  ];
}
function categorizeModules(files) {
  return {
    domain: files.filter((file) => isDomainFile(file)),
    backend: files.filter((file) => !isDomainFile(file) && !isUiFile(file) && !isTestFile(file)),
    ui: files.filter((file) => isUiFile(file)),
    tests: files.filter((file) => isTestFile(file))
  };
}
function scopePatternsForFiles(files) {
  return uniqueValues2([
    ...files,
    ...files.map((file) => `${dirname(file)}/**`)
  ]);
}
function ensureFiles(files, fallback) {
  return files.length > 0 ? uniqueValues2(files) : [...fallback];
}
function acceptanceSlice(feature, from, to) {
  const slice = feature.acceptanceCriteria.slice(from, to);
  return slice.length > 0 ? slice : [feature.acceptanceCriteria[0] ?? "The fixture acceptance criteria are represented."];
}
function validationCommandsForFeature(feature) {
  return [`pnpm test -- ${feature.id}`];
}
function symbolsForFeature(featureId, metadata) {
  const base = pascalCase(featureId);
  const derived = metadata.expectedModules.map((file) => titleFromFile(file).replace(/[^A-Za-z0-9]/gu, "")).filter((value) => value.length > 0).map((value) => `${base}${value}`);
  return uniqueValues2([
    `${base}Record`,
    `${base}Service`,
    `${base}Surface`,
    `${base}TestCoverage`,
    ...derived
  ]);
}
function localIdFromFile(file, index) {
  const base = file.replace(/\.[^.]+$/u, "").split("/").filter(Boolean).slice(-2).join("-").replace(/[^A-Za-z0-9-]/gu, "-").replace(/--+/gu, "-").toLowerCase();
  return `${String(index + 1).padStart(2, "0")}-${base || "task"}`;
}
function titleFromFile(file) {
  const filename = file.split("/").pop() ?? file;
  const withoutExtension = filename.replace(/\.[^.]+$/u, "");
  return withoutExtension.split(/[-_]/u).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}
function parentIdForFile(file) {
  if (isTestFile(file)) {
    return "quality";
  }
  if (isUiFile(file)) {
    return "ui";
  }
  if (isDomainFile(file)) {
    return "domain";
  }
  return "backend";
}
function isDomainFile(file) {
  const normalized = file.toLowerCase();
  return normalized.includes("/schema") || normalized.includes("/model") || normalized.includes("/types") || normalized.includes("/db/") || normalized.endsWith("schema.ts") || normalized.endsWith("record.ts");
}
function isUiFile(file) {
  const normalized = file.toLowerCase();
  return normalized.includes("/components/") || normalized.includes("/app/") || normalized.includes("/public/");
}
function isTestFile(file) {
  const normalized = file.toLowerCase();
  return normalized.includes("/tests/") || normalized.includes(".test.") || normalized.includes(".spec.");
}
function dirname(file) {
  const parts = file.split("/");
  parts.pop();
  return parts.length > 0 ? parts.join("/") : ".";
}
function pascalCase(value) {
  return value.split(/[^A-Za-z0-9]/u).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("");
}
function templateForMode(mode) {
  if (mode === "coarse") {
    return coarseTemplate();
  }
  if (mode === "fine") {
    return fineTemplate();
  }
  return balancedTemplate();
}
function commonAreas() {
  return [
    {
      id: "ui",
      title: "User Experience",
      goal: "Design the user-facing request and callback feedback surfaces."
    },
    {
      id: "backend",
      title: "Auth Backend",
      goal: "Model, generate, persist and validate magic link tokens."
    },
    {
      id: "quality",
      title: "Quality And Documentation",
      goal: "Protect the flow with focused tests and implementation notes."
    }
  ];
}
function coarseTemplate() {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "auth-backend",
        parentId: "backend",
        title: "Auth Backend Slice",
        goal: "Implement the backend primitives for issuing and validating passwordless login tokens.",
        objective: "Create the backend magic-link token generation, persistence and callback validation slice.",
        allowedPaths: ["src/auth/magic-link/**", "src/auth/session/**"],
        changedFiles: ["src/auth/magic-link/index.ts", "src/auth/session/index.ts"],
        producedSymbols: ["MagicLinkToken", "MagicLinkTokenStore", "validateMagicLinkToken", "createSessionForUser"],
        relevantSymbols: ["MagicLinkToken", "MagicLinkTokenStore", "Session"],
        acceptance: [
          "A one-use magic link token can be generated and validated.",
          "Expired or reused tokens are rejected."
        ],
        risks: ["Combines token persistence and callback validation in a coarse task."]
      },
      {
        id: "login-ui",
        parentId: "ui",
        title: "Login UI Slice",
        goal: "Implement the request form and callback feedback for passwordless login.",
        objective: "Add the login request surface and feedback states for success, pending and error outcomes.",
        allowedPaths: ["src/app/login/**", "src/components/auth/**"],
        changedFiles: ["src/app/login/page.tsx", "src/components/auth/magic-link-form.tsx"],
        consumedSymbols: ["requestMagicLink", "validateMagicLinkToken"],
        relevantSymbols: ["MagicLinkRequest", "MagicLinkFeedback"],
        acceptance: [
          "The user can request a magic link from the login screen.",
          "The UI shows success and error feedback."
        ]
      },
      {
        id: "auth-tests",
        parentId: "quality",
        title: "Auth Flow Tests",
        goal: "Cover the passwordless login flow with focused tests.",
        objective: "Add minimal tests for token generation, expiry, callback validation and UI feedback.",
        allowedPaths: ["tests/auth/**", "src/auth/**/*.test.ts", "src/app/login/**/*.test.tsx"],
        changedFiles: ["tests/auth/passwordless-login.test.ts"],
        consumedSymbols: ["MagicLinkTokenStore", "validateMagicLinkToken", "MagicLinkFeedback"],
        relevantSymbols: ["MagicLinkTokenStore", "validateMagicLinkToken", "MagicLinkFeedback"],
        acceptance: [
          "Tests cover valid, expired and reused magic link tokens.",
          "Tests cover success and error feedback."
        ],
        validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
      }
    ],
    dependencies: [
      dependency("auth-backend", "login-ui", "contractual", "UI consumes the backend request and callback contracts."),
      dependency("auth-backend", "auth-tests", "logical", "Tests validate backend behavior."),
      dependency("login-ui", "auth-tests", "logical", "Tests validate UI feedback.")
    ]
  };
}
function balancedTemplate() {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "token-model",
        parentId: "backend",
        title: "Token Model",
        goal: "Define the token shape, expiry semantics and one-use state.",
        objective: "Introduce the magic link token model and typed token store contract.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/token-store.ts"],
        producedSymbols: ["MagicLinkToken", "MagicLinkTokenStore"],
        relevantSymbols: ["MagicLinkToken", "MagicLinkTokenStore"],
        acceptance: [
          "The token model includes user id, expiry and consumed state.",
          "The store contract supports create, consume and lookup behavior."
        ]
      },
      {
        id: "request-action",
        parentId: "backend",
        title: "Request Action",
        goal: "Handle a login request and create a magic link token.",
        objective: "Add the action or endpoint that accepts an email and creates a one-use token.",
        allowedPaths: ["src/auth/magic-link/**", "src/app/api/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/request-action.ts", "src/auth/magic-link/token-store.ts"],
        producedSymbols: ["requestMagicLink"],
        consumedSymbols: ["MagicLinkTokenStore", "MagicLinkToken"],
        relevantSymbols: ["requestMagicLink", "MagicLinkTokenStore"],
        acceptance: [
          "The request action validates the submitted email.",
          "The request action creates a token with an expiry."
        ],
        risks: ["Touches the token store contract while implementing request behavior."]
      },
      {
        id: "email-link",
        parentId: "backend",
        title: "Email Link Builder",
        goal: "Build the callback URL and email payload for the token.",
        objective: "Create the magic link URL builder without adding a real email provider.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/email-link.ts"],
        producedSymbols: ["buildMagicLinkEmail"],
        consumedSymbols: ["MagicLinkToken"],
        relevantSymbols: ["MagicLinkToken", "buildMagicLinkEmail"],
        acceptance: [
          "The generated URL includes the token identifier.",
          "No real email provider or secret configuration is introduced."
        ]
      },
      {
        id: "callback-validation",
        parentId: "backend",
        title: "Callback Validation",
        goal: "Validate a callback token and reject invalid states.",
        objective: "Implement the callback validator for valid, expired and already consumed tokens.",
        allowedPaths: ["src/auth/magic-link/**", "src/app/auth/callback/**"],
        changedFiles: ["src/auth/magic-link/callback-validation.ts", "src/auth/magic-link/token-store.ts"],
        producedSymbols: ["validateMagicLinkToken"],
        consumedSymbols: ["MagicLinkTokenStore", "MagicLinkToken"],
        relevantSymbols: ["validateMagicLinkToken", "MagicLinkTokenStore"],
        acceptance: [
          "Valid tokens are consumed exactly once.",
          "Expired and reused tokens produce explicit error states."
        ],
        risks: ["Touches the token store contract while implementing callback behavior."]
      },
      {
        id: "session-bridge",
        parentId: "backend",
        title: "Session Bridge",
        goal: "Create an authenticated session after successful token validation.",
        objective: "Connect successful magic link validation to session creation.",
        allowedPaths: ["src/auth/session/**", "src/auth/magic-link/**"],
        changedFiles: ["src/auth/session/passwordless-session.ts"],
        producedSymbols: ["createSessionForMagicLink"],
        consumedSymbols: ["validateMagicLinkToken"],
        relevantSymbols: ["Session", "createSessionForMagicLink", "validateMagicLinkToken"],
        acceptance: [
          "A valid token creates a session for the matching user.",
          "Invalid token outcomes do not create sessions."
        ]
      },
      {
        id: "login-ui",
        parentId: "ui",
        title: "Login UI",
        goal: "Expose the magic link request flow to the user.",
        objective: "Add the login form and user feedback states for requesting a magic link.",
        allowedPaths: ["src/app/login/**", "src/components/auth/**"],
        changedFiles: ["src/app/login/page.tsx", "src/components/auth/magic-link-form.tsx"],
        producedSymbols: ["MagicLinkRequestForm"],
        consumedSymbols: ["requestMagicLink"],
        relevantSymbols: ["MagicLinkRequestForm", "requestMagicLink"],
        acceptance: [
          "The login screen lets the user submit an email.",
          "The screen shows clear success and error feedback."
        ]
      },
      {
        id: "auth-tests",
        parentId: "quality",
        title: "Auth Tests",
        goal: "Add tests for the planned passwordless login behavior.",
        objective: "Cover token creation, expiry, callback validation, session creation and UI feedback.",
        allowedPaths: ["tests/auth/**", "src/auth/**/*.test.ts", "src/app/login/**/*.test.tsx"],
        changedFiles: ["tests/auth/passwordless-login.test.ts"],
        consumedSymbols: [
          "requestMagicLink",
          "validateMagicLinkToken",
          "createSessionForMagicLink",
          "MagicLinkRequestForm"
        ],
        relevantSymbols: [
          "requestMagicLink",
          "validateMagicLinkToken",
          "createSessionForMagicLink",
          "MagicLinkRequestForm"
        ],
        acceptance: [
          "Tests cover success, expiry and invalid callback states.",
          "Tests cover UI request feedback."
        ],
        validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
      }
    ],
    dependencies: [
      dependency("token-model", "request-action", "contractual", "Request action consumes the token store."),
      dependency("token-model", "email-link", "contractual", "Email link builder uses token metadata."),
      dependency("token-model", "callback-validation", "contractual", "Callback validation consumes the token store."),
      dependency("request-action", "login-ui", "logical", "UI submits to the request action."),
      dependency("callback-validation", "session-bridge", "contractual", "Session bridge depends on callback validation."),
      dependency("request-action", "auth-tests", "logical", "Tests validate request behavior."),
      dependency("callback-validation", "auth-tests", "logical", "Tests validate callback behavior."),
      dependency("session-bridge", "auth-tests", "logical", "Tests validate session creation."),
      dependency("login-ui", "auth-tests", "logical", "Tests validate UI feedback.")
    ]
  };
}
function fineTemplate() {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "token-schema",
        parentId: "backend",
        title: "Token Schema",
        goal: "Define the magic link token data contract.",
        objective: "Introduce the token shape and validation helpers.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/token-schema.ts"],
        producedSymbols: ["MagicLinkToken"],
        relevantSymbols: ["MagicLinkToken"],
        acceptance: ["The token shape includes identity, expiry and consumed state."]
      },
      {
        id: "token-generator",
        parentId: "backend",
        title: "Token Generator",
        goal: "Generate opaque one-use token values.",
        objective: "Create the deterministic contract for generating magic link token values.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/token-generator.ts"],
        producedSymbols: ["generateMagicLinkToken"],
        consumedSymbols: ["MagicLinkToken"],
        relevantSymbols: ["generateMagicLinkToken", "MagicLinkToken"],
        acceptance: ["Token generation produces a storable token record."]
      },
      {
        id: "token-persistence",
        parentId: "backend",
        title: "Token Persistence",
        goal: "Persist and consume magic link tokens.",
        objective: "Implement the token store contract for create, lookup and consume operations.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/token-store.ts"],
        producedSymbols: ["MagicLinkTokenStore"],
        consumedSymbols: ["MagicLinkToken"],
        relevantSymbols: ["MagicLinkTokenStore", "MagicLinkToken"],
        acceptance: ["The token store can create, lookup and consume one token once."]
      },
      {
        id: "request-action",
        parentId: "backend",
        title: "Request Action",
        goal: "Accept a user email and issue a magic link token.",
        objective: "Add the request action without sending a real email.",
        allowedPaths: ["src/app/api/auth/magic-link/**", "src/auth/magic-link/**"],
        changedFiles: ["src/app/api/auth/magic-link/request.ts"],
        producedSymbols: ["requestMagicLink"],
        consumedSymbols: ["MagicLinkTokenStore", "generateMagicLinkToken"],
        relevantSymbols: ["requestMagicLink", "MagicLinkTokenStore"],
        acceptance: ["The request action validates email input and creates a token."]
      },
      {
        id: "email-link",
        parentId: "backend",
        title: "Email Link",
        goal: "Build the callback link from the issued token.",
        objective: "Create a provider-free email link builder.",
        allowedPaths: ["src/auth/magic-link/**"],
        changedFiles: ["src/auth/magic-link/email-link.ts"],
        producedSymbols: ["buildMagicLinkEmail"],
        consumedSymbols: ["MagicLinkToken"],
        relevantSymbols: ["buildMagicLinkEmail", "MagicLinkToken"],
        acceptance: ["The link builder creates a callback URL containing a token reference."]
      },
      {
        id: "callback-route",
        parentId: "backend",
        title: "Callback Route",
        goal: "Handle a magic link callback request.",
        objective: "Add callback routing that delegates token validation and feedback state.",
        allowedPaths: ["src/app/auth/callback/**", "src/auth/magic-link/**"],
        changedFiles: ["src/app/auth/callback/route.ts"],
        producedSymbols: ["handleMagicLinkCallback"],
        consumedSymbols: ["MagicLinkTokenStore"],
        relevantSymbols: ["handleMagicLinkCallback", "MagicLinkTokenStore"],
        acceptance: ["The callback route handles missing, invalid, expired and valid tokens."]
      },
      {
        id: "session-bridge",
        parentId: "backend",
        title: "Session Bridge",
        goal: "Create a session after callback success.",
        objective: "Bridge callback success to session creation.",
        allowedPaths: ["src/auth/session/**", "src/auth/magic-link/**"],
        changedFiles: ["src/auth/session/passwordless-session.ts"],
        producedSymbols: ["createSessionForMagicLink"],
        consumedSymbols: ["handleMagicLinkCallback"],
        relevantSymbols: ["createSessionForMagicLink", "handleMagicLinkCallback"],
        acceptance: ["Successful callback validation creates a user session."]
      },
      {
        id: "ui-form",
        parentId: "ui",
        title: "Request Form",
        goal: "Let the user request a login link.",
        objective: "Add the login form for entering an email address.",
        allowedPaths: ["src/app/login/**", "src/components/auth/**"],
        changedFiles: ["src/components/auth/magic-link-form.tsx"],
        producedSymbols: ["MagicLinkRequestForm"],
        consumedSymbols: ["requestMagicLink"],
        relevantSymbols: ["MagicLinkRequestForm", "requestMagicLink"],
        acceptance: ["The form submits an email to the request action."]
      },
      {
        id: "ui-feedback",
        parentId: "ui",
        title: "Feedback States",
        goal: "Show success and error outcomes.",
        objective: "Add user-facing feedback states for request and callback outcomes.",
        allowedPaths: ["src/app/login/**", "src/components/auth/**"],
        changedFiles: ["src/components/auth/magic-link-feedback.tsx"],
        producedSymbols: ["MagicLinkFeedback"],
        consumedSymbols: ["handleMagicLinkCallback"],
        relevantSymbols: ["MagicLinkFeedback", "handleMagicLinkCallback"],
        acceptance: ["The UI shows success, pending and error states."]
      },
      {
        id: "auth-tests",
        parentId: "quality",
        title: "Fine Auth Tests",
        goal: "Test the fine-grained passwordless flow.",
        objective: "Add focused tests for generated token behavior, callbacks, sessions and UI feedback.",
        allowedPaths: ["tests/auth/**", "src/auth/**/*.test.ts", "src/app/login/**/*.test.tsx"],
        changedFiles: ["tests/auth/passwordless-login.test.ts"],
        consumedSymbols: [
          "generateMagicLinkToken",
          "MagicLinkTokenStore",
          "handleMagicLinkCallback",
          "createSessionForMagicLink",
          "MagicLinkRequestForm",
          "MagicLinkFeedback"
        ],
        relevantSymbols: [
          "generateMagicLinkToken",
          "MagicLinkTokenStore",
          "handleMagicLinkCallback",
          "createSessionForMagicLink",
          "MagicLinkRequestForm",
          "MagicLinkFeedback"
        ],
        acceptance: ["Tests cover token, callback, session and UI feedback behavior."],
        validationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
      }
    ],
    dependencies: [
      dependency("token-schema", "token-generator", "contractual", "Generator emits token records."),
      dependency("token-schema", "token-persistence", "contractual", "Store persists token records."),
      dependency("token-generator", "request-action", "contractual", "Request action generates tokens."),
      dependency("token-persistence", "request-action", "contractual", "Request action stores tokens."),
      dependency("token-schema", "email-link", "contractual", "Email link consumes token metadata."),
      dependency("token-persistence", "callback-route", "contractual", "Callback route consumes the token store."),
      dependency("callback-route", "session-bridge", "contractual", "Session bridge depends on callback success."),
      dependency("request-action", "ui-form", "logical", "UI form submits magic link requests."),
      dependency("callback-route", "ui-feedback", "logical", "Feedback renders callback outcomes."),
      dependency("token-generator", "auth-tests", "logical", "Tests cover token generation."),
      dependency("token-persistence", "auth-tests", "logical", "Tests cover token persistence."),
      dependency("callback-route", "auth-tests", "logical", "Tests cover callback routing."),
      dependency("session-bridge", "auth-tests", "logical", "Tests cover session creation."),
      dependency("ui-form", "auth-tests", "logical", "Tests cover the request form."),
      dependency("ui-feedback", "auth-tests", "logical", "Tests cover feedback states.")
    ]
  };
}
function dependency(fromTaskId, toTaskId, type, rationale) {
  return {
    fromTaskId,
    toTaskId,
    type,
    inferred: false,
    rationale
  };
}
export {
  ADAPTIVE_GRANULARITY_FORMULA_VERSION,
  ADAPTIVE_GRANULARITY_POLICY,
  ADAPTIVE_UTILITY_POLICY_VERSION,
  AcceptanceIntentSchema,
  AdaptiveGranularityCompiler,
  AnthropicDecomposer,
  ArchitectPass,
  CONTEXT_ESTIMATOR_VERSION,
  CandidateArtifactSchema,
  CandidateSeamSchema,
  ClaudeCodeRecursiveDecomposer,
  CodexRecursiveDecomposer,
  ComplexitySignalsSchema,
  DECOMPOSER_PROMPT_TEMPLATE_VERSION,
  DEFAULT_COMPLEXITY_WEIGHTS,
  DecomposeStepOutputSchema,
  DecomposerLlmDependencySchema,
  DecomposerLlmError,
  DecomposerLlmNodeSchema,
  DecomposerLlmOutputSchema,
  DecomposerQuestionError,
  DecompositionMetadataSchema,
  DecompositionModeSchema,
  DecompositionOptionsSchema,
  DecompositionValidationSchema,
  FINE_SPLIT_POLICY,
  FeatureRequestSchema,
  GRANULARITY_CONDITIONS,
  GRANULARITY_PROFILES,
  InMemoryThesisMetricsStore,
  IntrinsicComplexityEvaluator,
  LEAF_COMPLEXITY_THRESHOLD,
  MetadataDrivenMockDecomposer,
  MockDecomposer,
  NonRetryablePlanningError,
  PILOT_UTILITY_POLICY,
  PLAN_CRITIC_KINDS,
  PlanningArchitectureVersionSchema,
  PlanningCapacityError,
  RECURSIVE_DECOMPOSER_PROMPT_VERSION,
  RecursiveDecomposer,
  RepositoryEvidenceSchema,
  SINGLE_LEAF_POLICY,
  SemanticCutSchema,
  SingleTaskDecomposer,
  StepInterfaceSchema,
  ThesisMetricsCollector,
  WorkBreakdownPlanner,
  WorkBreakdownProgressLineSchema,
  WorkBreakdownProgressUnitSchema,
  WorkBreakdownSchema,
  WorkQuestionSchema,
  WorkUncertaintySchema,
  WorkUnitSchema,
  allocateAcceptanceIntents,
  applyAdaptiveGranularity,
  assertPlanReview,
  buildDecomposerPrompt,
  buildRepositoryContextProfiles,
  buildStepPrompt,
  buildWorkBreakdownPrompt,
  candidateBreakdownHash,
  classifyGraphGenerationError,
  compileAcceptanceCriterion,
  compileAdaptiveWorkUnitTree,
  compileContractBundles,
  compileGraphRevision,
  compileLocalAcceptanceCriterion,
  compileValidationObligation,
  compressContext,
  computeInputFingerprint,
  contractsByTaskId,
  evaluateIntrinsicComplexity,
  executionScopeFromAllowed,
  extractInterfaceSignatures,
  granularityPolicyFor,
  isDecomposerLlmError,
  isDecomposerQuestionError,
  isRecoverableGraphGenerationKind,
  modeToGranularityLevel,
  normalizeLlmDecomposition,
  parseWorkBreakdownProgressLine,
  recommendedBranchingFactor,
  requiresResplitting,
  resolveGranularityCondition,
  reviewCompiledPlan,
  reviewGranularityProposal,
  runArchitectPass,
  runDecomposerGuards,
  selectGranularityStrategy,
  summarizeTreeByScope,
  validateUtilityPolicyConfig
};
