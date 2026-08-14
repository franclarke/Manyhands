import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  IntegrationManifestExecutor,
  createIntegrationRequestManifest,
  type IntegrationOperation,
  type IntegrationOperationJournal
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const BASE = "b".repeat(40);
const FINGERPRINT = `sha256:${createHash("sha256").update("stage9").digest("hex")}`;
const CONTRACT_DIGEST = `sha256:${createHash("sha256").update("contract").digest("hex")}`;

function changeSetManifest(artifactId: string) {
  const material = {
    id: artifactId,
    contract: { id: artifactId, revision: 1, digest: CONTRACT_DIGEST },
    producerNodeId: "unit:a",
    producerAttemptId: "run:stage9:attempt:unit:a:1",
    inputFingerprint: FINGERPRINT,
    repositoryObjectStoreId: "object-store:stage9",
    objectFormat: "sha1" as const,
    sourceCandidate: { commitOid: "c".repeat(40), treeOid: "d".repeat(40) },
    retainedByRef: "refs/manyhands/test/artifact-a",
    kind: "change_set" as const,
    baseTreeSha: "e".repeat(40),
    resultTreeSha: "f".repeat(40),
    entries: []
  };
  const manifestDigest = `sha256:${createHash("sha256").update(JSON.stringify(material)).digest("hex")}`;
  return { ...material, manifestDigest };
}

function manifestChild() {
  const manifest = changeSetManifest("artifact:a");
  return {
    schemaVersion: 1 as const,
    artifactId: "artifact:a",
    runId: "run:stage9",
    nodeId: "unit:a",
    digest: manifest.manifestDigest,
    producerAttemptId: "run:stage9:attempt:unit:a:1",
    contract: { id: "artifact:a", revision: "1" },
    kind: "manifest" as const,
    location: manifest.manifestDigest,
    manifest,
    adoptedAt: "2026-08-14T00:00:00.000Z"
  };
}

function commitChild() {
  return {
    schemaVersion: 1 as const,
    artifactId: "artifact:a",
    runId: "run:stage9",
    nodeId: "unit:a",
    digest: `sha256:${createHash("sha256").update("commit-child").digest("hex")}`,
    producerAttemptId: "run:stage9:attempt:unit:a:1",
    contract: { id: "artifact:a", revision: "1" },
    kind: "commit" as const,
    location: "c".repeat(40),
    adoptedAt: "2026-08-14T00:00:00.000Z"
  };
}

class MemoryJournal implements IntegrationOperationJournal {
  operation: IntegrationOperation | undefined;
  readonly states: string[] = [];
  async open(input: Omit<IntegrationOperation, "schemaVersion" | "version" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">): Promise<IntegrationOperation> {
    this.operation ??= {
      ...input,
      schemaVersion: 2,
      integrationOperationId: "op-stage9",
      state: "prepared",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z"
    };
    this.states.push(this.operation.state);
    return this.operation;
  }
  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    this.operation = {
      ...operation,
      ...patch,
      version: (operation.version ?? 0) + 1,
      updatedAt: "2026-08-14T00:00:01.000Z"
    };
    this.states.push(this.operation.state);
    return this.operation;
  }
}

function requestWith(childArtifacts: readonly unknown[]) {
  return createIntegrationRequestManifest({
    runId: "run:stage9",
    integrationAttemptId: "run:stage9:attempt:unit:root:1",
    compositeNode: { id: "unit:root", graphRevision: 1 },
    base: { manifestId: "execution-base:stage9", resultingCommit: BASE, inputFingerprint: FINGERPRINT },
    availableArtifacts: childArtifacts as never,
    requiredArtifactIds: ["artifact:a"],
    seamRevisions: [{ id: "seam:a-root", revision: "1" }],
    parentGoal: "Wire module A.",
    validationContract: { id: "validation:root", revision: "1" },
    outputArtifactContract: { id: "artifact:root", revision: "1" },
    createdAt: "2026-08-14T00:00:00.000Z"
  });
}

function executorWith(git: FakeGitRunner) {
  return new IntegrationManifestExecutor({
    git,
    validate: async () => ({ matrixId: "matrix-stage9", outcome: "verified" as const }),
    digestCandidate: async () => `sha256:${createHash("sha256").update("candidate").digest("hex")}`
  });
}

describe("Stage 9 exact child artifacts", () => {
  it("refuses a commit-shaped child before touching Git", async () => {
    const git = new FakeGitRunner({ heads: { "/repo/worktree": BASE } });
    const journal = new MemoryJournal();
    const manifest = await executorWith(git).integrate({
      request: requestWith([commitChild()]),
      worktreePath: "/repo/worktree",
      integrationOperation: { journal, runId: "run:stage9" }
    });

    expect(manifest.disposition).toBe("failed");
    expect(manifest.errors.map((error) => error.code)).toContain("unsupported_artifact");
    // Commit transport is retired: no cherry-pick may be attempted, even as a
    // fallback, and no side effect may precede the refusal.
    expect(git.opsInvoked()).not.toContain("cherryPick");
    expect(journal.states).not.toContain("cherry_pick_started");
  });

  it("never records a cherry-pick state for an exact manifest child", async () => {
    const git = new FakeGitRunner({ heads: { "/repo/worktree": BASE } });
    const journal = new MemoryJournal();
    await executorWith(git).integrate({
      request: requestWith([manifestChild()]),
      worktreePath: "/repo/worktree",
      integrationOperation: { journal, runId: "run:stage9" }
    });

    expect(journal.states).not.toContain("cherry_pick_started");
    expect(journal.states).toContain("child_started");
    const applications = (journal.operation?.children ?? []).map((child) => child.application);
    expect(applications).not.toContain("cherry_picked");
  });

  it("still reads a historical operation recorded under the retired states", () => {
    // Retiring a write path must not orphan the journals already on disk.
    const historical = {
      schemaVersion: 2,
      integrationOperationId: "op-historical",
      runId: "run:legacy",
      parentNodeId: "unit:root",
      worktreePath: "/repo/worktree",
      baseSha: BASE,
      state: "cherry_pick_started",
      children: [{ taskId: "artifact:a", commitSha: "c".repeat(40), state: "applied", application: "cherry_picked" }],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    } satisfies IntegrationOperation;
    expect(historical.state).toBe("cherry_pick_started");
    expect(historical.children[0]!.application).toBe("cherry_picked");
  });
});
