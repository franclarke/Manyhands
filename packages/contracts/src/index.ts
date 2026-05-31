import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const AllowedScopeSchema = z.object({
  paths: z.array(NonEmptyStringSchema).min(1),
  maxFilesTouched: z.number().int().positive().optional()
});

export type AllowedScope = z.infer<typeof AllowedScopeSchema>;

export const ForbiddenScopeSchema = z.object({
  paths: z.array(NonEmptyStringSchema).default([]),
  reasons: z.record(NonEmptyStringSchema).optional()
});

export type ForbiddenScope = z.infer<typeof ForbiddenScopeSchema>;

export const ContextSnippetSchema = z.object({
  path: NonEmptyStringSchema,
  content: z.string()
});

export type ContextSnippet = z.infer<typeof ContextSnippetSchema>;

export const ContextPackSchema = z.object({
  typeSignatures: z.array(z.string()).default([]),
  referenceSnippets: z.array(ContextSnippetSchema).default([]),
  conventions: z.array(NonEmptyStringSchema).default([]),
  upstreamArtifacts: z.array(NonEmptyStringSchema).default([])
});

export type ContextPack = z.infer<typeof ContextPackSchema>;

export const AcceptanceCriterionKindSchema = z.union([
  z.literal("test"),
  z.literal("typecheck"),
  z.literal("exports_symbol"),
  z.literal("command"),
  z.literal("custom")
]);

export type AcceptanceCriterionKind = z.infer<typeof AcceptanceCriterionKindSchema>;

