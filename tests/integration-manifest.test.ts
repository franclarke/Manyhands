import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IntegrationManifestExecutor,
  JsonIntegrationOperationJournal,
  createIntegrationRequestManifest
} from "@manyhands/execution-core";
import type { IntegrationOperation, IntegrationOperationJournal } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";
import { decideIntegrationAdoption } from "@manyhands/run-coordinator";

const artifact = (artifactId: string, nodeId: string, location: string, digest = `digest-${artifactId}`) => ({
  schemaVersion: 1 as const, artifactId, runId: "run-1", nodeId, digest,
  producerAttemptId: `attempt-${artifactId}`, contract: { id: `contract-${artifactId}`, revision: "rev-1" },
  kind: "commit" as const, location, adoptedAt: "2026-07-17T12:00:00.000Z"
});

function request(availableArtifacts = [artifact("a", "node-a", "SHA_A"), artifact("b", "node-b", "SHA_B")], requiredArtifactIds = ["a"]) {
  return createIntegrationRequestManifest({
    runId: "run-1", integrationAttemptId: "attempt-parent", compositeNode: { id: "parent", graphRevision: 2 },
    base: { manifestId: "base-manifest", resultingCommit: "BASE", inputFingerprint: `sha256:${"a".repeat(64)}` },
    availableArtifacts, requiredArtifactIds,
    seamRevisions: [{ id: "seam-1", revision: "rev-1" }],
    parentGoal: "Compose the feature", validationContract: { id: "validation-parent", revision: "rev-1" },
    outputArtifactContract: { id: "artifact-parent", revision: "rev-1" },
    createdAt: "2026-07-17T12:00:00.000Z"
  });
}

