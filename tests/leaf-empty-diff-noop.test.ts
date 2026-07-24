import { describe, expect, it } from "vitest";
import { V2NodeExecutor } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

/**
 * A leaf that finds its contract already satisfied is not a failed leaf.
 *
 * Observed in a real run: an upstream leaf whose declared scope overlapped a
 * downstream one implemented the downstream work too — legally, inside its own
 * allowed paths. The downstream agent then had nothing to do, produced an empty
 * diff, and the run was parked on a decision the operator could not usefully
 * answer.
 *
 * The heuristic that was supposed to catch this could never fire on this path:
 * it needs expected outputs or implementation paths, and neither is passed
 * here. So the fix is not a better heuristic — it is to let the system's own
 * verification decide. An empty diff revalidates the baseline: if the evidence
 * matrix verifies, the contract really is satisfied and the leaf succeeds with
 * no commit; if it does not, the agent genuinely did nothing and the leaf still
 * fails. An agent that skips its work can never be recorded as success.
 */
describe("empty diff on a leaf", () => {
  it("succeeds without a commit when the baseline already satisfies the contract", async () => {
    const validated: string[] = [];
    const outcome = await runLeaf({
      validate: (candidateCommit) => {
        validated.push(candidateCommit);
        return "verified";
      }
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") return;
    // Validation ran against the baseline, which is the only candidate there is.
    expect(validated).toEqual(["BASE_SHA"]);
    expect(outcome.candidateCommit).toBe("BASE_SHA");
    expect(outcome.changedFiles).toEqual([]);
  });

  it("still fails when the baseline does not satisfy the contract", async () => {
    const outcome = await runLeaf({ validate: () => "failed" });

    expect(outcome.kind).toBe("failure");
    if (outcome.kind !== "failure") return;
    expect(outcome.reason).toContain("empty_diff");
  });
});

async function runLeaf(options: { validate: (candidateCommit: string) => "verified" | "failed" }) {
  const worktreePath = "C:/wt/slot-000";
  const git = new FakeGitRunner({
    heads: { [worktreePath]: "BASE_SHA" },
    diffCachedNameOnly: [],
    diffCached: ""
  });
  const executor = new V2NodeExecutor({
    git: git as never,
    repoRoot: "C:/repo",
    traceStore: { append: () => undefined } as never,
    executorFactory: {
      create: () => ({
        execute: async () => ({ exitCode: 0, durationMs: 10, timedOut: false, stdout: "", stderr: "" })
      })
    } as never,
    validator: {
      validate: async ({ candidateCommit, contract }) => ({
        matrixId: "matrix-1",
        candidateCommit,
        validationContract: { id: contract.validation.id, revision: contract.validation.revision },
        criteria: [],
        outcome: options.validate(candidateCommit)
      })
    } as never,
    worktrees: {
      acquire: async () => ({
        worktree: { taskId: "node-1", path: worktreePath, baseCommit: "BASE_SHA" },
        manifest: { resultingCommit: "BASE_SHA" },
        release: async () => undefined
      })
    } as never,
    baseBuilder: {
      build: async () => ({
        worktree: { taskId: "node-1", path: worktreePath, baseCommit: "BASE_SHA" },
        manifest: { resultingCommit: "BASE_SHA" },
        release: async () => undefined
      })
    } as never,
    writeInstructions: async () => undefined,
    now: () => "2026-07-24T12:00:00.000Z"
  });

  return executor.execute({
    runId: "run-1",
    attemptId: "run-1:attempt:node-1:1",
    inputFingerprint: "sha256:fp",
    graph: { graphId: "g", revision: 1, rootId: "root", baseCommit: "BASE_SHA", nodes: { "node-1": { id: "node-1", kind: "leaf", parentId: "root", title: "Leaf" } } },
    node: { id: "node-1", kind: "leaf", parentId: "root", title: "Leaf" },
    contract: {
      task: { id: "task-1", revision: "r1", nodeId: "node-1", goal: "Do the thing", acceptanceCriteria: [], constraints: [], validation: { id: "validation-1", revision: "r1" } },
      scope: { allowedPaths: ["src/a.ts"], forbiddenPaths: [], outputRoots: ["src"] },
      seams: [],
      artifacts: [],
      validation: { id: "validation-1", revision: "r1", obligations: [] }
    },
    consumedArtifacts: [],
    outputArtifactContract: { id: "artifact-1", revision: "r1", producerNodeId: "node-1", artifactType: "node-result" },
    selection: { executorId: "codex-cli", model: "gpt-5.5" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.5" },
    config: { scopePolicy: "strict", leafTimeoutMs: 1000, integrationTimeoutMs: 1000, unexpectedCommitPolicy: "reject" },
    target: { sourceTargetFingerprint: "fp", targetBranch: "main", targetHead: "BASE_SHA" }
  } as never);
}
