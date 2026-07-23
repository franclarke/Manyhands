import {
  AgentTaskContractSchema,
  type AcceptanceCriterion,
  type AgentTaskContract,
  type ValidationCommand
} from "@manyhands/contracts";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema, uniqueValues } from "@manyhands/shared";
import {
  getLeafNodes,
  TaskGraphSchema,
  validateTaskGraph,
  type TaskDependency,
  type TaskGranularityLevel,
  type TaskGraph,
  type TaskNode
} from "@manyhands/task-graph";
import { executionScopeFromAllowed } from "./scope";
import { DecomposeStepOutputSchema } from "./llm/recursive/step-schema";
import { z } from "zod";

export * from "./planner/prompt.js";
export * from "./planner/schema.js";
export * from "./planner/work-breakdown.js";
export * from "./compiler/contract-compiler.js";
export * from "./compiler/graph-compiler.js";
export * from "./compiler/validation-obligations.js";
export * from "./critics/review.js";
export * from "./granularity/complexity-evaluator.js";
export * from "./granularity/coalescing-critic.js";
export * from "./granularity/thesis-metrics.js";
export * from "./context-compressor.js";
export * from "./llm/architect-pass.js";
export * from "./compiler/graph-compiler-v3.js";

export const FeatureRequestSchema = z.object({
  id: EntityIdSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  repositoryPath: NonEmptyStringSchema.optional(),
  targetStack: z.array(NonEmptyStringSchema).default([]),
  constraints: z.array(NonEmptyStringSchema).default([]),
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1)
});

export type FeatureRequest = z.infer<typeof FeatureRequestSchema>;

export const DecompositionModeSchema = z.union([
  z.literal("coarse"),
  z.literal("balanced"),
  z.literal("fine"),
  // "auto" is adaptive: the recursive decomposer lets each node pick its own
  // split pressure from its assessed complexity. Non-recursive consumers
  // (deterministic templates, single-pass prompt) treat it as "balanced".
  z.literal("auto")
]);

export type DecompositionMode = z.infer<typeof DecompositionModeSchema>;

export const DecompositionOptionsSchema = z.object({
  mode: DecompositionModeSchema.default("balanced"),
  generatedAt: IsoTimestampSchema.optional(),
  baseBranch: NonEmptyStringSchema.default("main"),
  baseCommit: NonEmptyStringSchema.default("mock-base-commit"),
  repo: NonEmptyStringSchema.optional(),
  questionAnswers: z.record(z.string()).optional(),
  stepCache: z.record(DecomposeStepOutputSchema).optional()
});


export type DecompositionOptions = z.input<typeof DecompositionOptionsSchema>;

export const DecompositionMetadataSchema = z.object({
  mode: DecompositionModeSchema,
  generatedAt: IsoTimestampSchema,
  decomposer: NonEmptyStringSchema,
  deterministic: z.boolean()
});

export type DecompositionMetadata = z.infer<typeof DecompositionMetadataSchema>;

export const DecompositionValidationSchema = z.object({
  graphValid: z.boolean(),
  contractValid: z.boolean(),
  issues: z.array(z.string())
});

export type DecompositionValidation = z.infer<typeof DecompositionValidationSchema>;

export interface DecompositionResult {
  feature: FeatureRequest;
  graph: TaskGraph;
  contracts: AgentTaskContract[];
  metadata: DecompositionMetadata;
  validation: DecompositionValidation;
}

export interface Decomposer {
  decompose(input: FeatureRequest, options?: DecompositionOptions): Promise<DecompositionResult>;
}

interface LeafTemplate {
  id: string;
  parentId: string;
  title: string;
  goal: string;
  objective: string;
  allowedPaths: string[];
  forbiddenPaths?: string[];
  changedFiles: string[];
  producedSymbols?: string[];
  consumedSymbols?: string[];
  relevantSymbols?: string[];
  acceptance: string[];
  validationCommands?: string[];
  risks?: string[];
}

interface AreaTemplate {
  id: string;
  title: string;
  goal: string;
}

interface ModeTemplate {
  areas: AreaTemplate[];
  leaves: LeafTemplate[];
  dependencies: TaskDependency[];
}

const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";
const MOCK_DECOMPOSER_NAME = "mock-decomposer/passwordless-login@0.1.0";
const SINGLE_TASK_DECOMPOSER_NAME = "single-task-decomposer/mock@0.1.0";
const METADATA_DRIVEN_DECOMPOSER_NAME = "metadata-driven-mock-decomposer@0.1.0";

