import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptAttemptResult, computeInputFingerprint } from "@manyhands/run-coordinator";
import { JsonlArtifactStore, JsonlAttemptStore } from "@manyhands/run-store";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-attempts-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const fingerprintSource = { graphId: "graph", nodeId: "node", contractRevisions: [{ id: "task", revision: "r1" }], baseCommit: "a".repeat(40), consumedArtifacts: [], repositoryContextDigest: "repo", executorProfile: { id: "executor", revision: "r1" }, validationContract: { id: "validation", revision: "r1" } };

describe("attempt adoption eligibility", () => {
  it("marks an old fingerprint stale and never adopts its artifact", async () => {
    const attempts = new JsonlAttemptStore({ directory });
    const artifacts = new JsonlArtifactStore({ directory });
    const attempt = await attempts.create({ attemptId: "attempt-1", runId: "run-1", nodeId: "node", inputFingerprint: computeInputFingerprint(fingerprintSource), createdAt: "2026-07-17T00:00:00.000Z" });
    const decision = await adoptAttemptResult({ attempt: { ...attempt, status: "finished", outputDigest: "sha256:result" }, currentFingerprint: computeInputFingerprint({ ...fingerprintSource, contractRevisions: [{ id: "task", revision: "r2" }] }), artifact: { artifactId: "artifact-1", contract: { id: "artifact-contract", revision: "r1" }, kind: "commit", location: "abc" } }, artifactTransaction(artifacts));
    expect(decision).toMatchObject({ eligible: false, event: { type: "attempt.stale" } });
    expect(await artifacts.list("run-1")).toEqual([]);
  });

  it("creates a new retry attempt without deleting prior evidence", async () => {
    const attempts = new JsonlAttemptStore({ directory });
    await attempts.create({ attemptId: "attempt-1", runId: "run-1", nodeId: "node", inputFingerprint: "sha256:old", createdAt: "2026-07-17T00:00:00.000Z" });
    await attempts.create({ attemptId: "attempt-2", runId: "run-1", nodeId: "node", inputFingerprint: "sha256:new", retryOfAttemptId: "attempt-1", createdAt: "2026-07-17T00:01:00.000Z" });
    expect((await attempts.list("run-1")).map((attempt) => attempt.attemptId)).toEqual(["attempt-1", "attempt-2"]);
  });

  it("adopts exactly the artifact produced by a matching finished attempt", async () => {
    const artifacts = new JsonlArtifactStore({ directory });
    const fingerprint = computeInputFingerprint(fingerprintSource);
    const decision = await adoptAttemptResult({
      attempt: { schemaVersion: 1, attemptId: "attempt-ok", runId: "run-1", nodeId: "node", inputFingerprint: fingerprint, createdAt: "2026-07-17T00:00:00.000Z", status: "finished", outputDigest: "sha256:result" },
      currentFingerprint: fingerprint,
      artifact: { artifactId: "artifact-ok", contract: { id: "artifact-contract", revision: "r3" }, kind: "commit", location: "abc", cherryPickMainline: 1 },
      adoptedAt: "2026-07-17T00:02:00.000Z"
    }, artifactTransaction(artifacts));
    expect(decision).toMatchObject({ eligible: true, event: { type: "artifact.adopted" } });
    expect(await artifacts.list("run-1")).toEqual([expect.objectContaining({ artifactId: "artifact-ok", digest: "sha256:result", producerAttemptId: "attempt-ok", contract: { id: "artifact-contract", revision: "r3" }, cherryPickMainline: 1 })]);
  });
});

function artifactTransaction(artifacts: JsonlArtifactStore) {
  return {
    stage: async (decision: Awaited<ReturnType<typeof adoptAttemptResult>>) => {
      if (decision.eligible) await artifacts.adopt(decision.artifact);
    }
  };
}
