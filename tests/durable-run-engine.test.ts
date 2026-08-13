import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildCommandReceipt,
  buildRunCommandEnvelope,
  type CommandReceipt,
  type RunEvent
} from "@manyhands/run-coordinator";
import { DurableRunEngine } from "../packages/run-engine/src/durable-run-engine.js";

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("DurableRunEngine", () => {
  it("routes a validated command to the one actor for its run", async () => {
    const receipt = commandReceipt();
    const actor = {
      submit: vi.fn(async () => receipt),
      recoverPendingEffects: vi.fn(async () => undefined)
    };
    const getOrCreate = vi.fn(async () => actor);
    const engine = new DurableRunEngine({
      actorRegistry: { getOrCreate },
      eventStore: { load: vi.fn(async () => createdEvents()) },
      assertInstallationAuthority: vi.fn(async () => undefined),
      hasher: sha256
    });
    const command = buildRunCommandEnvelope({
      commandId: "command:1",
      runId: "run:1",
      expectedRevision: 1,
      submittedAt: "2026-08-12T22:00:00.000Z",
      command: { type: "continue" }
    }, sha256);

    await expect(engine.submit(command)).resolves.toEqual(receipt);
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(getOrCreate).toHaveBeenCalledWith("run:1");
    expect(actor.submit).toHaveBeenCalledWith(command);
  });

  it("rejects a tampered command before creating or consulting an actor", async () => {
    const getOrCreate = vi.fn();
    const engine = new DurableRunEngine({
      actorRegistry: { getOrCreate },
      eventStore: { load: vi.fn() },
      assertInstallationAuthority: vi.fn(async () => undefined),
      hasher: sha256
    });
    const command = buildRunCommandEnvelope({
      commandId: "command:tampered",
      runId: "run:1",
      expectedRevision: 1,
      submittedAt: "2026-08-12T22:00:00.000Z",
      command: { type: "continue" }
    }, sha256);

    await expect(engine.submit({ ...command, expectedRevision: 2 }))
      .rejects.toThrow(/invalid canonical identity/i);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it("serves projections and event pages without creating an actor or mutating the journal", async () => {
    const events = createdEvents();
    const load = vi.fn(async () => structuredClone(events));
    const getOrCreate = vi.fn();
    const assertInstallationAuthority = vi.fn(async () => undefined);
    const engine = new DurableRunEngine({
      actorRegistry: { getOrCreate },
      eventStore: { load },
      assertInstallationAuthority,
      hasher: sha256
    });

    const projection = await engine.query("run:1");
    const page = await engine.eventsReady("run:1", 0);

    expect(projection.runId).toBe("run:1");
    expect(projection.sequence).toBe(1);
    expect(page).toEqual({ events, nextSequence: 1 });
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    expect(assertInstallationAuthority).toHaveBeenCalledTimes(4);
  });

  it("fails a read closed when installation authority changes during storage access", async () => {
    let checks = 0;
    const engine = new DurableRunEngine({
      actorRegistry: { getOrCreate: vi.fn() },
      eventStore: { load: vi.fn(async () => createdEvents()) },
      assertInstallationAuthority: vi.fn(async () => {
        checks += 1;
        if (checks === 2) throw new Error("installation lease lost");
      }),
      hasher: sha256
    });

    await expect(engine.query("run:1")).rejects.toThrow(/lease lost/i);
  });

  it("returns only events after a validated sequence cursor", async () => {
    const events: RunEvent[] = [
      ...createdEvents(),
      {
        eventId: "event:cancel",
        runId: "run:1",
        sequence: 2,
        occurredAt: "2026-08-12T22:00:01.000Z",
        type: "operation.cancel_requested",
        payload: { invalidationReceiptId: "receipt:cancel", reason: "operator" }
      }
    ];
    const engine = new DurableRunEngine({
      actorRegistry: { getOrCreate: vi.fn() },
      eventStore: { load: vi.fn(async () => events) },
      assertInstallationAuthority: vi.fn(async () => undefined),
      hasher: sha256
    });

    await expect(engine.eventsReady("run:1", 1)).resolves.toEqual({
      events: [events[1]],
      nextSequence: 2
    });
    await expect(engine.eventsReady("run:1", -1)).rejects.toThrow(/non-negative integer/i);
    await expect(engine.eventsReady("run:1", 3)).rejects.toThrow(/ahead of journal/i);
  });
});

function createdEvents(): RunEvent[] {
  return [{
    eventId: "event:created",
    runId: "run:1",
    sequence: 1,
    occurredAt: "2026-08-12T22:00:00.000Z",
    type: "run.created",
    payload: { goal: "Keep the daemon authoritative" }
  }];
}

function commandReceipt(): CommandReceipt {
  return buildCommandReceipt({
    schemaVersion: 1,
    commandId: "command:1",
    runId: "run:1",
    commandDigest: buildRunCommandEnvelope({
      commandId: "command:1",
      runId: "run:1",
      expectedRevision: 1,
      submittedAt: "2026-08-12T22:00:00.000Z",
      command: { type: "continue" }
    }, sha256).commandDigest,
    acceptedRevision: 2,
    daemonEpoch: "daemon:1",
    acceptedAt: "2026-08-12T22:00:00.000Z"
  }, sha256);
}
