import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

/**
 * Stage 10 makes the approved head the condition of the write itself. That is
 * only true while there is exactly one way to move the delivery ref: a second
 * writer would reintroduce the check-then-act window without anyone noticing,
 * because every existing delivery test would still pass.
 *
 * The guard is reachability, not absence of the word "merge".
 */
describe("Delivery ref write reachability", () => {
  it("moves the delivery ref only through a conditional update", async () => {
    const adapters = await source("apps/daemon/src/current-lifecycle-adapters.ts");
    const port = adapters.slice(adapters.indexOf("export function createCurrentDeliveryPort"));

    expect(port).toContain('"update-ref"');
    // The old write, matched as argv tokens so the comment explaining why it
    // was removed does not itself trip the guard. `merge --ff-only` succeeds
    // for any head the candidate is reachable from, which is not the same as
    // the head that was approved.
    expect(port).not.toContain('"merge"');
    expect(port).not.toContain('"--ff-only"');
  });

  it("passes the approved head as the expected old OID", async () => {
    const adapters = await source("apps/daemon/src/current-lifecycle-adapters.ts");
    const update = adapters.slice(adapters.indexOf('"update-ref"'), adapters.indexOf('"update-ref"') + 320);

    expect(update).toContain("request.finalSha");
    expect(update).toContain("request.targetHead");
  });

  it("keeps every other productive source out of the delivery ref", async () => {
    // A delivery write outside the port would bypass both the approval and the
    // compare-and-swap.
    for (const relative of [
      "apps/daemon/src/product-run-application.ts",
      "apps/daemon/src/transitional-unsafe-profile.ts",
      "apps/daemon/src/transitional-unsafe-worker.ts",
      "packages/run-coordinator/src/coordinator.ts"
    ]) {
      expect(await source(relative), relative).not.toContain("update-ref");
    }
  });
});
