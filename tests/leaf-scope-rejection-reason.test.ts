import { describe, expect, it } from "vitest";
import { V2NodeExecutor } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

/**
 * A scope rejection has to name the paths that left the contract.
 *
 * Observed in the third SP2 rehearsal (run `dbb427ca`): the application leaf was
 * rejected and the persisted reason read "scope_violation: the agent changed
 * files outside the declared scope" — no paths. The decision raised to the
 * operator is built from that reason, so it asked them to "retry with guidance"
 * about a violation it would not name. The path was recorded, in a
 * `scope_check_failed` trace, but nothing points there: answering the question
 * the system asked required excavating a file the operator has no reason to
 * open.
 *
 * The failure-reason builder already refuses to dump the diff for a scope
 * rejection, precisely so the paths stay readable. It reads `violations`, which
 * carries forbidden-glob hits. A strict-policy rejection is different: the paths
 * are merely outside the allow-list, so they arrive in `outOfScope` and
 * `violations` is empty — the exact branch that produced the empty message.
 *
 * Stage 7 accepts an adverse result only when it is "attributable with an
 * observable cause". A rejection that names no path is not attributable.
 */
describe("scope rejection reason", () => {
  it("names the paths that left the allow-list under the strict policy", async () => {
    const outcome = await runLeaf({ changed: ["src/b.ts", "docs/readme.md"] });

    expect(outcome.kind).toBe("failure");
    if (outcome.kind !== "failure") return;
    expect(outcome.reason).toContain("src/b.ts");
    expect(outcome.reason).toContain("docs/readme.md");
  });

  it("still names a forbidden-glob hit", async () => {
    const outcome = await runLeaf({ changed: [".env"], forbiddenPaths: [".env"] });

    expect(outcome.kind).toBe("failure");
    if (outcome.kind !== "failure") return;
    expect(outcome.reason).toContain(".env");
  });
});

async function runLeaf(options: { changed: string[]; forbiddenPaths?: string[] }) {
  const worktreePath = "C:/wt/slot-000";
  const git = new FakeGitRunner({
    heads: { [worktreePath]: "BASE_SHA" },
    diffCachedNameOnly: options.changed,
    diffCachedAddedFiles: [],
    diffCached: "diff --git a/src/b.ts b/src/b.ts\n"
  });
  const base = {
    worktree: { taskId: "node-1", path: worktreePath, baseCommit: "BASE_SHA" },
    manifest: { resultingCommit: "BASE_SHA" },
    release: async () => undefined
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
    validator: {
      validate: async ({ candidateCommit, contract }) => ({
        matrixId: "matrix-1",
        candidateCommit,
        validationContract: { id: contract.validation.id, revision: contract.validation.revision },
        criteria: [],
        outcome: "verified" as const
      })
    } as never,
    worktrees: { acquire: async () => base } as never,
    baseBuilder: { build: async () => base } as never,
    writeInstructions: async () => undefined,
    now: () => "2026-08-07T12:00:00.000Z"
  });

  return executor.execute({
    runId: "run-1",
    attemptId: "run-1:attempt:node-1:1",
    inputFingerprint: "sha256:fp",
    graph: { graphId: "g", revision: 1, rootId: "root", baseCommit: "BASE_SHA", nodes: { "node-1": { id: "node-1", kind: "leaf", parentId: "root", title: "Leaf" } } },
    node: { id: "node-1", kind: "leaf", parentId: "root", title: "Leaf" },
    contract: {
      task: { id: "task-1", revision: "r1", nodeId: "node-1", goal: "Do the thing", acceptanceCriteria: [], constraints: [], validation: { id: "validation-1", revision: "r1" } },
      scope: { allowedPaths: ["src/a.ts"], forbiddenPaths: options.forbiddenPaths ?? [], outputRoots: ["src"] },
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
