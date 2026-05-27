import type { AgentTaskContract } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema, uniqueValues } from "@manyhands/shared";
import { z } from "zod";

export const ScopeSeveritySchema = z.union([
  z.literal("warning"),
  z.literal("error"),
  z.literal("blocking")
]);

export type ScopeSeverity = z.infer<typeof ScopeSeveritySchema>;

export const ScopeViolationTypeSchema = z.union([
  z.literal("forbidden_path_touched"),
  z.literal("outside_allowed_scope"),
  z.literal("missing_expected_file"),
  z.literal("missing_expected_symbol"),
  z.literal("undeclared_critical_path"),
  z.literal("missing_required_validation")
]);

export type ScopeViolationType = z.infer<typeof ScopeViolationTypeSchema>;

export const ScopeWarningTypeSchema = z.literal("max_files_touched_exceeded");

export type ScopeWarningType = z.infer<typeof ScopeWarningTypeSchema>;

export const ScopeViolationSchema = z.object({
  type: ScopeViolationTypeSchema,
  taskId: EntityIdSchema,
  path: NonEmptyStringSchema.optional(),
  symbol: NonEmptyStringSchema.optional(),
  command: NonEmptyStringSchema.optional(),
  message: NonEmptyStringSchema,
  severity: ScopeSeveritySchema
});

export type ScopeViolation = z.infer<typeof ScopeViolationSchema>;

export const ScopeWarningSchema = z.object({
  type: ScopeWarningTypeSchema,
  taskId: EntityIdSchema,
  message: NonEmptyStringSchema,
  severity: z.literal("warning")
});

export type ScopeWarning = z.infer<typeof ScopeWarningSchema>;

export interface ScopeValidationInput {
  contract: AgentTaskContract;
  changedFiles: string[];
  reportedSymbols?: string[];
  executedValidationCommands?: string[];
}

export const ScopeValidationResultSchema = z.object({
  valid: z.boolean(),
  violations: z.array(ScopeViolationSchema),
  warnings: z.array(ScopeWarningSchema)
});

export type ScopeValidationResult = z.infer<typeof ScopeValidationResultSchema>;

export function validateScope(input: ScopeValidationInput): ScopeValidationResult {
  const changedFiles = uniqueValues(input.changedFiles.map(normalizePath));
  const reportedSymbols = new Set(input.reportedSymbols ?? []);
  const executedValidationCommands = new Set(input.executedValidationCommands ?? []);
  const violations: ScopeViolation[] = [];
  const warnings: ScopeWarning[] = [];
  const taskId = input.contract.taskId;

  for (const changedFile of changedFiles) {
    if (matchesAnyPath(changedFile, input.contract.forbidden.paths)) {
      violations.push({
        type: "forbidden_path_touched",
        taskId,
        path: changedFile,
        message: `${changedFile} is forbidden by the task contract`,
        severity: "blocking"
      });
    }

    if (!matchesAnyPath(changedFile, input.contract.allowed.paths)) {
      violations.push({
        type: "outside_allowed_scope",
        taskId,
        path: changedFile,
        message: `${changedFile} is outside the allowed task scope`,
        severity: "error"
      });
    }

    if (isCriticalPath(changedFile) && !input.contract.expectedOutput.changedFiles.map(normalizePath).includes(changedFile)) {
      violations.push({
        type: "undeclared_critical_path",
        taskId,
        path: changedFile,
        message: `${changedFile} is a critical path but was not declared as expected output`,
        severity: "blocking"
      });
    }
  }

  for (const expectedFile of input.contract.expectedOutput.changedFiles.map(normalizePath)) {
    if (!changedFiles.includes(expectedFile)) {
      violations.push({
        type: "missing_expected_file",
        taskId,
        path: expectedFile,
        message: `${expectedFile} was expected but not reported as changed`,
        severity: "error"
      });
    }
  }

  for (const expectedSymbol of input.contract.expectedOutput.producedSymbols) {
    if (!reportedSymbols.has(expectedSymbol)) {
      violations.push({
        type: "missing_expected_symbol",
        taskId,
        symbol: expectedSymbol,
        message: `${expectedSymbol} was expected but not reported`,
        severity: "error"
      });
    }
  }

  for (const validationCommand of input.contract.validationCommands.filter((command) => command.blocking)) {
    if (!executedValidationCommands.has(validationCommand.command)) {
      violations.push({
        type: "missing_required_validation",
        taskId,
        command: validationCommand.command,
        message: `${validationCommand.command} is required but was not reported as executed`,
        severity: "error"
      });
    }
  }

  if (
    input.contract.allowed.maxFilesTouched !== undefined &&
    changedFiles.length > input.contract.allowed.maxFilesTouched
  ) {
    warnings.push({
      type: "max_files_touched_exceeded",
      taskId,
      message: `${changedFiles.length} files were touched, above maxFilesTouched=${input.contract.allowed.maxFilesTouched}`,
      severity: "warning"
    });
  }

  return {
    valid: violations.length === 0,
    violations,
    warnings
  };
}

export function matchesPath(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  const regex = globToRegex(normalizedPattern);
  return regex.test(normalizedPath);
}

export function matchesAnyPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPath(path, pattern));
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isCriticalPath(path: string): boolean {
  const normalized = normalizePath(path);

  return (
    normalized === "package.json" ||
    normalized === "pnpm-workspace.yaml" ||
    normalized.includes("tsconfig") ||
    normalized.includes("eslint") ||
    normalized.endsWith("schema.prisma") ||
    normalized.includes("migrations/") ||
    normalized.includes(".config.") ||
    normalized.includes("/types/") ||
    normalized.startsWith("packages/shared/")
  );
}

function globToRegex(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegexChar(char ?? "");
    }
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegexChar(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
}