export const AcceptanceCriterionSchema = z.object({
  kind: AcceptanceCriterionKindSchema,
  description: NonEmptyStringSchema,
  command: NonEmptyStringSchema.optional(),
  expectedSymbol: NonEmptyStringSchema.optional()
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ValidationCommandKindSchema = z.union([
  z.literal("typecheck"),
  z.literal("lint"),
  z.literal("unit"),
  z.literal("integration"),
  z.literal("build"),
  z.literal("custom")
]);

export type ValidationCommandKind = z.infer<typeof ValidationCommandKindSchema>;

export const ValidationCommandSchema = z.object({
  kind: ValidationCommandKindSchema,
  command: NonEmptyStringSchema,
  timeoutMs: z.number().int().positive().optional(),
  blocking: z.boolean().default(true)
});

export type ValidationCommand = z.infer<typeof ValidationCommandSchema>;

export const ExpectedOutputSchema = z.object({
  changedFiles: z.array(NonEmptyStringSchema).default([]),
  producedSymbols: z.array(NonEmptyStringSchema).default([]),
  consumedSymbols: z.array(NonEmptyStringSchema).default([]),
  diffShapeHint: NonEmptyStringSchema.optional()
});

export type ExpectedOutput = z.infer<typeof ExpectedOutputSchema>;

// ── V2: Execution Core schemas ──────────────────────────────────

export const ExecutionValidationCommandSchema = z.object({
  command: NonEmptyStringSchema,
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(60_000),
  cwd: z.union([z.literal("worktree"), z.literal("repo-root")]).default("worktree")
});

export type ExecutionValidationCommand = z.infer<typeof ExecutionValidationCommandSchema>;

export const ExecutionScopeSchema = z.object({
  implementationPaths: z.array(NonEmptyStringSchema).default([]),
  testPaths: z.array(NonEmptyStringSchema).default([]),
  configPaths: z.array(NonEmptyStringSchema).default([])
});

export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;

// ── Interface contracts (shared seams between sibling tasks) ─────
//
// The "seam" a recursive-decomposition step defines between the children of a
// composite. Making seams explicit is what lets parallel leaves be built in
// isolation and still compose: each leaf receives the exact signatures it
// consumes (produced by siblings/ancestors) and must expose the ones it
// produces. See docs/design/decomposer-composer-redesign.md.

export const InterfaceContractKindSchema = z.union([
  z.literal("type"),
  z.literal("function"),
  z.literal("module")
]);

export type InterfaceContractKind = z.infer<typeof InterfaceContractKindSchema>;

export const InterfaceContractSchema = z.object({
  /** Stable identifier referenced by children's consumes/produces (e.g. "TaskStore"). */
  id: NonEmptyStringSchema,
  kind: InterfaceContractKindSchema,
  /** The real TS signature/definition, not just the name. */
  signature: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  /** Which decomposition node defined this seam (traceability). */
  definedAtNodeId: NonEmptyStringSchema.optional()
});

export type InterfaceContract = z.infer<typeof InterfaceContractSchema>;

// ── Agent task contract ─────────────────────────────────────────

export const AgentTaskContractSchema = z.object({
  taskId: EntityIdSchema,
  objective: NonEmptyStringSchema,
  context: ContextPackSchema,
  allowed: AllowedScopeSchema,
  forbidden: ForbiddenScopeSchema,
  relevantSymbols: z.array(NonEmptyStringSchema).default([]),
  dependencies: z.array(EntityIdSchema).default([]),
  acceptance: z.array(AcceptanceCriterionSchema).min(1),
  validationCommands: z.array(ValidationCommandSchema).default([]),
  expectedOutput: ExpectedOutputSchema,
  limits: z.object({
    maxDurationMs: z.number().int().positive(),
    maxCostUsd: z.number().nonnegative()
  }),
  knownRisks: z.array(NonEmptyStringSchema).default([]),
  definitionOfDone: NonEmptyStringSchema,

  // V2 — Execution Core fields (optional, backward-compatible)
  executionScope: ExecutionScopeSchema.optional(),
  forbiddenPaths: z.array(NonEmptyStringSchema).optional(),
  leafValidationCommands: z.array(ExecutionValidationCommandSchema).optional(),
  parentValidationCommands: z.array(ExecutionValidationCommandSchema).optional(),
  runValidationCommands: z.array(ExecutionValidationCommandSchema).optional(),

  // V2 — Interface seams (recursive-decomposition design, optional)
  /** Seams this leaf must build against (produced by siblings/ancestors). */
  consumedInterfaces: z.array(InterfaceContractSchema).optional(),
  /** Seams this leaf must expose for siblings/descendants to consume. */
  producedInterfaces: z.array(InterfaceContractSchema).optional()
});

export type AgentTaskContract = z.infer<typeof AgentTaskContractSchema>;

export const ValidationCheckKindSchema = z.union([
  z.literal("typecheck"),
  z.literal("lint"),
  z.literal("unit"),
  z.literal("integration"),
  z.literal("build"),
  z.literal("scope"),
  z.literal("acceptance")
]);

export type ValidationCheckKind = z.infer<typeof ValidationCheckKindSchema>;

export const ValidationCheckSchema = z.object({
  kind: ValidationCheckKindSchema,
  passed: z.boolean(),
  command: NonEmptyStringSchema.optional(),
  summary: NonEmptyStringSchema,
  durationMs: z.number().int().nonnegative()
});

export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

export const ValidationResultSchema = z.object({
  taskId: EntityIdSchema.optional(),
  checks: z.array(ValidationCheckSchema),
  passed: z.boolean()
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const AgentRunResultSchema = z.object({
  taskId: EntityIdSchema,
  worktree: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  success: z.boolean(),
  diff: z.string(),
  changedFiles: z.array(NonEmptyStringSchema),
  validation: ValidationResultSchema,
  scopeViolations: z.array(NonEmptyStringSchema),
  stdout: z.string(),
  stderr: z.string(),
  reportedSymbols: z.array(NonEmptyStringSchema).default([]),
  metrics: z.object({
    durationMs: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative()
  }),
  metadata: z.record(z.unknown()).default({}),
  commitHash: NonEmptyStringSchema.optional(),
  completedAt: IsoTimestampSchema.optional()
});

export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

export type ContractValidationResult =
  | { ok: true; contract: AgentTaskContract }
  | { ok: false; issues: string[] };

export function validateAgentTaskContract(input: unknown): ContractValidationResult {
  const parsed = AgentTaskContractSchema.safeParse(input);

  if (parsed.success) {
    return { ok: true, contract: parsed.data };
  }

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  };
}
