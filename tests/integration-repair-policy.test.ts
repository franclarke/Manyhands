import { describe, expect, it, vi } from "vitest";
import { IntegrationManifestExecutor, createIntegrationRequestManifest } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

describe("integration manifest repair policy", () => {
  it("provides semantic context once and raises a decision after the bounded repair fails", async () => {
    const git = new FakeGitRunner({
      heads: { "/wt": "BASE" },
      cherryPickOutcomes: [{ ok: false, kind: "conflict", conflictFiles: ["src/shared.ts"], output: "CONFLICT" }]
    });
    const repair = vi.fn(async () => ({ success: false, evidenceRefs: ["repair:stderr"] }));
    const request = createIntegrationRequestManifest({
      runId: "run-1", integrationAttemptId: "attempt-parent", compositeNode: { id: "parent", graphRevision: 3 },
      base: { manifestId: "base", resultingCommit: "BASE", inputFingerprint: `sha256:${"a".repeat(64)}` },
      availableArtifacts: [{ schemaVersion: 1, artifactId: "child", runId: "run-1", nodeId: "child", digest: "digest", producerAttemptId: "attempt", contract: { id: "artifact-contract", revision: "rev-2" }, kind: "commit", location: "SHA", adoptedAt: "2026-07-17T12:00:00.000Z" }],
      requiredArtifactIds: ["child"], seamRevisions: [{ id: "PublicApi", revision: "rev-4" }],
      parentGoal: "Expose the composed public API", validationContract: { id: "validation", revision: "rev-3" },
      outputArtifactContract: { id: "artifact-parent", revision: "rev-3" },
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git, repair,
      validate: async () => ({ matrixId: "unused", outcome: "verified" }),
      digestCandidate: async () => "unused"
    }).integrate({ request, worktreePath: "/wt" });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledWith(expect.objectContaining({
      parentGoal: "Expose the composed public API",
      seamRevisions: [{ id: "PublicApi", revision: "rev-4" }],
      conflictFiles: ["src/shared.ts"],
      childArtifacts: [expect.objectContaining({ artifactId: "child", digest: "digest" })]
    }));
    expect(result.disposition).toBe("decision_required");
    expect(result.repairAttempt).toMatchObject({ pass: 1, outcome: "failed", evidenceRefs: ["repair:stderr"] });
  });
});
