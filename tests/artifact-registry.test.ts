import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlArtifactStore, ImmutableArtifactConflictError } from "@manyhands/run-store";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-artifacts-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("immutable artifact registry", () => {
  it("stores digest, producer attempt and contract revision idempotently", async () => {
    const store = new JsonlArtifactStore({ directory });
    const artifact = { schemaVersion: 1 as const, artifactId: "artifact-1", runId: "run-1", nodeId: "node-1", digest: "sha256:abc", producerAttemptId: "attempt-1", contract: { id: "artifact-contract", revision: 2 }, kind: "commit" as const, location: "abc123", adoptedAt: "2026-07-17T00:00:00.000Z" };
    expect(await store.adopt(artifact)).toEqual(await store.adopt(artifact));
    await expect(store.adopt({ ...artifact, digest: "sha256:changed" })).rejects.toBeInstanceOf(ImmutableArtifactConflictError);
    expect(await store.list("run-1")).toEqual([artifact]);
  });
});
