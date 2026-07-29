import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlRunEventStore, RunSnapshotStore, StaleFencingTokenError } from "@manyhands/run-store";

const at = "2026-07-17T12:00:00.000Z";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-fence-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("run mutation fencing", () => {
  it("prevents a stale owner from appending events, snapshots or delivery receipts", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const stale = { operationId: "planning-old", fencingToken: 1 };
    const current = { operationId: "planning-new", fencingToken: 2 };
    await events.advanceFence("run-1", stale);
    await events.appendFenced("run-1", 0, stale, [{ eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }]);
    await events.advanceFence("run-1", current);

    await expect(events.appendFenced("run-1", 1, stale, [{ eventId: "late-graph", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } }]))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
    await expect(snapshots.write("run-1", stale, { runId: "run-1", marker: "late" }, 1, "created"))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
    await expect(events.appendFenced("run-1", 1, stale, [{ eventId: "late-receipt", occurredAt: at, type: "delivery.published", payload: { receipt: { receiptId: "receipt-1", manifestId: "manifest-1", destination: "main", confirmed: true } } }]))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });

  it("does not allow equal fencing tokens to be stolen by another operation", async () => {
    const store = new JsonlRunEventStore({ directory });
    await store.advanceFence("run-1", { operationId: "owner-a", fencingToken: 4 });
    await expect(store.advanceFence("run-1", { operationId: "owner-b", fencingToken: 4 }))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });

  it("atomically mints one monotonic authority across independent store instances", async () => {
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        new JsonlRunEventStore({ directory }).claimAuthority(
          "run-concurrent-claim",
          `owner-${index}`,
          20
        )
      )
    );
    const tokens = claims.map((claim) => claim.fencingToken).sort((left, right) => left - right);
    expect(tokens).toEqual(Array.from({ length: 12 }, (_, index) => 21 + index));

    const winner = claims.find((claim) => claim.fencingToken === 32)!;
    const loser = claims.find((claim) => claim.fencingToken !== 32)!;
    const store = new JsonlRunEventStore({ directory });
    await expect(store.assertAuthority("run-concurrent-claim", winner)).resolves.toBeUndefined();
    await expect(store.assertAuthority("run-concurrent-claim", loser))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });
});
