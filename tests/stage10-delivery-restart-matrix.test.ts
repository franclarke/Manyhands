import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonlRunEventStore } from "@manyhands/run-store";
import type { RunEventInput } from "@manyhands/run-coordinator";

import { createCurrentDeliveryPort } from "../apps/daemon/src/current-lifecycle-adapters.js";
import { createTransitionalUnsafeProfile } from "../apps/daemon/src/transitional-unsafe-profile.js";

import {
  buildDeliveryTargetFixture,
  git,
  removeDeliveryTargetFixture,
  stage10Approval,
  stage10At,
  stage10Definition,
  stage10Projection,
  type Stage10DeliveryTarget
} from "./helpers/stage10-delivery-fixture.js";

const runId = "run:stage10-restart";
const daemonEpoch = "epoch-stage10-restart";

const targets: Stage10DeliveryTarget[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...targets.splice(0).map(removeDeliveryTargetFixture),
    ...directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  ]);
});

/**
 * A crash around publication must converge to exactly one receipt and one
 * target state. Each cell here restarts the transaction from a repository state
 * a crash could really leave behind, and asserts both halves: the receipt is
 * the same one, and the ref moved once.
 *
 * The ref's reflog is the witness for "moved once" — a second publication would
 * append to it even when the resulting OID is identical.
 */
describe("Delivery restart matrix", () => {
  it("crash before the ref update: a fresh delivery publishes exactly once", async () => {
    const fixture = await target();
    // The interrupted attempt wrote nothing, so the target is untouched.
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.baseSha);

    const before = await refWrites(fixture);
    const receipt = await publish(fixture);

    expect(receipt.targetHeadAfter).toBe(fixture.candidateSha);
    expect(await refWrites(fixture)).toBe(before + 1);
  });

  it("crash after the ref update, before the receipt: recovery completes one receipt", async () => {
    const fixture = await target();
    await git(fixture.root, "update-ref", "refs/heads/main", fixture.candidateSha, fixture.baseSha);
    const before = await refWrites(fixture);

    const recovered = await publish(fixture);

    expect(recovered.finalSha).toBe(fixture.candidateSha);
    expect(recovered.deliveredTreeSha).toBe(fixture.treeSha);
    // Recovery must not re-publish: the ref is already where the receipt says.
    expect(await refWrites(fixture)).toBe(before);
  });

  it("crash during working-tree reconciliation: the tree ends at the delivered commit", async () => {
    const fixture = await target();
    await git(fixture.root, "update-ref", "refs/heads/main", fixture.candidateSha, fixture.baseSha);
    expect(await git(fixture.root, "status", "--porcelain")).not.toBe("");

    await publish(fixture);

    expect(await git(fixture.root, "status", "--porcelain")).toBe("");
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.candidateSha);
  });

  it("crash during recovery itself: re-entering twice still yields one receipt", async () => {
    const fixture = await target();
    await git(fixture.root, "update-ref", "refs/heads/main", fixture.candidateSha, fixture.baseSha);
    const before = await refWrites(fixture);

    const first = await publish(fixture);
    const second = await publish(fixture);
    const third = await publish(fixture);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await refWrites(fixture)).toBe(before);
  });

  it("crash between the physical publish and the durable write: one publication, no false success", async () => {
    // The window Task 1 stopped fabricating. The target moves, the durable
    // result is lost, and the effect must report failure rather than a receipt
    // nobody observed — then a retry has to converge on the delivery that
    // already happened instead of publishing a second time.
    const fixture = await target();
    const stateRoot = await temporaryDirectory();
    await seedRun(stateRoot, fixture);

    const before = await refWrites(fixture);
    const recorded: Array<{ observation: string; reason?: string }> = [];
    let durableWrites = 0;
    const adapter = deliveryAdapter(stateRoot, () => {
      durableWrites += 1;
      if (durableWrites === 1) throw new Error("the daemon died before the delivery result was durable");
    });

    await adapter.execute(intent(), adapterContext(recorded));

    expect(recorded).toEqual([expect.objectContaining({
      observation: "failed",
      reason: expect.stringContaining("durable")
    })]);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.candidateSha);
    expect(await refWrites(fixture)).toBe(before + 1);

    // The retry: no durable receipt exists, so the port runs again and its
    // recovery finds the ref already at the final SHA.
    await adapter.execute(intent(), adapterContext(recorded));

    expect(recorded[1]).toMatchObject({ observation: "succeeded" });
    expect(await refWrites(fixture)).toBe(before + 1);
  });
});

