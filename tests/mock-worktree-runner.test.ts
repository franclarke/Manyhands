import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  type AgentTaskContract
} from "@manyhands/contracts";
import {
  createMockWorktreeSession,
  MockWorktreeRunner,
  type AgentInvocation
} from "@manyhands/worktree-runner";

function makeContract(overrides: Partial<AgentTaskContract> = {}): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId: "passwordless-login:balanced:token-model",
    objective: "Simulate token model implementation.",
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: ["src/auth/magic-link/**"]
    },
    forbidden: {
      paths: ["**/.env*"]
    },
    relevantSymbols: ["MagicLinkToken"],
    dependencies: [],
    acceptance: [
      {
        kind: "custom",
        description: "Token model is implemented."
      }
    ],
    validationCommands: [
      {
        kind: "unit",
        command: "pnpm test",
        blocking: true
      }
    ],
    expectedOutput: {
      changedFiles: ["src/auth/magic-link/token-store.ts"],
      producedSymbols: ["MagicLinkToken"],
      consumedSymbols: [],
      diffShapeHint: "Simulated token model change."
    },
    limits: {
      maxDurationMs: 60_000,
      maxCostUsd: 0
    },
    knownRisks: [],
    definitionOfDone: "Done.",
    ...overrides
  });
}

function makeInvocation(contract = makeContract()): AgentInvocation {
  return {
    contract,
    worktree: createMockWorktreeSession(contract.taskId),
    model: "mock-agent",
    promptPreview: "Mock prompt"
  };
}

describe("MockWorktreeRunner", () => {
  it("returns a deterministic AgentRunResult", async () => {
    const runner = new MockWorktreeRunner();
    const invocation = makeInvocation();

    const first = await runner.run(invocation);
    const second = await runner.run(invocation);

    expect(first).toEqual(second);
    expect(first.success).toBe(true);
    expect(first.metrics.costUsd).toBe(0);
  });

  it("does not create a real filesystem worktree", async () => {
    const basePath = path.join(process.cwd(), ".manyhands-test-never-created", "runner");
    const runner = new MockWorktreeRunner({ basePath });
    const session = runner.createSession("task:no-fs");

    expect(existsSync(session.path)).toBe(false);

    await runner.run({
      ...makeInvocation(),
      worktree: session
    });

    expect(existsSync(session.path)).toBe(false);
  });

  it("generates diffs associated with declared files", async () => {
    const result = await new MockWorktreeRunner().run(makeInvocation());

    expect(result.changedFiles).toEqual(["src/auth/magic-link/token-store.ts"]);
    expect(result.diff).toContain("diff --git a/src/auth/magic-link/token-store.ts");
    expect(result.reportedSymbols).toEqual(["MagicLinkToken"]);
  });
});