describe("IntegrationManifestExecutor", () => {
  it("preserves the scheduler's topological artifact order instead of sorting ids", () => {
    const built = request([
      artifact("api", "node-api", "SHA_API"),
      artifact("domain", "node-domain", "SHA_DOMAIN"),
      artifact("application", "node-application", "SHA_APPLICATION")
    ], ["domain", "application", "api"]);

    expect(built.childArtifacts.map((child) => child.artifactId)).toEqual(["domain", "application", "api"]);
  });

  it("recovers after a crash following the first child without repeating its side effect", async () => {
    const journalDirectory = await mkdtemp(join(tmpdir(), "mh-integration-journal-"));
    try {
      const git = new CrashAfterFirstCherryPickGit({
        heads: { "/wt": "BASE" },
        cherryPickResultShas: ["PICK_A", "PICK_B"],
        commitMessages: {
          SHA_A: "feature A",
          SHA_B: "feature B",
          PICK_A: "feature A\n\n(cherry picked from commit SHA_A)",
          PICK_B: "feature B\n\n(cherry picked from commit SHA_B)"
        }
      });
      const journal = new JsonIntegrationOperationJournal(journalDirectory);
      const built = request(undefined, ["a", "b"]);
      const deps = {
        allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
        git,
        validate: async () => ({ matrixId: "matrix-1", outcome: "verified" as const }),
        digestCandidate: async () => "digest-parent"
      };
      const operation = { journal, runId: "run-1", operationId: "op-1", fencingToken: 1 };
      const takeover = { journal, runId: "run-1", operationId: "op-2", fencingToken: 2 };

      await expect(new IntegrationManifestExecutor(deps).integrate({
        request: built,
        worktreePath: "/wt",
        integrationOperation: operation
      })).rejects.toThrow("simulated crash");

      const recovered = await new IntegrationManifestExecutor(deps).integrate({
        request: built,
        worktreePath: "/wt",
        integrationOperation: { ...takeover, allowTakeover: true }
      });

      expect(recovered.disposition).toBe("success");
      expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(["SHA_A", "SHA_B"]);
      const persisted = await journal.open({
        runId: "run-1",
        parentNodeId: built.compositeNode.id,
        attemptId: built.integrationAttemptId,
        requestManifestId: built.manifestId,
        worktreePath: "/wt",
        baseSha: built.base.resultingCommit,
        children: built.childArtifacts.map((child) => ({ taskId: child.artifactId, commitSha: child.location, state: "pending" as const })),
        operationId: "op-2",
        fencingToken: 2,
        allowTakeover: true
      });
      expect(persisted.state).toBe("completed");
      expect(persisted.resultManifest).toMatchObject({ candidateSha: "PICK_B", disposition: "success" });
    } finally {
      await rm(journalDirectory, { recursive: true, force: true });
    }
  });

  it("stops before materializing artifacts when its integration signal has expired", async () => {
    const controller = new AbortController();
    controller.abort(new Error("integration timeout"));
    const git = new FakeGitRunner({ heads: { "/wt": "BASE" }, cherryPickResultShas: ["PICK_A"] });

    await expect(new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => ({ matrixId: "matrix-1", outcome: "verified" }),
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: request(), worktreePath: "/wt", signal: controller.signal })).rejects.toThrow("integration timeout");

    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("applies only fresh explicitly required adopted artifacts", async () => {
    const git = new FakeGitRunner({ heads: { "/wt": "BASE" }, cherryPickResultShas: ["PICK_A"] });
    const built = request();
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => ({ matrixId: "matrix-1", outcome: "verified" }),
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(["SHA_A"]);
    expect(result.disposition).toBe("success");
    expect(result.childArtifacts.map((item) => item.artifactId)).toEqual(["a"]);
    expect(result).not.toHaveProperty("outputArtifacts");
    expect(decideIntegrationAdoption({ ...built, ...result })).toEqual({
      eligible: false,
      reason: "Integration result adoption is retired; the canonical execution driver adopts only exact Git-native manifests."
    });
  });

  it("validates the final candidate when a later composition supersedes an intermediate line", async () => {
    const git = new IntentDiffGit({
      heads: { "/wt": "BASE" },
      cherryPickResultShas: ["PICK_A"]
    });
    const built = request([artifact("a", "node-a", "SHA_A")], ["a"]);
    let validated = false;
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => {
        validated = true;
        return { matrixId: "matrix-1", outcome: "verified" as const };
      },
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(result.disposition).toBe("success");
    expect(result.errors).toEqual([]);
    expect(validated).toBe(true);
  });

  it("reports semantic loss through parent validation instead of a text heuristic", async () => {
    const git = new IntentDiffGit({
      heads: { "/wt": "BASE" },
      cherryPickResultShas: ["PICK_A"]
    });
    const built = request([artifact("a", "node-a", "SHA_A")], ["a"]);
    let validated = false;
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => {
        validated = true;
        return { matrixId: "matrix-1", outcome: "failed" as const };
      },
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(result.disposition).toBe("failed");
    expect(result.errors).toEqual([expect.objectContaining({ code: "parent_validation_failed" })]);
    expect(validated).toBe(true);
  });

  it("uses the single semantic repair budget after parent validation fails, then revalidates the repaired candidate", async () => {
    const repairCommit = "REPAIRED";
    const git = new FakeGitRunner({
      heads: { "/wt": "BASE" },
      cherryPickResultShas: ["PICK_A"],
      commitSha: repairCommit
    });
    const built = request([artifact("a", "node-a", "SHA_A")], ["a"]);
    const outcomes: Array<"failed" | "verified"> = ["failed", "verified"];
    const validated: string[] = [];
    const repair = async (input: { cause: string; artifactId: string; worktreePath: string }) => {
      expect(input.cause).toBe("parent_validation_failed");
      expect(input.artifactId).toBe("parent-validation");
      await git.addAll(input.worktreePath);
      const candidateSha = await git.commit({ cwd: input.worktreePath, message: "semantic repair" });
      return { success: true, candidateSha, evidenceRefs: ["repair:semantic"] };
    };
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      repair,
      validate: async ({ candidateSha }) => {
        validated.push(candidateSha);
        return { matrixId: `matrix-${validated.length}`, outcome: outcomes.shift()! };
      },
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(result).toMatchObject({ disposition: "success", candidateSha: repairCommit });
    expect(validated).toEqual(["PICK_A", repairCommit]);
    expect(result.repairAttempt).toMatchObject({
      cause: "parent_validation_failed",
      artifactId: "parent-validation",
      outcome: "succeeded",
      candidateSha: repairCommit
    });
  });

  it("recovers after persisting a repair commit without launching that repair twice", async () => {
    const journalDirectory = await mkdtemp(join(tmpdir(), "mh-integration-repair-journal-"));
    try {
      const git = new FakeGitRunner({
        heads: { "/wt": "BASE" },
        cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/a.ts"], output: "CONFLICT" }],
        commitSha: "REPAIRED"
      });
      const persisted = new JsonIntegrationOperationJournal(journalDirectory);
      const journal: IntegrationOperationJournal = new CrashAfterRepairFinishedJournal(persisted);
      const built = request([artifact("a", "node-a", "SHA_A")], ["a"]);
      let repairs = 0;
      const deps = {
        allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
        git,
        repair: async (input: { worktreePath: string }) => {
          repairs += 1;
          await git.addAll(input.worktreePath);
          const candidateSha = await git.commit({ cwd: input.worktreePath, message: "semantic repair" });
          return { success: true, candidateSha, evidenceRefs: ["repair:semantic"] };
        },
        validate: async () => ({ matrixId: "matrix-1", outcome: "verified" as const }),
        digestCandidate: async () => "digest-parent"
      };
      const firstOperation = { journal, runId: "run-1", operationId: "op-1", fencingToken: 1 };
      await expect(new IntegrationManifestExecutor(deps).integrate({ request: built, worktreePath: "/wt", integrationOperation: firstOperation })).rejects.toThrow("simulated crash after repair");

      const recovered = await new IntegrationManifestExecutor(deps).integrate({
        request: built,
        worktreePath: "/wt",
        integrationOperation: { journal, runId: "run-1", operationId: "op-2", fencingToken: 2, allowTakeover: true }
      });

      expect(recovered.disposition).toBe("success");
      expect(repairs).toBe(1);
      expect(git.calls.filter((call) => call.op === "cherryPick")).toHaveLength(1);
    } finally {
      await rm(journalDirectory, { recursive: true, force: true });
    }
  });

  it("fails before Git mutation when a required artifact is omitted", async () => {
    const git = new FakeGitRunner();
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => ({ matrixId: "unused", outcome: "verified" }),
      digestCandidate: async () => "unused"
    }).integrate({ request: request([artifact("a", "node-a", "SHA_A")], ["a", "missing"]), worktreePath: "/wt" });
    expect(result.disposition).toBe("failed");
    expect(result.errors).toEqual([expect.objectContaining({ code: "missing_required_artifact", artifactId: "missing" })]);
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });
});

