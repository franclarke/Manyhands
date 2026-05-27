import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  type AgentTaskContract
} from "@manyhands/contracts";
import { validateScope } from "@manyhands/scope-validation";

function makeContract(overrides: Partial<AgentTaskContract> = {}): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId: "task:scope",
    objective: "Validate scope behavior.",
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: ["src/auth/**"],
      maxFilesTouched: 3
    },
    forbidden: {
      paths: ["src/auth/secrets/**"]
    },
    relevantSymbols: ["MagicLinkToken"],
    dependencies: [],
    acceptance: [
      {
        kind: "custom",
        description: "Scope is enforced."
      }
    ],
    validationCommands: [
      {
        kind: "unit",
        command: "pnpm test tests/auth/passwordless-login.test.ts",
        blocking: true
      }
    ],
    expectedOutput: {
      changedFiles: ["src/auth/magic-link/token-store.ts"],
      producedSymbols: ["MagicLinkToken"],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: 60_000,
      maxCostUsd: 0
    },
    knownRisks: [],
    definitionOfDone: "Scope validation passes.",
    ...overrides
  });
}

describe("validateScope", () => {
  it("approves changes inside allowed paths", () => {
    const result = validateScope({
      contract: makeContract(),
      changedFiles: ["src/auth/magic-link/token-store.ts"],
      reportedSymbols: ["MagicLinkToken"],
      executedValidationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails when a forbidden path is touched", () => {
    const result = validateScope({
      contract: makeContract(),
      changedFiles: ["src/auth/secrets/token-secret.ts"],
      reportedSymbols: ["MagicLinkToken"],
      executedValidationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "forbidden_path_touched",
          severity: "blocking"
        })
      ])
    );
  });

  it("detects files outside allowed scope", () => {
    const result = validateScope({
      contract: makeContract(),
      changedFiles: ["src/admin/users.ts"],
      reportedSymbols: ["MagicLinkToken"],
      executedValidationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "outside_allowed_scope",
          path: "src/admin/users.ts"
        })
      ])
    );
  });

  it("detects missing expected files, symbols and validation commands", () => {
    const result = validateScope({
      contract: makeContract(),
      changedFiles: [],
      reportedSymbols: [],
      executedValidationCommands: []
    });

    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.type)).toEqual(
      expect.arrayContaining([
        "missing_expected_file",
        "missing_expected_symbol",
        "missing_required_validation"
      ])
    );
  });

  it("detects undeclared critical paths", () => {
    const result = validateScope({
      contract: makeContract({
        allowed: {
          paths: ["**"]
        },
        expectedOutput: {
          changedFiles: [],
          producedSymbols: [],
          consumedSymbols: []
        }
      }),
      changedFiles: ["package.json"],
      reportedSymbols: [],
      executedValidationCommands: ["pnpm test tests/auth/passwordless-login.test.ts"]
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "undeclared_critical_path",
          severity: "blocking"
        })
      ])
    );
  });
});
