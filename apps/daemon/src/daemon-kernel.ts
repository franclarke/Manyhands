import path from "node:path";

import type { DigestHasher } from "@manyhands/contracts";
import {
  IpcJsonValueSchema,
  type IpcCapabilityOsProtection,
  type IpcJsonValue
} from "@manyhands/run-coordinator";
import {
  DurableRunEngine,
  FencedRunActorJournal,
  KindAwarePhysicalEffectDispatcher,
  RunActor,
  RunActorRegistry,
  type PhysicalEffectAdapter,
  type RunActorOptions
} from "@manyhands/run-engine";
import {
  FileEffectInputStore,
  FilePhysicalEffectReceiptStore,
  JsonlRunEventStore,
  type FencingAuthority
} from "@manyhands/run-store";
import {
  acquireInstallationLease,
  type InstallationLease,
  type ProcessIdentityProbe
} from "./installation-lease.js";
import { ensureInstallationCapability } from "./installation-capability.js";
import {
  startLocalIpcServer,
  type LocalIpcServer,
  type LocalIpcTransportSecurity
} from "./local-ipc-server.js";

export interface StartDaemonKernelOptions {
  stateRoot: string;
  endpoint: string;
  processStartIdentity: string;
  processIdentityProbe: ProcessIdentityProbe;
  hasher: DigestHasher;
  adapters: readonly PhysicalEffectAdapter[];
  decide: RunActorOptions["decide"];
  clock(): string;
  production?: boolean;
  createLeaseNonce?: () => string;
  createDaemonEpoch?: () => string;
  protectOrVerifyCapabilityPath?: IpcCapabilityOsProtection;
  assertOsRestrictedEndpoint?: (endpoint: string) => void | Promise<void>;
  ipcNow?: () => number;
  onIpcError?: (error: Error) => void;
}

export interface DaemonKernel {
  readonly endpoint: string;
  readonly capabilityFilePath: string;
  readonly daemonEpoch: string;
  readonly transportSecurity: LocalIpcTransportSecurity;
  readonly eventStore: JsonlRunEventStore;
  readonly engine: DurableRunEngine;
  close(): Promise<void>;
}

/**
 * Privileged local composition root. It is intentionally the only place that
 * combines the installation lease, per-run fences, canonical journal, effect
 * stores, actors and authenticated transport.
 */
export async function startDaemonKernel(
  options: StartDaemonKernelOptions
): Promise<DaemonKernel> {
  const stateRoot = assertAbsoluteStateRoot(options.stateRoot);
  const production = options.production ?? process.env.NODE_ENV === "production";
  const lease = await acquireInstallationLease(path.join(stateRoot, "daemon.lease"), {
    processStartIdentity: options.processStartIdentity,
    processIdentityProbe: options.processIdentityProbe,
    ...(options.createLeaseNonce === undefined ? {} : { createNonce: options.createLeaseNonce }),
    ...(options.createDaemonEpoch === undefined ? {} : { createDaemonEpoch: options.createDaemonEpoch })
  });

  let server: LocalIpcServer | undefined;
  try {
    const capability = await ensureInstallationCapability(
      path.join(stateRoot, "installation"),
      {
        production,
        ...(options.protectOrVerifyCapabilityPath === undefined
          ? {}
          : { protectOrVerifyOsRestrictedPath: options.protectOrVerifyCapabilityPath })
      }
    );
    const eventStore = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
    const inputStore = new FileEffectInputStore({
      directory: path.join(stateRoot, "effects", "inputs"),
      hasher: options.hasher
    });
    const receiptStore = new FilePhysicalEffectReceiptStore({
      directory: path.join(stateRoot, "effects", "receipts"),
      hasher: options.hasher
    });
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      inputStore,
      receiptStore,
      hasher: options.hasher,
      adapters: options.adapters
    });
    const actors = new Set<RunActor>();
    const registry = new RunActorRegistry<RunActor, FencingAuthority>({
      assertInstallationAuthority: () => lease.assertCurrent(),
      claimRunAuthority: (runId) => eventStore.claimAuthority(runId, lease.owner.daemonEpoch),
      createActor: (runId, authority) => {
        const journal = new FencedRunActorJournal({
          runId,
          daemonEpoch: lease.owner.daemonEpoch,
          authority,
          store: eventStore,
          assertInstallationAuthority: () => lease.assertCurrent()
        });
        const actor = new RunActor({
          runId,
          daemonEpoch: lease.owner.daemonEpoch,
          journal,
          dispatcher,
          inputStore,
          decide: options.decide,
          hasher: options.hasher,
          clock: options.clock
        });
        actors.add(actor);
        return actor;
      }
    });
    const engine = new DurableRunEngine({
      actorRegistry: registry,
      eventStore,
      assertInstallationAuthority: () => lease.assertCurrent(),
      hasher: options.hasher
    });

    server = await startLocalIpcServer({
      endpoint: options.endpoint,
      capabilityFilePath: capability.filePath,
      production,
      handlers: {
        async submit(command) {
          return asIpcJson(await engine.submit(command));
        },
        async query(input) {
          if (input.query !== "projection" || input.arguments !== undefined) {
            throw new Error(`Unsupported daemon query ${input.query}.`);
          }
          return asIpcJson(await engine.query(input.runId));
        },
        async eventsReady(input) {
          return asIpcJson(await engine.eventsReady(input.runId, input.afterSequence));
        }
      },
      ...(options.protectOrVerifyCapabilityPath === undefined
        ? {}
        : { assertOsRestrictedCapabilityPath: options.protectOrVerifyCapabilityPath }),
      ...(options.assertOsRestrictedEndpoint === undefined
        ? {}
        : { assertOsRestrictedEndpoint: options.assertOsRestrictedEndpoint }),
      ...(options.ipcNow === undefined ? {} : { now: options.ipcNow }),
      ...(options.onIpcError === undefined ? {} : { onError: options.onIpcError })
    });

    return createKernelHandle({
      server,
      lease,
      actors,
      eventStore,
      engine,
      capabilityFilePath: capability.filePath
    });
  } catch (error) {
    await server?.close().catch(() => undefined);
    await lease.release().catch(() => undefined);
    throw error;
  }
}

function createKernelHandle(input: {
  server: LocalIpcServer;
  lease: InstallationLease;
  actors: Set<RunActor>;
  eventStore: JsonlRunEventStore;
  engine: DurableRunEngine;
  capabilityFilePath: string;
}): DaemonKernel {
  let closed = false;
  return Object.freeze({
    endpoint: input.server.endpoint,
    capabilityFilePath: input.capabilityFilePath,
    daemonEpoch: input.lease.owner.daemonEpoch,
    transportSecurity: input.server.transportSecurity,
    eventStore: input.eventStore,
    engine: input.engine,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const failures: unknown[] = [];
      try {
        await input.server.close();
      } catch (error) {
        failures.push(error);
      }
      const drained = await Promise.allSettled(
        [...input.actors].map((actor) => actor.drainEffects())
      );
      failures.push(...drained
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason));
      try {
        await input.lease.release();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Daemon shutdown failed.");
    }
  });
}

function asIpcJson(value: unknown): IpcJsonValue {
  return IpcJsonValueSchema.parse(value);
}

function assertAbsoluteStateRoot(stateRoot: string): string {
  if (!path.isAbsolute(stateRoot)) throw new TypeError("Daemon state root must be an absolute path.");
  return path.resolve(stateRoot);
}