async function target(): Promise<Stage10DeliveryTarget> {
  const fixture = await buildDeliveryTargetFixture();
  targets.push(fixture);
  return fixture;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage10-restart-"));
  directories.push(directory);
  return directory;
}

function publish(fixture: Stage10DeliveryTarget) {
  return createCurrentDeliveryPort().publish({
    runId,
    definition: stage10Definition(fixture),
    approval: stage10Approval(fixture),
    projection: stage10Projection(fixture),
    events: []
  });
}

/**
 * How many times the delivery ref was written, identical OIDs included. The
 * fixture's own commits are in the reflog too, so every cell compares against
 * the count it started from.
 */
async function refWrites(fixture: Stage10DeliveryTarget): Promise<number> {
  const reflog = await git(fixture.root, "reflog", "show", "--no-abbrev", "refs/heads/main");
  return reflog.split("\n").filter((line) => line.trim().length > 0).length;
}

function deliveryAdapter(stateRoot: string, onDurableWrite: () => void) {
  const port = createCurrentDeliveryPort();
  const profile = createTransitionalUnsafeProfile({
    stateRoot,
    nodeExecutable: process.execPath,
    workerScriptPath: path.join(stateRoot, "worker.js"),
    cwd: stateRoot,
    planner: { plan: async () => { throw new Error("unused"); } },
    delivery: {
      publish: async (request) => {
        const receipt = await port.publish(request);
        // The physical work is done; the crash is in recording it.
        onDurableWrite();
        return receipt;
      }
    }
  });
  const adapter = profile.adapters.find(({ kind }) => kind === "delivery");
  if (adapter === undefined) throw new Error("The transitional profile has no delivery adapter.");
  return adapter;
}

function intent() {
  return {
    runId,
    attemptId: "stage3:delivery" as const,
    kind: "delivery" as const,
    inputDigest: `sha256:${"a".repeat(64)}`,
    daemonEpoch,
    idempotency: "reconcile_then_repeat" as const,
    requestedAt: stage10At,
    effectId: `sha256:${"b".repeat(64)}`
  };
}

function adapterContext(recorded: Array<{ observation: string; reason?: string }>) {
  return {
    observerDaemonEpoch: daemonEpoch,
    inputSpec: { payload: {} },
    priorReceipts: [],
    record: async (observation: { observation: string; reason?: string }) => {
      recorded.push(observation);
      return {};
    }
  } as never;
}

async function seedRun(stateRoot: string, fixture: Stage10DeliveryTarget): Promise<void> {
  const events = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
  const authority = await events.claimAuthority(runId, "stage10-restart");
  const projection = stage10Projection(fixture);
  await events.bind(authority).append(runId, 0, [
    {
      eventId: `${runId}:created`,
      occurredAt: stage10At,
      type: "run.created",
      payload: {
        goal: stage10Definition(fixture).userPrompt,
        definition: stage10Definition(fixture)
      }
    },
    input("graph.revision.proposed", { graphId: "graph-stage10", revision: 1 }),
    input("graph.revision.approved", { graphId: "graph-stage10", revision: 1 }),
    input("evidence.matrix_recorded", {
      matrix: {
        matrixId: "matrix-stage10",
        candidateCommit: fixture.candidateSha,
        validationContract: { id: "validation-stage10", revision: "revision-1" },
        criteria: [{
          criterionId: "criterion-stage10",
          obligationId: "obligation-stage10",
          status: "satisfied" as const,
          justification: "The validator checked the exact candidate.",
          evidenceRefs: ["evidence-stage10"]
        }],
        outcome: "verified" as const,
        validationRecipeDigest: "sha256:recipe-stage10",
        observations: []
      }
    }),
    input("final_candidate.verified", {
      manifestId: "manifest-stage10",
      commit: fixture.candidateSha,
      evidenceMatrixId: "matrix-stage10",
      evidenceEligible: true,
      executionSucceeded: true,
      sourceTargetFingerprint: projection.finalCandidate!.sourceTargetFingerprint,
      targetBranch: "main",
      targetHead: fixture.baseSha,
      finalManifest: { ...projection.finalCandidate!.finalManifest, artifactIds: [] }
    }),
    input("delivery.started", { approval: stage10Approval(fixture) })
  ]);
}

function input(type: string, payload: Record<string, unknown>): RunEventInput {
  return { eventId: `${runId}:${type}`, occurredAt: stage10At, type, payload } as RunEventInput;
}
