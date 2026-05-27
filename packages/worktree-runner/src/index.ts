import {
  type AgentRunResult,
  type AgentTaskContract,
  type ValidationCheck
} from "@manyhands/contracts";
import {
  validateScope,
  type ScopeValidationResult
} from "@manyhands/scope-validation";
import { nowIso } from "@manyhands/shared";

export interface WorktreeSession {
  taskId: string;
  branch: string;
  path: string;
  baseCommit: string;
  createdAt: string;
  cleanedUp: boolean;
}

export interface AgentInvocation {
  contract: AgentTaskContract;
  worktree: WorktreeSession;
  model: string;
  promptPreview: string;
}

export interface AgentRunner {
  run(invocation: AgentInvocation): Promise<AgentRunResult>;
}

export interface MockAgentRunOverride {
  changedFiles?: string[];
  reportedSymbols?: string[];
  executedValidationCommands?: string[];
  stdout?: string;
  stderr?: string;
  fail?: boolean;
}

export interface MockWorktreeRunnerOptions {
  basePath?: string;
  branchPrefix?: string;
  generatedAt?: string;
  durationMs?: number;
  overrides?: Record<string, MockAgentRunOverride>;
}

export class StubAgentRunner implements AgentRunner {
  async run(invocation: AgentInvocation): Promise<AgentRunResult> {
    return {
      taskId: invocation.contract.taskId,
      worktree: invocation.worktree.path,
      branch: invocation.worktree.branch,
      success: true,
      diff: "",
      changedFiles: [],
      validation: {
        taskId: invocation.contract.taskId,
        checks: [],
        passed: true
      },
      scopeViolations: [],
      stdout: "stub agent runner did not execute an external process",
      stderr: "",
      reportedSymbols: [],
      metrics: {
        durationMs: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0
      },
      metadata: {
        runner: "stub-agent-runner"
      },
      completedAt: nowIso()
    };
  }
}

export class MockWorktreeRunner implements AgentRunner {
  private readonly options: Required<Omit<MockWorktreeRunnerOptions, "overrides">> & {
    overrides: Record<string, MockAgentRunOverride>;
  };

  constructor(options: MockWorktreeRunnerOptions = {}) {
    this.options = {
      basePath: options.basePath ?? ".manyhands/mock",
      branchPrefix: options.branchPrefix ?? "mock/mh",
      generatedAt: options.generatedAt ?? "1970-01-01T00:00:00.000Z",
      durationMs: options.durationMs ?? 25,
      overrides: options.overrides ?? {}
    };
  }

  async run(invocation: AgentInvocation): Promise<AgentRunResult> {
    const override = this.options.overrides[invocation.contract.taskId] ?? {};
    const changedFiles = override.changedFiles ?? invocation.contract.expectedOutput.changedFiles;
    const reportedSymbols = override.reportedSymbols ?? invocation.contract.expectedOutput.producedSymbols;
    const executedValidationCommands =
      override.executedValidationCommands ??
      invocation.contract.validationCommands.map((command) => command.command);
    const scopeValidation = validateScope({
      contract: invocation.contract,
      changedFiles,
      reportedSymbols,
      executedValidationCommands
    });
    const validationChecks = buildMockValidationChecks(invocation.contract, executedValidationCommands, scopeValidation);
    const success = override.fail === true ? false : scopeValidation.valid && validationChecks.every((check) => check.passed);

    return {
      taskId: invocation.contract.taskId,
      worktree: invocation.worktree.path,
      branch: invocation.worktree.branch,
      success,
      diff: buildMockDiff(invocation.contract, changedFiles),
      changedFiles,
      validation: {
        taskId: invocation.contract.taskId,
        checks: validationChecks,
        passed: validationChecks.every((check) => check.passed)
      },
      scopeViolations: scopeValidation.violations.map((violation) => violation.message),
      stdout: override.stdout ?? `Mock runner simulated ${invocation.contract.taskId}`,
      stderr: override.stderr ?? "",
      reportedSymbols,
      metrics: {
        durationMs: this.options.durationMs,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0
      },
      metadata: {
        runner: "mock-worktree-runner",
        deterministic: true,
        scopeValid: scopeValidation.valid,
        scopeWarnings: scopeValidation.warnings.length,
        executedValidationCommands
      },
      completedAt: this.options.generatedAt
    };
  }

  createSession(taskId: string, baseCommit = "mock-base-commit"): WorktreeSession {
    return createMockWorktreeSession(taskId, {
      basePath: this.options.basePath,
      branchPrefix: this.options.branchPrefix,
      baseCommit,
      createdAt: this.options.generatedAt
    });
  }
}

export interface CreateMockWorktreeSessionOptions {
  basePath?: string;
  branchPrefix?: string;
  baseCommit?: string;
  createdAt?: string;
}

export function createMockWorktreeSession(
  taskId: string,
  options: CreateMockWorktreeSessionOptions = {}
): WorktreeSession {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9._:-]/gu, "-");

  return {
    taskId,
    branch: `${options.branchPrefix ?? "mock/mh"}/${safeTaskId}`,
    path: `${options.basePath ?? ".manyhands/mock"}/${safeTaskId}`,
    baseCommit: options.baseCommit ?? "mock-base-commit",
    createdAt: options.createdAt ?? "1970-01-01T00:00:00.000Z",
    cleanedUp: false
  };
}

export function buildMockDiff(contract: AgentTaskContract, changedFiles: readonly string[]): string {
  return changedFiles
    .map((file) => [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      `+ ${contract.expectedOutput.diffShapeHint ?? `Simulated change for ${contract.taskId}`}`
    ].join("\n"))
    .join("\n\n");
}

function buildMockValidationChecks(
  contract: AgentTaskContract,
  executedValidationCommands: readonly string[],
  scopeValidation: ScopeValidationResult
): ValidationCheck[] {
  const commandChecks = contract.validationCommands.map((validationCommand) => ({
    kind: validationCommand.kind === "custom" ? "acceptance" as const : validationCommand.kind,
    passed: executedValidationCommands.includes(validationCommand.command),
    command: validationCommand.command,
    summary: executedValidationCommands.includes(validationCommand.command)
      ? `Simulated validation passed: ${validationCommand.command}`
      : `Required validation not reported: ${validationCommand.command}`,
    durationMs: 1
  }));

  return [
    ...commandChecks,
    {
      kind: "scope",
      passed: scopeValidation.valid,
      summary: scopeValidation.valid
        ? "Scope validation passed"
        : `Scope validation found ${scopeValidation.violations.length} violation(s)`,
      durationMs: 1
    }
  ];
}
