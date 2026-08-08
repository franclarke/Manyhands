import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IntegrationManifestExecutor,
  JsonIntegrationOperationJournal,
  createIntegrationRequestManifest
} from "@manyhands/execution-core";
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
      git,
      validate: async () => ({ matrixId: "matrix-1", outcome: "verified" }),
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(["SHA_A"]);
    expect(result.disposition).toBe("success");
    expect(result.childArtifacts.map((item) => item.artifactId)).toEqual(["a"]);
    expect(result.outputArtifacts).toEqual([expect.objectContaining({ digest: "digest-parent", location: "PICK_A" })]);
    expect(decideIntegrationAdoption({ ...built, ...result }, "2026-07-17T12:02:00.000Z")).toEqual(
      expect.objectContaining({ eligible: true, artifacts: [expect.objectContaining({ producerAttemptId: "attempt-parent", digest: "digest-parent" })] })
    );
  });

  it("rejects a candidate that drops an added line from an adopted child patch", async () => {
    const git = new IntentDiffGit({
      heads: { "/wt": "BASE" },
      cherryPickResultShas: ["PICK_A"]
    });
    const built = request([artifact("a", "node-a", "SHA_A")], ["a"]);
    let validated = false;
    const result = await new IntegrationManifestExecutor({
      git,
      validate: async () => {
        validated = true;
        return { matrixId: "matrix-1", outcome: "verified" as const };
      },
      digestCandidate: async () => "digest-parent"
    }).integrate({ request: built, worktreePath: "/wt" });

    expect(result.disposition).toBe("failed");
    expect(result.errors).toEqual([expect.objectContaining({ code: "child_intent_not_retained" })]);
    expect(validated).toBe(false);
  });

  it("fails before Git mutation when a required artifact is omitted", async () => {
    const git = new FakeGitRunner();
    const result = await new IntegrationManifestExecutor({
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
