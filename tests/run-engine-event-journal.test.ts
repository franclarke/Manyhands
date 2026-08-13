import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher
} from "@manyhands/contracts";
import { buildRunCommandEnvelope } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, StaleFencingTokenError } from "@manyhands/run-store";
import { FencedRunActorJournal, RunActor } from "@manyhands/run-engine";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FencedRunActorJournal", () => {
  it("persists command, intent and physical receipt through the canonical event store", async () => {
    const { store, journal } = await fixture("epoch:1");
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (_command, context) => [buildEffectIntent({
        runId: context.runId,
        attemptId: "attempt:1",
        kind: "process_spawn",
        inputDigest: "sha256:input",
        daemonEpoch: context.daemonEpoch,
        idempotency: "reconcile_then_repeat",
        requestedAt: "2026-08-12T20:00:01.000Z"
      }, sha256)],
      dispatcher: {
        async observe(intent) {
          return [buildPhysicalEffectReceipt({
            effectId: intent.effectId,
            observation: "succeeded",
            inputDigest: intent.inputDigest,
            daemonEpoch: "epoch:1",
            resultDigest: "sha256:result",
            observedAt: "2026-08-12T20:00:02.000Z"
          }, sha256)];
        },
        async reconcile() {
          throw new Error("no recovery expected");
        }
      }
    });
    const envelope = buildRunCommandEnvelope({
      commandId: "command:1",
      runId: "run:1",
      expectedRevision: 1,
      submittedAt: "2026-08-12T19:59:59.000Z",
      command: { type: "start" }
    }, sha256);

    const accepted = await actor.submit(envelope);
    const replayed = await actor.submit(envelope);
    const events = await new JsonlRunEventStore({ directory: store.directory }).load("run:1");

    expect(replayed).toEqual(accepted);
    expect(events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted",
      "effect.requested",
      "effect.observed"
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("rejects a journal after a successor daemon takes the run fence", async () => {
    const { store, journal } = await fixture("epoch:old");
    await store.claimAuthority("run:1", "epoch:new");

    await expect(journal.assertAuthority("run:1", "epoch:old"))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });
});

async function fixture(daemonEpoch: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-journal-"));
  directories.push(directory);
  const store = new JsonlRunEventStore({ directory });
  const authority = await store.claimAuthority("run:1", daemonEpoch);
  await store.appendFenced("run:1", 0, authority, [{
    eventId: "event:created",
    occurredAt: "2026-08-12T19:00:00.000Z",
    type: "run.created",
    payload: { goal: "Build safely" }
  }]);
  return {
    store,
    journal: new FencedRunActorJournal({
      runId: "run:1",
      daemonEpoch,
      authority,
      store
    })
  };
}
