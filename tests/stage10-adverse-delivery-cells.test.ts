import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DeliveryRecoveryError, MANYHANDS_RUNTIME_DIRECTORY } from "@manyhands/execution-core";

import { createCurrentDeliveryPort } from "../apps/daemon/src/current-lifecycle-adapters.js";

import {
  buildDeliveryTargetFixture,
  git,
  removeDeliveryTargetFixture,
  stage10Approval,
  stage10Definition,
  stage10Projection,
  type Stage10DeliveryTarget
} from "./helpers/stage10-delivery-fixture.js";

const targets: Stage10DeliveryTarget[] = [];

afterEach(async () => {
  await Promise.all(targets.splice(0).map(removeDeliveryTargetFixture));
});

/**
 * R12: a target that is not the one that was approved publishes nothing.
 *
 * The two divergence flavours are separate cells on purpose. An unrelated
 * commit was already refused by the old check; a branch that advanced to an
 * ancestor of the candidate was not, because `merge --ff-only` succeeds there.
 * Collapsing them into one case would hide the half that used to pass.
 */
describe("Adverse delivery cells", () => {
  it("R12a: an unrelated target publishes nothing", async () => {
    const fixture = await target();
    await git(fixture.root, "reset", "--hard", fixture.unrelatedSha);

    const error = await publish(fixture).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryRecoveryError);
    expect((error as DeliveryRecoveryError).diagnostic).toMatchObject({
      kind: "target_divergence",
      expectedOid: fixture.baseSha,
      actualOid: fixture.unrelatedSha
    });
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.unrelatedSha);
  });

  it("R12b: a target that advanced to an ancestor of the candidate publishes nothing", async () => {
    const fixture = await target();
    await git(fixture.root, "reset", "--hard", fixture.midSha);
    // The case that made this cell necessary: the candidate is still reachable.
    expect(await isAncestor(fixture, fixture.midSha, fixture.candidateSha)).toBe(true);

    const error = await publish(fixture).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryRecoveryError);
    expect((error as DeliveryRecoveryError).diagnostic).toMatchObject({
      kind: "target_divergence",
      expectedOid: fixture.baseSha,
      actualOid: fixture.midSha
    });
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.midSha);
  });

  it("R12c: a user modification blocks delivery", async () => {
    const fixture = await target();
    await writeFile(path.join(fixture.root, "result.txt"), "uncommitted user work\n", "utf8");

    await expect(publish(fixture)).rejects.toThrow(/dirty/iu);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.baseSha);
  });

  it("R12c: an untracked user file blocks delivery", async () => {
    const fixture = await target();
    await writeFile(path.join(fixture.root, "notes.md"), "scratch\n", "utf8");

    await expect(publish(fixture)).rejects.toThrow(/dirty/iu);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.baseSha);
  });

  it("R12c: the orchestrator's own runtime directory does not block delivery", async () => {
    // ManyHands materializes its worktree pool and run state under the target.
    // Refusing to publish because of its own files would make delivery
    // impossible in exactly the repositories it runs in.
    const fixture = await target();
    await mkdir(path.join(fixture.root, MANYHANDS_RUNTIME_DIRECTORY), { recursive: true });
    await writeFile(path.join(fixture.root, MANYHANDS_RUNTIME_DIRECTORY, "state.json"), "{}\n", "utf8");

    const receipt = await publish(fixture);

    expect(receipt.targetHeadAfter).toBe(fixture.candidateSha);
  });
});

async function target(): Promise<Stage10DeliveryTarget> {
  const fixture = await buildDeliveryTargetFixture();
  targets.push(fixture);
  return fixture;
}

function publish(fixture: Stage10DeliveryTarget) {
  return createCurrentDeliveryPort().publish({
    runId: "run:stage10-adverse",
    definition: stage10Definition(fixture),
    approval: stage10Approval(fixture),
    projection: stage10Projection(fixture),
    events: []
  });
}

async function isAncestor(
  fixture: Stage10DeliveryTarget,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  return git(fixture.root, "merge-base", "--is-ancestor", ancestor, descendant)
    .then(() => true)
    .catch(() => false);
}
