import { describe, expect, it } from "vitest";
import { V2NodeExecutor, type V2NodeValidationPort } from "@manyhands/execution-core";
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
  it("succeeds without a commit when a sibling already satisfied the contract", async () => {
    const validated: string[] = [];
    const outcome = await runLeaf({
      // The sibling committed, so this leaf's base is ahead of the run's.
      worktreeHead: "SIBLING_SHA",
      validate: (candidateCommit) => {
        validated.push(candidateCommit);
        return "verified";
      }
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") return;
    // Validation ran against the baseline, which is the only candidate there is.
    expect(validated).toEqual(["SIBLING_SHA"]);
    expect(outcome.candidateCommit).toBe("SIBLING_SHA");
    expect(outcome.changedFiles).toEqual([]);
  });

  it("still fails when the baseline does not satisfy the contract", async () => {
    const outcome = await runLeaf({ worktreeHead: "SIBLING_SHA", validate: () => "failed" });

    expect(outcome.kind).toBe("failure");
    if (outcome.kind !== "failure") return;
    expect(outcome.reason).toContain("empty_diff");
  });

  /**
   * The SP2 rehearsal of 2026-08-07. The domain leaf ran in the first wave,
   * spent 184k input tokens and changed nothing. Revalidating its baseline
   * returned `verified` — the target's `npm test` passes on an untouched tree,
   * because the behaviour the leaf was asked to add has no test yet — so the
   * leaf was recorded as a satisfied no-op and its empty artifact adopted.
   *
   * The no-op exists for a leaf whose sibling already did its work. Nothing had
   * run yet: the worktree still sits on the run's own base commit, so no sibling
   * could have satisfied anything. Whole-suite validation cannot tell "the
   * contract is already met" from "this target's tests were green before we
   * started", and on any well-formed target they are the same observation.
   */
  it("refuses the no-op when nothing in the run has committed yet", async () => {
    const outcome = await runLeaf({ worktreeHead: "BASE_SHA", validate: () => "verified" });

    expect(outcome.kind).toBe("failure");
    if (outcome.kind !== "failure") return;
    expect(outcome.reason).toContain("empty_diff");
  });
});

async function runLeaf(options: {
  validate: (candidateCommit: string) => "verified" | "failed";
  /** Where the leaf's worktree sits: the run's base, or a sibling's commit. */
  worktreeHead: string;
}) {
  const worktreePath = "C:/wt/slot-000";
  const git = new FakeGitRunner({
    heads: { [worktreePath]: options.worktreeHead },
    diffCachedNameOnly: [],
    diffCached: ""
  });
  const validator: V2NodeValidationPort = {
    validate: async ({ candidateCommit, contract }) => ({
      matrixId: "matrix-1",
      candidateCommit,
      validationContract: { id: contract.validation.id, revision: contract.validation.revision },
      criteria: [],
      observations: [],
      outcome: options.validate(candidateCommit)
    })
  };
  const executor = new V2NodeExecutor({
    git: git as never,
    repoRoot: "C:/repo",
    traceStore: { append: () => undefined } as never,
    executorFactory: {
      create: () => ({
        execute: async () => ({ exitCode: 0, durationMs: 10, timedOut: false, stdout: "", stderr: "" })
      })
    } as never,
    validator,
    worktrees: {
      acquire: async () => ({
        worktree: { taskId: "node-1", path: worktreePath, baseCommit: options.worktreeHead },
        manifest: { resultingCommit: options.worktreeHead },
        release: async () => undefined
      })
    } as never,
    baseBuilder: {
      build: async () => ({
        worktree: { taskId: "node-1", path: worktreePath, baseCommit: options.worktreeHead },
        manifest: { resultingCommit: options.worktreeHead },
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
