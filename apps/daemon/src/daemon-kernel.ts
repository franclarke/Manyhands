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
  react?: RunActorOptions["react"];
  clock(): string;
  startupRecoveryRunLimit?: number;
  production?: boolean;
  createLeaseNonce?: () => string;
  createDaemonEpoch?: () => string;
  protectCapabilityPath?: IpcCapabilityOsProtection;
  assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  windowsPipeAclHelperPath?: string;
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
  drainEffects(): Promise<void>;
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
        ...(options.protectCapabilityPath === undefined
          ? {}
          : { protectOrVerifyOsRestrictedPath: options.protectCapabilityPath })
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
          ...(options.react === undefined ? {} : { react: options.react }),
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

    const runIds = await eventStore.listRunIds({
      limit: options.startupRecoveryRunLimit ?? 10_000
    });
    for (const runId of runIds) {
      await registry.getOrCreate(runId);
    }
    await lease.assertCurrent();

    server = await startLocalIpcServer({
      endpoint: options.endpoint,
      capabilityFilePath: capability.filePath,
      production,
      handlers: {
        async submit(command) {
          return asIpcJson(await engine.submit(command));
        },
        async query(input) {
          if (input.query === "projection" && input.arguments === undefined) {
            return asIpcJson(await engine.query(input.runId));
          }
          if (input.query === "list") {
            if (input.runId !== "installation:runs") {
              throw new Error("The list query must use the installation:runs scope.");
            }
            return asIpcJson(await listRunProjections(eventStore, engine, input.arguments));
          }
          throw new Error(`Unsupported daemon query ${input.query}.`);
        },
        async eventsReady(input) {
          return asIpcJson(await engine.eventsReady(input.runId, input.afterSequence));
        }
      },
      ...(options.assertOsRestrictedCapabilityPath === undefined
        ? {}
        : { assertOsRestrictedCapabilityPath: options.assertOsRestrictedCapabilityPath }),
      ...(options.windowsPipeAclHelperPath === undefined
        ? {}
        : { windowsPipeAclHelperPath: options.windowsPipeAclHelperPath }),
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
    async drainEffects(): Promise<void> {
      const drained = await Promise.allSettled(
        [...input.actors].map((actor) => actor.drainEffects())
      );
      const failures = drained
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Daemon effects failed.");
    },
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

async function listRunProjections(
  eventStore: JsonlRunEventStore,
  engine: DurableRunEngine,
  argumentsValue: IpcJsonValue | undefined
): Promise<IpcJsonValue> {
  const argumentsRecord = argumentsValue === undefined
    ? {}
    : IpcJsonValueSchema.parse(argumentsValue) as Record<string, IpcJsonValue>;
  if (Array.isArray(argumentsRecord) || argumentsRecord === null) {
    throw new TypeError("Run list arguments must be an object.");
  }
  const allowed = new Set(["workspaceId", "includeArchived", "statuses", "limit"]);
  if (Object.keys(argumentsRecord).some((key) => !allowed.has(key))) {
    throw new TypeError("Run list arguments contain an unsupported field.");
  }
  const workspaceId = optionalString(argumentsRecord.workspaceId, "workspaceId");
  const includeArchived = optionalBoolean(argumentsRecord.includeArchived, "includeArchived") ?? false;
  const statuses = optionalStringArray(argumentsRecord.statuses, "statuses");
  const limit = optionalPositiveInteger(argumentsRecord.limit, "limit") ?? 50;
  const runIds = await eventStore.listRunIds({ limit: 100_000 });
  const projections = await Promise.all(runIds.map((runId) => engine.query(runId)));
  return projections
    .filter((projection) => projection.definition !== undefined)
    .filter((projection) => workspaceId === undefined || projection.definition?.workspaceId === workspaceId)
    .filter((projection) => includeArchived || projection.archivedAt === undefined)
    .filter((projection) => statuses === undefined || statuses.includes(projection.lifecycle))
    .sort((left, right) => {
      const leftAt = left.createdAt;
      const rightAt = right.createdAt;
      return rightAt.localeCompare(leftAt) || left.runId.localeCompare(right.runId);
    })
    .slice(0, limit) as unknown as IpcJsonValue;
}

function optionalString(value: IpcJsonValue | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalBoolean(value: IpcJsonValue | undefined, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean.`);
  return value;
}

function optionalPositiveInteger(value: IpcJsonValue | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}

function optionalStringArray(value: IpcJsonValue | undefined, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function asIpcJson(value: unknown): IpcJsonValue {
  return IpcJsonValueSchema.parse(value);
}

function assertAbsoluteStateRoot(stateRoot: string): string {
  if (!path.isAbsolute(stateRoot)) throw new TypeError("Daemon state root must be an absolute path.");
  return path.resolve(stateRoot);
}
