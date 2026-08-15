import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DeliveryRecoveryError } from "@manyhands/execution-core";

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

async function target(): Promise<Stage10DeliveryTarget> {
  const fixture = await buildDeliveryTargetFixture();
  targets.push(fixture);
  return fixture;
}

/** The target keeps its own `core.autocrlf`, so compare content, not bytes. */
async function deliveredContent(fixture: Stage10DeliveryTarget): Promise<string> {
  const content = await readFile(path.join(fixture.root, "result.txt"), "utf8");
  return content.replaceAll("\r\n", "\n").trim();
}

function publish(fixture: Stage10DeliveryTarget) {
  return createCurrentDeliveryPort().publish({
    runId: "run:stage10-delivery",
    definition: stage10Definition(fixture),
    approval: stage10Approval(fixture),
    projection: stage10Projection(fixture),
    events: []
  });
}

/**
 * Publication was a check followed by `git merge --ff-only`, which is two
 * processes with a window between them and, worse, a write whose only condition
 * is reachability. A branch that advanced to any ancestor of the candidate
 * fast-forwards happily — so a target nobody approved could be delivered onto,
 * and the receipt would still claim the approved head.
 *
 * `git update-ref <ref> <new> <old>` makes the approved head the condition of
 * the write itself.
 */
describe("Delivery transaction boundary", () => {
  it("publishes the approved candidate onto the approved head", async () => {
    const fixture = await target();

    const receipt = await publish(fixture);

    expect(receipt).toMatchObject({
      finalSha: fixture.candidateSha,
      targetHeadBefore: fixture.baseSha,
      targetHeadAfter: fixture.candidateSha,
      disposition: "delivered",
      confirmed: true
    });
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.candidateSha);
    // The ref moving is not delivery on its own: the checkout has to hold the
    // delivered content, or the operator sees a tree that no receipt describes.
    expect(await git(fixture.root, "status", "--porcelain")).toBe("");
    expect(await deliveredContent(fixture)).toBe("candidate");
  });

  it("refuses a target that advanced to another ancestor of the final SHA", async () => {
    const fixture = await target();
    // `mid` is an ancestor of the candidate, so `merge --ff-only` accepts it.
    await git(fixture.root, "reset", "--hard", fixture.midSha);

    await expect(publish(fixture)).rejects.toThrow();
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.midSha);
  });

  it("reports a typed diagnostic naming both OIDs when the target diverged", async () => {
    const fixture = await target();
    await git(fixture.root, "reset", "--hard", fixture.unrelatedSha);

    const error = await publish(fixture).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryRecoveryError);
    const diagnostic = (error as DeliveryRecoveryError).diagnostic;
    expect(diagnostic).toEqual({
      kind: "target_divergence",
      ref: "refs/heads/main",
      expectedOid: fixture.baseSha,
      actualOid: fixture.unrelatedSha
    });
    // The operator-facing line is what reaches the journal as the failure
    // reason, so it has to carry the evidence too.
    expect((error as Error).message).toContain(fixture.baseSha);
    expect((error as Error).message).toContain(fixture.unrelatedSha);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.unrelatedSha);
  });

  it("recovers a ref that already holds the final SHA into one receipt", async () => {
    const fixture = await target();

    const first = await publish(fixture);
    const recovered = await publish(fixture);

    expect(recovered).toEqual(first);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(fixture.candidateSha);
  });

  it("completes a delivery interrupted between the ref update and the checkout", async () => {
    const fixture = await target();
    // Exactly the post-CAS crash: the ref moved, the working tree did not.
    await git(fixture.root, "update-ref", "refs/heads/main", fixture.candidateSha, fixture.baseSha);
    expect(await git(fixture.root, "status", "--porcelain")).not.toBe("");

    const receipt = await publish(fixture);

    expect(receipt.targetHeadAfter).toBe(fixture.candidateSha);
    expect(await git(fixture.root, "status", "--porcelain")).toBe("");
    expect(await deliveredContent(fixture)).toBe("candidate");
  });

  it("refuses to reconcile a tree carrying work that is not the delivery", async () => {
    const fixture = await target();
    await git(fixture.root, "update-ref", "refs/heads/main", fixture.candidateSha, fixture.baseSha);
    // A user edit on top of the interrupted state. Resetting would destroy it,
    // and no receipt could honestly describe what was delivered.
    await writeFile(path.join(fixture.root, "result.txt"), "operator edit\n", "utf8");

    await expect(publish(fixture)).rejects.toThrow();
  });
});