const FeaturePlanningMetadataSchema = z.object({
  tags: z.array(NonEmptyStringSchema).default([]),
  expectedModules: z.array(NonEmptyStringSchema).default([]),
  expectedRiskAreas: z.array(NonEmptyStringSchema).default([]),
  expectedConflictNotes: z.array(NonEmptyStringSchema).default([]),
  controlledScenarios: z.array(NonEmptyStringSchema).default([]),
  fixtureVersion: NonEmptyStringSchema.optional()
}).passthrough();

type FeaturePlanningMetadata = z.infer<typeof FeaturePlanningMetadataSchema>;

export class MockDecomposer implements Decomposer {
  async decompose(input: FeatureRequest, options: DecompositionOptions = {}): Promise<DecompositionResult> {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const generatedAt = parsedOptions.generatedAt ?? DEFAULT_GENERATED_AT;
    const mode = parsedOptions.mode;
    const graphId = `${feature.id}:${mode}:graph`;
    const planId = `${feature.id}:${mode}:plan`;
    const rootId = `${feature.id}:${mode}:root`;
    const template = templateForMode(mode);
    const granularity = modeToGranularityLevel(mode);
    const contracts = template.leaves.map((leaf) =>
      buildContract(feature, mode, leaf)
    );
    const contractsById = contractsByTaskId(contracts);
    const nodes: Record<string, TaskNode> = {
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
        childrenIds: template.leaves
          .filter((leaf) => leaf.parentId === area.id)
          .map((leaf) => taskId(feature.id, mode, leaf.id))
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
      featureRequest: `${feature.title}\n\n${feature.description}`,
      nodes,
      dependencies: template.dependencies.map((dependency) => ({
        ...dependency,
        fromTaskId: taskId(feature.id, mode, dependency.fromTaskId),
        toTaskId: taskId(feature.id, mode, dependency.toTaskId)
      })),
      rootId,
      createdAt: generatedAt
    }) as TaskGraph;
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
}

