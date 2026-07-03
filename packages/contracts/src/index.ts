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

// Validation commands are LLM-authored, but the contract is structured argv:
// `command` is a binary name and `args` are passed as arguments, not interpolated
// into a shell command string. Kept out of the zod schema itself so
// already-persisted RunRecords keep parsing.
const SAFE_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHELL_ENTRYPOINTS = new Set(["bash", "sh", "zsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const NUL_PATTERN = /\u0000/;
const SHELL_OPERATOR_TOKEN_PATTERN = /^(?:&&|\|\||[|&;<>]|\d?>&\d?|2>&1)$/;
const SHELL_FRAGMENT_PATTERN = /(?:^|\s)(?:&&|\|\||[|<>])(?:\s|$)|^\s*;/;
const SHELLED_UNSAFE_ARG_PATTERN = /[&|<>^`$;"'%!\r\n]/;

export interface ValidationCommandSafetyOptions {
  /**
   * True only when the runner will hand args to a shell. Structured validation
   * commands should normally use shell=false; shell=true is a compatibility path
   * and therefore rejects a stricter character set.
   */
  shell?: boolean;
}

/**
 * Returns the reasons a validation command is unsafe to execute (empty array
 * means safe).
 *
 * Policy:
 * - command: bare binary name only, no paths or shell entrypoints;
 * - args under structured argv: arbitrary strings are allowed, including
 *   quotes, backticks, regex pipes, and JavaScript for `node -e`;
 * - args that are standalone shell operators or obvious shell fragments are
 *   rejected because they indicate the plan authored a shell command instead of
 *   argv;
 * - args under shell compatibility mode are restricted to a conservative
 *   charset because shell parsing becomes part of execution.
 */
export function validationCommandSafetyIssues(
  command: string,
  args: readonly string[],
  options: ValidationCommandSafetyOptions = {}
): string[] {
  const issues: string[] = [];
  if (!SAFE_COMMAND_PATTERN.test(command)) {
    issues.push(
      `command "${command}" must be a bare binary name (letters, digits, ".", "_", "-"; no paths or shell metacharacters)`
    );
  }
  if (SHELL_ENTRYPOINTS.has(command.toLowerCase())) {
    issues.push(`command "${command}" is a shell entrypoint; use a structured command and args instead`);
  }
  for (const [index, arg] of args.entries()) {
    if (NUL_PATTERN.test(arg)) {
      issues.push(`arg ${index} contains a NUL byte`);
      continue;
    }
    if (!isNodeEvalArg(command, args, index) && looksLikeShellFragment(arg)) {
      issues.push(`arg "${arg}" looks like a shell operator or shell command fragment`);
      continue;
    }
    if (options.shell === true && SHELLED_UNSAFE_ARG_PATTERN.test(arg)) {
      issues.push(`arg "${arg}" cannot be safely passed through a shell`);
    }
  }
  return issues;
}

function isNodeEvalArg(command: string, args: readonly string[], index: number): boolean {
  return command.toLowerCase() === "node" && (args[index - 1] === "-e" || args[index - 1] === "--eval");
}

function looksLikeShellFragment(arg: string): boolean {
  const trimmed = arg.trim();
  return SHELL_OPERATOR_TOKEN_PATTERN.test(trimmed) || SHELL_FRAGMENT_PATTERN.test(arg);
}

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

export type ContractBoundaryIssueSeverity = "error" | "warning" | "info";

export type ContractBoundaryIssueCode =
  | "schema_invalid"
  | "task_id_mismatch"
  | "unsafe_path"
  | "missing_execution_scope"
  | "missing_expected_changed_files"
  | "invalid_interface_id"
  | "duplicate_interface_id";

export interface ContractBoundaryIssue {
  code: ContractBoundaryIssueCode;
  severity: ContractBoundaryIssueSeverity;
  field: string;
  message: string;
  taskId?: string;
}

export interface ContractBoundaryValidationOptions {
  /** Node id this contract is attached to. Used to catch persisted mismatch. */
  taskId?: string;
  /** Executable leaves need enough information for scheduling/execution. */
  executable?: boolean;
}

export type ContractBoundaryValidationResult =
  | { ok: true; contract: AgentTaskContract; issues: ContractBoundaryIssue[] }
  | { ok: false; issues: ContractBoundaryIssue[] };

export function validateAgentTaskContractBoundary(
  input: unknown,
  options: ContractBoundaryValidationOptions = {}
): ContractBoundaryValidationResult {
  const parsed = AgentTaskContractSchema.safeParse(input);
  const issues: ContractBoundaryIssue[] = [];

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        severity: "error",
        field: issue.path.join("."),
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    };
  }

  const contract = parsed.data;
  if (options.taskId !== undefined && contract.taskId !== options.taskId) {
    issues.push({
      code: "task_id_mismatch",
      severity: "error",
      field: "taskId",
      taskId: options.taskId,
      message: `contract taskId "${contract.taskId}" does not match node id "${options.taskId}"`
    });
  }

  validatePathList(issues, contract.taskId, "allowed.paths", contract.allowed.paths);
  validatePathList(issues, contract.taskId, "forbidden.paths", contract.forbidden.paths);
  validatePathList(issues, contract.taskId, "forbidden.reasons", Object.keys(contract.forbidden.reasons ?? {}));
  validatePathList(issues, contract.taskId, "forbiddenPaths", contract.forbiddenPaths ?? []);
  validatePathList(issues, contract.taskId, "expectedOutput.changedFiles", contract.expectedOutput.changedFiles);
  validatePathList(issues, contract.taskId, "executionScope.implementationPaths", contract.executionScope?.implementationPaths ?? []);
  validatePathList(issues, contract.taskId, "executionScope.testPaths", contract.executionScope?.testPaths ?? []);
  validatePathList(issues, contract.taskId, "executionScope.configPaths", contract.executionScope?.configPaths ?? []);

  if (options.executable === true) {
    const executionScopePaths = [
      ...(contract.executionScope?.implementationPaths ?? []),
      ...(contract.executionScope?.testPaths ?? [])
    ];
    if (executionScopePaths.length === 0) {
      issues.push({
        code: "missing_execution_scope",
        severity: "warning",
        field: "executionScope",
        taskId: contract.taskId,
        message:
          `task ${contract.taskId} has no implementation/test executionScope; ` +
          "allowed.paths will be used as an explicit conservative fallback"
      });
    }
    if (contract.expectedOutput.changedFiles.length === 0) {
      issues.push({
        code: "missing_expected_changed_files",
        severity: "warning",
        field: "expectedOutput.changedFiles",
        taskId: contract.taskId,
        message: `task ${contract.taskId} does not declare expected changed files`
      });
    }
  }

  validateInterfaces(issues, contract.taskId, "consumedInterfaces", contract.consumedInterfaces ?? []);
  validateInterfaces(issues, contract.taskId, "producedInterfaces", contract.producedInterfaces ?? []);

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    contract,
    issues
  };
}

function validatePathList(
  issues: ContractBoundaryIssue[],
  taskId: string,
  field: string,
  paths: readonly string[]
): void {
  for (const path of paths) {
    const reason = unsafeRepoRelativePathReason(path);
    if (reason !== undefined) {
      issues.push({
        code: "unsafe_path",
        severity: "error",
        field,
        taskId,
        message: `${field} contains unsafe repo path "${path}": ${reason}`
      });
    }
  }
}

function unsafeRepoRelativePathReason(value: string): string | undefined {
  const path = value.trim();
  if (path.length === 0) return "path is empty";
  if (/[\u0000-\u001F]/u.test(path)) return "path contains control characters";
  if (path.startsWith("/") || path.startsWith("\\")) return "path is absolute";
  if (/^[A-Za-z]:/.test(path)) return "path uses a Windows drive prefix";
  if (path.startsWith("~")) return "path targets a home directory";

  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === "..")) return "path traversal is not allowed";
  return undefined;
}

const INTERFACE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function validateInterfaces(
  issues: ContractBoundaryIssue[],
  taskId: string,
  field: "consumedInterfaces" | "producedInterfaces",
  interfaces: readonly InterfaceContract[]
): void {
  const seen = new Set<string>();
  for (const item of interfaces) {
    if (!INTERFACE_ID_PATTERN.test(item.id)) {
      issues.push({
        code: "invalid_interface_id",
        severity: "error",
        field: `${field}.id`,
        taskId,
        message: `${field} contains invalid interface id "${item.id}"; use stable identifier characters only`
      });
    }
    if (seen.has(item.id)) {
      issues.push({
        code: "duplicate_interface_id",
        severity: "error",
        field,
        taskId,
        message: `${field} repeats interface id "${item.id}"`
      });
    }
    seen.add(item.id);
  }
}