class CrashAfterFirstCherryPickGit extends FakeGitRunner {
  private cherryPicks = 0;

  override async cherryPick(params: Parameters<FakeGitRunner["cherryPick"]>[0]): ReturnType<FakeGitRunner["cherryPick"]> {
    const outcome = await super.cherryPick(params);
    if (this.cherryPicks++ === 0) throw new Error("simulated crash");
    return outcome;
  }
}

class IntentDiffGit extends FakeGitRunner {
  override async diffRange(params: Parameters<FakeGitRunner["diffRange"]>[0]): ReturnType<FakeGitRunner["diffRange"]> {
    if (params.to === "SHA_A") return "diff --git a/src/a.ts b/src/a.ts\n+export const required = true;";
    if (params.to === "PICK_A") return "diff --git a/src/a.ts b/src/a.ts\n+export const unrelated = true;";
    return super.diffRange(params);
  }
}

class CrashAfterRepairFinishedJournal implements IntegrationOperationJournal {
  private crashed = false;

  constructor(private readonly delegate: IntegrationOperationJournal) {}

  open(input: Parameters<IntegrationOperationJournal["open"]>[0]): ReturnType<IntegrationOperationJournal["open"]> {
    return this.delegate.open(input);
  }

  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    const next = await this.delegate.update(operation, patch);
    if (!this.crashed && patch.state === "repair_finished") {
      this.crashed = true;
      throw new Error("simulated crash after repair");
    }
    return next;
  }
}