export class SingleTaskDecomposer implements Decomposer {
  async decompose(input: FeatureRequest, options: DecompositionOptions = {}): Promise<DecompositionResult> {
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
}

export class MetadataDrivenMockDecomposer implements Decomposer {
  async decompose(input: FeatureRequest, options: DecompositionOptions = {}): Promise<DecompositionResult> {
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
}

export function modeToGranularityLevel(mode: DecompositionMode): TaskGranularityLevel {
  if (mode === "balanced" || mode === "auto") {
    return "medium";
  }

  return mode;
}

export function contractsByTaskId(contracts: readonly AgentTaskContract[]): Record<string, AgentTaskContract> {
  return Object.fromEntries(contracts.map((contract) => [contract.taskId, contract]));
}

function buildDecompositionFromTemplate(input: {
  feature: FeatureRequest;
  parsedOptions: z.infer<typeof DecompositionOptionsSchema>;
  generatedAt: string;
  mode: DecompositionMode;
  decomposerName: string;
  template: ModeTemplate;
}): DecompositionResult {
  const graphId = `${input.feature.id}:${input.mode}:graph`;
  const planId = `${input.feature.id}:${input.mode}:plan`;
  const rootId = `${input.feature.id}:${input.mode}:root`;
  const granularity = modeToGranularityLevel(input.mode);
  const contracts = input.template.leaves.map((leaf) => buildContract(input.feature, input.mode, leaf));
  const contractsById = contractsByTaskId(contracts);
  const nodes: Record<string, TaskNode> = {
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
      childrenIds: input.template.leaves
        .filter((leaf) => leaf.parentId === area.id)
        .map((leaf) => taskId(input.feature.id, input.mode, leaf.id))
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
    featureRequest: `${input.feature.title}\n\n${input.feature.description}`,
    nodes,
    dependencies: input.template.dependencies.map((dependency) => ({
      ...dependency,
      fromTaskId: taskId(input.feature.id, input.mode, dependency.fromTaskId),
      toTaskId: taskId(input.feature.id, input.mode, dependency.toTaskId)
    })),
    rootId,
    createdAt: input.generatedAt
  }) as TaskGraph;
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

function validateDecomposition(graph: TaskGraph, contracts: readonly AgentTaskContract[]): DecompositionValidation {
  const graphIssues = validateTaskGraph(graph).map((issue) => `${issue.code}: ${issue.message}`);
  const leafIds = getLeafNodes(graph).map((node) => node.id).sort();
  const contractIds = contracts.map((contract) => contract.taskId).sort();
  const contractIssues = contracts.flatMap((contract) => {
    const parsed = AgentTaskContractSchema.safeParse(contract);

    if (parsed.success) {
      return [];
    }

    return parsed.error.issues.map((issue) => `${contract.taskId}.${issue.path.join(".")}: ${issue.message}`);
  });
  const missingContractIssues = leafIds
    .filter((leafId) => !contractIds.includes(leafId))
    .map((leafId) => `missing_contract: ${leafId}`);
  const extraContractIssues = contractIds
    .filter((contractId) => !leafIds.includes(contractId))
    .map((contractId) => `extra_contract: ${contractId}`);
  const duplicateContractIssues = uniqueValues(contractIds)
    .filter((contractId) => contractIds.filter((id) => id === contractId).length > 1)
    .map((contractId) => `duplicate_contract: ${contractId}`);
  const issues = [
    ...graphIssues,
    ...contractIssues,
    ...missingContractIssues,
    ...extraContractIssues,
    ...duplicateContractIssues
  ];

  return {
    graphValid: graphIssues.length === 0,
    contractValid:
      contractIssues.length === 0 &&
      missingContractIssues.length === 0 &&
      extraContractIssues.length === 0 &&
      duplicateContractIssues.length === 0,
    issues
  };
}

function buildContract(
  feature: FeatureRequest,
  mode: DecompositionMode,
  leaf: LeafTemplate
): AgentTaskContract {
  const task = taskId(feature.id, mode, leaf.id);
  const producedSymbols = leaf.producedSymbols ?? [];
  const consumedSymbols = leaf.consumedSymbols ?? [];
  const relevantSymbols = uniqueValues([
    ...(leaf.relevantSymbols ?? []),
    ...producedSymbols,
    ...consumedSymbols
  ]);
  const acceptance: AcceptanceCriterion[] = leaf.acceptance.map((description) => ({
    kind: "custom",
    description
  }));
  const validationCommands: ValidationCommand[] = (leaf.validationCommands ?? ["pnpm test"]).map((command) => ({
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
      maxDurationMs: 60_000,
      maxCostUsd: 0
    },
    knownRisks: leaf.risks ?? [],
    definitionOfDone: `The ${leaf.title} task satisfies its acceptance criteria and validation commands.`
  });
}

function taskId(featureId: string, mode: DecompositionMode, localId: string): string {
  return `${featureId}:${mode}:${localId}`;
}

function singleTaskTemplate(feature: FeatureRequest, metadata: FeaturePlanningMetadata): ModeTemplate {
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
        title: "Single Task Mock Implementation",goal: "Plan the entire feature as one broad baseline task without observable internal decomposition.",
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

function metadataDrivenTemplate(
  feature: FeatureRequest,
  metadata: FeaturePlanningMetadata,
  mode: DecompositionMode
): ModeTemplate {
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

function metadataCoarseTemplate(feature: FeatureRequest, metadata: FeaturePlanningMetadata): ModeTemplate {
  const groups = categorizeModules(moduleListForFeature(feature, metadata));
  const domainAndBackend = ensureFiles(
    [...groups.domain, ...groups.backend],
    [`src/${feature.id}/service.ts`]
  );
  const uiFiles = ensureFiles(groups.ui, [`src/components/${feature.id}/panel.tsx`]);
  const testFiles = ensureFiles(groups.tests, [`tests/${feature.id}.test.ts`]);
  const symbols = symbolsForFeature(feature.id, metadata);
  const leaves: LeafTemplate[] = [
    {
      id: "domain-and-backend",
      parentId: "domain",
      title: "Domain And Backend Slice",goal: `Model and implement the backend behavior for ${feature.title}.`,
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
      title: "UI And Test Slice",goal: `Add user-visible behavior and tests for ${feature.title}.`,
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

function metadataBalancedTemplate(feature: FeatureRequest, metadata: FeaturePlanningMetadata): ModeTemplate {
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
        title: "Domain Model",goal: `Define the data and type surface for ${feature.title}.`,
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
        title: "Backend Action",goal: `Implement backend workflow behavior for ${feature.title}.`,
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
        title: "UI Surface",goal: `Expose ${feature.title} through the user-facing surface.`,
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
        title: "Feature Tests",goal: `Cover ${feature.title} with deterministic fixture tests.`,
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

function controlledConflictTemplate(feature: FeatureRequest, metadata: FeaturePlanningMetadata): ModeTemplate {
  const scenario = metadata.controlledScenarios[0] ?? "controlled_conflict";
  const leaves = controlledLeavesForScenario(feature, metadata, scenario);
  const parentIds = new Set(leaves.map((leaf) => leaf.parentId));

  return {
    areas: metadataAreas().filter((area) => parentIds.has(area.id)),
    leaves,
    dependencies: []
  };
}

function controlledLeavesForScenario(
  feature: FeatureRequest,
  metadata: FeaturePlanningMetadata,
  scenario: string
): LeafTemplate[] {
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

function controlledLeaf(
  feature: FeatureRequest,
  input: {
    id: string;
    parentId: string;
    title: string;
    file: string;
    producedSymbols?: string[];
    consumedSymbols?: string[];
    relevantSymbols?: string[];
    validationCommands?: string[];
    acceptance: string[];
    risks: string[];
  }
): LeafTemplate {
  const leaf: LeafTemplate = {
    id: input.id,
    parentId: input.parentId,
    title: input.title,goal: `Exercise a controlled conflict for ${feature.title}.`,
    objective: `Represent the ${input.title} conflict scenario deterministically.`,
    allowedPaths: scopePatternsForFiles([input.file]),
    changedFiles: [input.file],
    acceptance: input.acceptance,
    risks: input.risks
  };

  if (input.producedSymbols !== undefined) {
    leaf.producedSymbols = input.producedSymbols;
  }

  if (input.consumedSymbols !== undefined) {
    leaf.consumedSymbols = input.consumedSymbols;
  }

  if (input.relevantSymbols !== undefined) {
    leaf.relevantSymbols = input.relevantSymbols;
  }

  if (input.validationCommands !== undefined) {
    leaf.validationCommands = input.validationCommands;
  }

  return leaf;
}

function metadataFineTemplate(feature: FeatureRequest, metadata: FeaturePlanningMetadata): ModeTemplate {
  const files = moduleListForFeature(feature, metadata);
  const symbols = symbolsForFeature(feature.id, metadata);
  const leaves = files.map((file, index) => {
    const localId = localIdFromFile(file, index);
    const parentId = parentIdForFile(file);
    const producedSymbol = symbols[index] ?? `${pascalCase(feature.id)}Part${index + 1}`;
    const leaf: LeafTemplate = {
      id: localId,
      parentId,
      title: titleFromFile(file),goal: `Plan the ${file} slice for ${feature.title}.`,
      objective: `Create the deterministic fine-grained mock task for ${file}.`,
      allowedPaths: scopePatternsForFiles([file]),
      changedFiles: [file],
      producedSymbols: isTestFile(file) ? [] : [producedSymbol],
      consumedSymbols: index === 0 ? [] : [symbols[0] ?? `${pascalCase(feature.id)}Record`],
      relevantSymbols: uniqueValues([producedSymbol, symbols[0] ?? `${pascalCase(feature.id)}Record`]),
      acceptance: acceptanceSlice(feature, index, index + 1),
      risks: metadata.expectedRiskAreas
    };

    if (isTestFile(file)) {
      leaf.validationCommands = validationCommandsForFeature(feature);
    }

    return leaf;
  });
  const dependencyInputs: TaskDependency[] = [];
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

function metadataAreas(): AreaTemplate[] {
  return [
    {
      id: "domain",
      title: "Domain And Data",goal: "Model data, types and shared domain contracts."
    },
    {
      id: "backend",
      title: "Backend Workflow",goal: "Implement deterministic backend actions or services."
    },
    {
      id: "ui",
      title: "User Surface",goal: "Represent UI, public pages and feedback surfaces."
    },
    {
      id: "quality",
      title: "Tests And Quality",goal: "Represent focused test coverage and quality checks."
    }
  ];
}

function moduleListForFeature(feature: FeatureRequest, metadata: FeaturePlanningMetadata): string[] {
  return metadata.expectedModules.length > 0
    ? uniqueValues(metadata.expectedModules)
    : [
        `src/${feature.id}/model.ts`,
        `src/${feature.id}/service.ts`,
        `src/components/${feature.id}/panel.tsx`,
        `tests/${feature.id}.test.ts`
      ];
}

function categorizeModules(files: readonly string[]): {
  domain: string[];
  backend: string[];
  ui: string[];
  tests: string[];
} {
  return {
    domain: files.filter((file) => isDomainFile(file)),
    backend: files.filter((file) => !isDomainFile(file) && !isUiFile(file) && !isTestFile(file)),
    ui: files.filter((file) => isUiFile(file)),
    tests: files.filter((file) => isTestFile(file))
  };
}

function scopePatternsForFiles(files: readonly string[]): string[] {
  return uniqueValues([
    ...files,
    ...files.map((file) => `${dirname(file)}/**`)
  ]);
}

function ensureFiles(files: readonly string[], fallback: readonly string[]): string[] {
  return files.length > 0 ? uniqueValues(files) : [...fallback];
}

function acceptanceSlice(feature: FeatureRequest, from: number, to: number): string[] {
  const slice = feature.acceptanceCriteria.slice(from, to);
  return slice.length > 0 ? slice : [feature.acceptanceCriteria[0] ?? "The fixture acceptance criteria are represented."];
}

function validationCommandsForFeature(feature: FeatureRequest): string[] {
  return [`pnpm test -- ${feature.id}`];
}

function symbolsForFeature(featureId: string, metadata: FeaturePlanningMetadata): string[] {
  const base = pascalCase(featureId);
  const derived = metadata.expectedModules
    .map((file) => titleFromFile(file).replace(/[^A-Za-z0-9]/gu, ""))
    .filter((value) => value.length > 0)
    .map((value) => `${base}${value}`);

  return uniqueValues([
    `${base}Record`,
    `${base}Service`,
    `${base}Surface`,
    `${base}TestCoverage`,
    ...derived
  ]);
}

function localIdFromFile(file: string, index: number): string {
  const base = file
    .replace(/\.[^.]+$/u, "")
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("-")
    .replace(/[^A-Za-z0-9-]/gu, "-")
    .replace(/--+/gu, "-")
    .toLowerCase();

  return `${String(index + 1).padStart(2, "0")}-${base || "task"}`;
}

function titleFromFile(file: string): string {
  const filename = file.split("/").pop() ?? file;
  const withoutExtension = filename.replace(/\.[^.]+$/u, "");
  return withoutExtension
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parentIdForFile(file: string): string {
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

function isDomainFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return (
    normalized.includes("/schema") ||
    normalized.includes("/model") ||
    normalized.includes("/types") ||
    normalized.includes("/db/") ||
    normalized.endsWith("schema.ts") ||
    normalized.endsWith("record.ts")
  );
}

function isUiFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return normalized.includes("/components/") || normalized.includes("/app/") || normalized.includes("/public/");
}

function isTestFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return normalized.includes("/tests/") || normalized.includes(".test.") || normalized.includes(".spec.");
}

function dirname(file: string): string {
  const parts = file.split("/");
  parts.pop();
  return parts.length > 0 ? parts.join("/") : ".";
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function templateForMode(mode: DecompositionMode): ModeTemplate {
  if (mode === "coarse") {
    return coarseTemplate();
  }

  if (mode === "fine") {
    return fineTemplate();
  }

  return balancedTemplate();
}

function commonAreas(): AreaTemplate[] {
  return [
    {
      id: "ui",
      title: "User Experience",goal: "Design the user-facing request and callback feedback surfaces."
    },
    {
      id: "backend",
      title: "Auth Backend",goal: "Model, generate, persist and validate magic link tokens."
    },
    {
      id: "quality",
      title: "Quality And Documentation",goal: "Protect the flow with focused tests and implementation notes."
    }
  ];
}

function coarseTemplate(): ModeTemplate {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "auth-backend",
        parentId: "backend",
        title: "Auth Backend Slice",goal: "Implement the backend primitives for issuing and validating passwordless login tokens.",
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
        title: "Login UI Slice",goal: "Implement the request form and callback feedback for passwordless login.",
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
        title: "Auth Flow Tests",goal: "Cover the passwordless login flow with focused tests.",
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

function balancedTemplate(): ModeTemplate {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "token-model",
        parentId: "backend",
        title: "Token Model",goal: "Define the token shape, expiry semantics and one-use state.",
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
        title: "Request Action",goal: "Handle a login request and create a magic link token.",
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
        title: "Email Link Builder",goal: "Build the callback URL and email payload for the token.",
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
        title: "Callback Validation",goal: "Validate a callback token and reject invalid states.",
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
        title: "Session Bridge",goal: "Create an authenticated session after successful token validation.",
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
        title: "Login UI",goal: "Expose the magic link request flow to the user.",
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
        title: "Auth Tests",goal: "Add tests for the planned passwordless login behavior.",
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

function fineTemplate(): ModeTemplate {
  return {
    areas: commonAreas(),
    leaves: [
      {
        id: "token-schema",
        parentId: "backend",
        title: "Token Schema",goal: "Define the magic link token data contract.",
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
        title: "Token Generator",goal: "Generate opaque one-use token values.",
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
        title: "Token Persistence",goal: "Persist and consume magic link tokens.",
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
        title: "Request Action",goal: "Accept a user email and issue a magic link token.",
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
        title: "Email Link",goal: "Build the callback link from the issued token.",
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
        title: "Callback Route",goal: "Handle a magic link callback request.",
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
        title: "Session Bridge",goal: "Create a session after callback success.",
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
        title: "Request Form",goal: "Let the user request a login link.",
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
        title: "Feedback States",goal: "Show success and error outcomes.",
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
        title: "Fine Auth Tests",goal: "Test the fine-grained passwordless flow.",
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

function dependency(
  fromTaskId: string,
  toTaskId: string,
  type: TaskDependency["type"],
  rationale: string
): TaskDependency {
  return {
    fromTaskId,
    toTaskId,
    type,
    inferred: false,
    rationale
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LLM-driven decomposer (Fase C). The real client lives in `llm/*`; we
// re-export the public surface here so consumers can `import { AnthropicDecomposer }`
// from `@manyhands/decomposer` without reaching into the subpath.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export {
  AnthropicDecomposer
} from "./llm/anthropic-decomposer";
export type {
  AnthropicDecomposerOptions,
  AnthropicDecomposerResult,
  AnthropicLike
} from "./llm/anthropic-decomposer";
export {
  DECOMPOSER_PROMPT_TEMPLATE_VERSION,
  GRANULARITY_PROFILES,
  buildDecomposerPrompt
} from "./llm/prompt-template";
export type { PromptInputs, WorkspaceHints } from "./llm/prompt-template";
export {
  DecomposerLlmNodeSchema,
  DecomposerLlmDependencySchema,
  DecomposerLlmOutputSchema
} from "./llm/output-schema";
export type {
  DecomposerLlmNode,
  DecomposerLlmDependency,
  DecomposerLlmOutput
} from "./llm/output-schema";
export { runDecomposerGuards } from "./llm/guards";
export { normalizeLlmDecomposition } from "./llm/normalize";
export {
  DecomposerLlmError,
  isDecomposerLlmError,
  DecomposerQuestionError,
  isDecomposerQuestionError,
  classifyGraphGenerationError,
  isRecoverableGraphGenerationKind
} from "./llm/errors";
export type {
  DecomposerLlmStage,
  GraphGenerationErrorContext,
  GraphGenerationErrorDetails,
  GraphGenerationErrorKind
} from "./llm/errors";
export { executionScopeFromAllowed } from "./scope";

// ── Recursive interface-aware decomposer ──────
export { RecursiveDecomposer } from "./llm/recursive/recursive-decomposer";
export type {
  RecursiveDecomposerOptions,
  RecursiveStepChildEvent,
  RecursiveStepCompletedEvent,
  RecursiveStepPlanningState,
  RecursiveStepListener,
  RecursiveStepStartedEvent,
  RecursiveStepStatusEvent
} from "./llm/recursive/recursive-decomposer";
export { ClaudeCodeRecursiveDecomposer } from "./llm/recursive/claude-code-recursive-decomposer";
export type { ClaudeCodeRecursiveDecomposerOptions } from "./llm/recursive/claude-code-recursive-decomposer";
export { CodexRecursiveDecomposer } from "./llm/recursive/codex-recursive-decomposer";
export type { CodexRecursiveDecomposerOptions } from "./llm/recursive/codex-recursive-decomposer";
export {
  RECURSIVE_DECOMPOSER_PROMPT_VERSION,
  buildStepPrompt
} from "./llm/recursive/step-prompt";
export type { Aggressiveness, StepPromptInputs } from "./llm/recursive/step-prompt";
export {
  DecomposeStepOutputSchema,
  StepInterfaceSchema
} from "./llm/recursive/step-schema";
export type {
  DecomposeStepOutput,
  StepInterface,
  AtomicStep,
  DecomposeStep
} from "./llm/recursive/step-schema";

export * from "./mocks/mock-decomposer";
