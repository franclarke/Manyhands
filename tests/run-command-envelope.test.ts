import { describe, expect, it } from "vitest";
import {
  RunCommandEnvelopeSchema,
  buildRunCommandEnvelope,
  classifyRunCommandReplay,
  validateRunCommandEnvelopeIdentity,
  type DigestHasher
} from "@manyhands/run-coordinator";

describe("run command envelope", () => {
  it("builds a strict v1 envelope whose digest covers only the canonical command identity", () => {
    const hashedValues: string[] = [];
    const inspectHasher: DigestHasher = (value) => {
      hashedValues.push(value);
      return "digest:stable";
    };

    const first = buildRunCommandEnvelope({
      commandId: "command:first-delivery",
      runId: "run:alpha",
      expectedRevision: 12,
      submittedAt: "2026-08-12T15:00:00.000Z",
      command: { type: "pause", reason: "Maintenance" }
    }, inspectHasher);
    const retransmission = buildRunCommandEnvelope({
      commandId: "command:transport-retry",
      runId: "run:alpha",
      expectedRevision: 12,
      submittedAt: "2026-08-12T15:00:01.000Z",
      command: { reason: "Maintenance", type: "pause" }
    }, inspectHasher);

    expect(hashedValues).toEqual([
      '{"command":{"reason":"Maintenance","type":"pause"},"expectedRevision":12,"runId":"run:alpha","schemaVersion":1}',
      '{"command":{"reason":"Maintenance","type":"pause"},"expectedRevision":12,"runId":"run:alpha","schemaVersion":1}'
    ]);
    expect(first).toEqual({
      schemaVersion: 1,
      commandId: "command:first-delivery",
      runId: "run:alpha",
      expectedRevision: 12,
      submittedAt: "2026-08-12T15:00:00.000Z",
      command: { type: "pause", reason: "Maintenance" },
      commandDigest: "digest:stable"
    });
    expect(retransmission.commandDigest).toBe(first.commandDigest);
    expect(RunCommandEnvelopeSchema.safeParse({ ...first, transportRetry: 1 }).success).toBe(false);
    expect(RunCommandEnvelopeSchema.safeParse({ ...first, schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects an envelope whose identity material changed after digesting", () => {
    const hasher: DigestHasher = (value) => `digest:${value}`;
    const envelope = buildRunCommandEnvelope({
      commandId: "command:pause",
      runId: "run:alpha",
      expectedRevision: 12,
      submittedAt: "2026-08-12T15:00:00.000Z",
      command: { type: "pause", reason: "Maintenance" }
    }, hasher);

    expect(validateRunCommandEnvelopeIdentity(envelope, hasher)).toEqual({ ok: true, issues: [] });
    expect(validateRunCommandEnvelopeIdentity({
      ...envelope,
      expectedRevision: 13
    }, hasher)).toEqual({
      ok: false,
      issues: [{
        code: "command_digest_mismatch",
        message: "commandDigest does not identify the canonical run command identity"
      }]
    });
    expect(validateRunCommandEnvelopeIdentity({ ...envelope, unexpected: true }, hasher)).toEqual({
      ok: false,
      issues: [{ code: "schema_invalid", message: "run command envelope does not match schema version 1" }]
    });
  });

  it("classifies first delivery, identical replay and commandId reuse with different content", () => {
    const hasher: DigestHasher = (value) => `digest:${value}`;
    const original = buildRunCommandEnvelope({
      commandId: "command:pause",
      runId: "run:alpha",
      expectedRevision: 12,
      submittedAt: "2026-08-12T15:00:00.000Z",
      command: { type: "pause", reason: "Maintenance" }
    }, hasher);
    const duplicate = buildRunCommandEnvelope({
      commandId: original.commandId,
      runId: original.runId,
      expectedRevision: original.expectedRevision,
      submittedAt: "2026-08-12T15:01:00.000Z",
      command: original.command
    }, hasher);
    const conflict = buildRunCommandEnvelope({
      commandId: original.commandId,
      runId: original.runId,
      expectedRevision: original.expectedRevision,
      submittedAt: "2026-08-12T15:02:00.000Z",
      command: { type: "resume", reason: "Changed intent" }
    }, hasher);

    expect(classifyRunCommandReplay(undefined, original, hasher)).toEqual({
      kind: "new",
      envelope: original
    });
    expect(classifyRunCommandReplay(original, duplicate, hasher)).toEqual({
      kind: "duplicate",
      envelope: original
    });
    expect(classifyRunCommandReplay(original, conflict, hasher)).toEqual({
      kind: "conflict",
      commandId: original.commandId,
      existingCommandDigest: original.commandDigest,
      incomingCommandDigest: conflict.commandDigest
    });
  });
});
