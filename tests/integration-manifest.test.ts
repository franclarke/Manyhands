import { describe, expect, it } from "vitest";
import {
  IntegrationManifestExecutor,
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
