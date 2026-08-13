import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EffectKindSchema, type DigestHasher } from "@manyhands/contracts";
import {
  CommandReceiptSchema,
  buildRunCommandEnvelope,
  type IpcCapabilityOsProtection,
  type RunCommandEnvelope
} from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { startDaemonKernel } from "../apps/daemon/src/daemon-kernel.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const temporaryRoots: string[] = [];
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("durable daemon composition root", () => {
  it("survives client and daemon restarts without inventing lifecycle events", async () => {
    const root = await temporaryRoot();
    await seedRun(root, "run:kernel");
    const first = await startKernel(root, "daemon:epoch-1");
    const firstClient = createLocalIpcClient({
      endpoint: first.endpoint,
      capabilityFilePath: first.capabilityFilePath,
      production: false
    });
    const command = commandEnvelope();

    const accepted = CommandReceiptSchema.parse(await firstClient.submit(command));
    expect(accepted.commandId).toBe(command.commandId);
    expect((await firstClient.query({ runId: "run:kernel", query: "projection" })))
      .toMatchObject({ runId: "run:kernel", sequence: 2 });

    const replacementClient = createLocalIpcClient({
      endpoint: first.endpoint,
      capabilityFilePath: first.capabilityFilePath,
      production: false
    });
    expect((await replacementClient.eventsReady({ runId: "run:kernel", afterSequence: 1 })))
      .toMatchObject({ nextSequence: 2, events: [{ type: "command.accepted" }] });
    expect((await first.eventStore.load("run:kernel"))).toHaveLength(2);
    await first.close();

    const second = await startKernel(root, "daemon:epoch-2");
    try {
      const secondClient = createLocalIpcClient({
        endpoint: second.endpoint,
        capabilityFilePath: second.capabilityFilePath,
        production: false
      });
      const replay = CommandReceiptSchema.parse(await secondClient.submit(command));
      expect(replay).toEqual(accepted);
      expect((await secondClient.query({ runId: "run:kernel", query: "projection" })))
        .toMatchObject({ sequence: 2 });
      expect((await second.eventStore.load("run:kernel"))).toHaveLength(2);
    } finally {
      await second.close();
    }
  });

  it("refuses a second daemon while the installation lease is live", async () => {
    const root = await temporaryRoot();
    const first = await startKernel(root, "daemon:owner-1");
    try {
      await expect(startKernel(root, "daemon:owner-2")).rejects.toThrow(/unavailable \(same\)/i);
    } finally {
      await first.close();
    }
  });

  it("does not expose unsupported query operations over IPC", async () => {
    const root = await temporaryRoot();
    await seedRun(root, "run:kernel");
    const kernel = await startKernel(root, "daemon:query");
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      await expect(client.query({ runId: "run:kernel", query: "mutate_cache" }))
        .rejects.toMatchObject({ code: "request_failed" });
      expect((await kernel.eventStore.load("run:kernel"))).toHaveLength(1);
    } finally {
      await kernel.close();
    }
  });

  it("separates Windows capability protection from later verification", async () => {
    if (process.platform !== "win32") return;
    const root = await temporaryRoot();
    const protectedPaths: string[] = [];
    const verifiedPaths: string[] = [];
    const protect: IpcCapabilityOsProtection = async (targetPath, kind) => {
      protectedPaths.push(`${kind}:${targetPath}`);
    };
    const verify: IpcCapabilityOsProtection = async (targetPath, kind) => {
      verifiedPaths.push(`${kind}:${targetPath}`);
    };

    const kernel = await startKernel(root, "daemon:acl", {
      production: true,
      protectCapabilityPath: protect,
      assertOsRestrictedCapabilityPath: verify,
      assertOsRestrictedEndpoint: async () => undefined
    });
    try {
      expect(protectedPaths.map((entry) => entry.split(":", 1)[0])).toEqual([
        "directory",
        "file",
        "directory",
        "file"
      ]);
      expect(verifiedPaths.map((entry) => entry.split(":", 1)[0])).toEqual([
        "directory",
        "file"
      ]);
    } finally {
      await kernel.close();
    }
  });
});

interface StartKernelOverrides {
  production?: boolean;
  protectCapabilityPath?: IpcCapabilityOsProtection;
  assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  assertOsRestrictedEndpoint?: (endpoint: string) => void | Promise<void>;
}

async function startKernel(
  root: string,
  daemonEpoch: string,
  overrides: StartKernelOverrides = {}
) {
  return startDaemonKernel({
    stateRoot: root,
    endpoint: `\\\\.\\pipe\\manyhands-kernel-${randomUUID()}`,
    processStartIdentity: "test-process:start-1",
    processIdentityProbe: {
      async probe(owner) {
        return owner.pid === process.pid && owner.processStartIdentity === "test-process:start-1"
          ? "same"
          : "dead";
      }
    },
    createDaemonEpoch: () => daemonEpoch,
    createLeaseNonce: () => `nonce:${daemonEpoch}`,
    production: false,
    adapters: noEffectAdapters(),
    decide: () => [],
    hasher: sha256,
    clock: () => "2026-08-12T22:30:00.000Z",
    ...overrides
  });
}

function noEffectAdapters(): PhysicalEffectAdapter[] {
  return EffectKindSchema.options.map((kind) => ({
    kind,
    async execute() {
      throw new Error(`Unexpected ${kind} execution in daemon composition test.`);
    },
    async reconcile() {
      throw new Error(`Unexpected ${kind} reconciliation in daemon composition test.`);
    }
  }));
}

async function seedRun(root: string, runId: string): Promise<void> {
  const store = new JsonlRunEventStore({ directory: path.join(root, "runs") });
  const authority = await store.claimAuthority(runId, "seed");
  await store.appendFenced(runId, 0, authority, [{
    eventId: "event:created",
    occurredAt: "2026-08-12T22:00:00.000Z",
    type: "run.created",
    payload: { goal: "Survive the daemon restart" }
  }]);
}

function commandEnvelope(): RunCommandEnvelope {
  return buildRunCommandEnvelope({
    commandId: "command:continue",
    runId: "run:kernel",
    expectedRevision: 1,
    submittedAt: "2026-08-12T22:30:00.000Z",
    command: { type: "continue" }
  }, sha256);
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-daemon-kernel-"));
  temporaryRoots.push(root);
  return root;
}
