import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalJson, type DigestHasher } from "@manyhands/contracts";
import {
  ProductRunCommandSchema,
  RunCommandEnvelopeSchema,
  RunEventSchema,
  buildRunCommandEnvelope,
  type IpcJsonValue,
  type ProductRunCommand,
  type RunCommandEnvelope,
  type RunCommandPayload,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";

import {
  LocalIpcRemoteError,
  createLocalIpcClient,
  type LocalIpcClient
} from "./local-ipc-client";

const execFileAsync = promisify(execFile);

export interface DaemonEventPage {
  events: RunEvent[];
  nextSequence: number;
}

export function commandIdForRequest(request: Request): string {
  const supplied = request.headers.get("idempotency-key")
    ?? request.headers.get("x-manyhands-command-id");
  return supplied === null || supplied.trim().length === 0
    ? `command:${randomUUID()}`
    : `command:${createHash("sha256").update(supplied, "utf8").digest("hex")}`;
}

export function runIdForCreateCommand(commandId: string): string {
  return `run:${createHash("sha256").update(commandId, "utf8").digest("hex")}`;
}

export async function queryProductRun(runId: string): Promise<RunProjection> {
  return parseProjection(await client().query({ runId, query: "projection" }));
}

export async function listProductRuns(argumentsValue: {
  workspaceId?: string;
  includeArchived?: boolean;
  statuses?: string[];
  limit?: number;
} = {}): Promise<RunProjection[]> {
  const result = await client().query({
    runId: "installation:runs",
    query: "list",
    arguments: argumentsValue as IpcJsonValue & Record<string, IpcJsonValue>
  });
  if (!Array.isArray(result)) throw new TypeError("Daemon list response must be an array.");
  return result.map(parseProjection);
}

export async function readProductRunEvents(
  runId: string,
  afterSequence: number
): Promise<DaemonEventPage> {
  const result = await client().eventsReady({ runId, afterSequence });
  if (!isRecord(result) || !Array.isArray(result.events)
    || typeof result.nextSequence !== "number" || !Number.isInteger(result.nextSequence)) {
    throw new TypeError("Daemon event-page response is invalid.");
  }
  return {
    events: result.events.map((event) => RunEventSchema.parse(event)),
    nextSequence: result.nextSequence
  };
}

export interface NodeActivityEntry {
  index: number;
  type: string;
  timestamp: string;
  text: string;
}

export interface NodeActivityPage {
  entries: NodeActivityEntry[];
  nextIndex: number;
}

/**
 * What the agent behind one node is doing. The daemon owns the traces; this is
 * a read, so the web never opens the trace file itself.
 */
export async function readNodeActivity(
  runId: string,
  nodeId: string,
  afterIndex: number
): Promise<NodeActivityPage> {
  const result = await client().query({
    runId,
    query: "activity",
    arguments: { nodeId, afterIndex } as IpcJsonValue & Record<string, IpcJsonValue>
  });
  if (!isRecord(result) || !Array.isArray(result.entries)
    || typeof result.nextIndex !== "number" || !Number.isInteger(result.nextIndex)) {
    throw new TypeError("Daemon activity response is invalid.");
  }
  return {
    entries: result.entries.flatMap((entry) => isRecord(entry)
      && typeof entry.index === "number"
      && typeof entry.type === "string"
      && typeof entry.timestamp === "string"
      && typeof entry.text === "string"
      ? [{ index: entry.index, type: entry.type, timestamp: entry.timestamp, text: entry.text }]
      : []),
    nextIndex: result.nextIndex
  };
}

export interface ProductRunTargetContext {
  sourceRealPath?: string;
  sourceBaseCommit?: string;
  fingerprint?: string;
  physicalIdentity?: { version: 1; device: string; file: string };
}

/** Read-only metadata required by server-rendered evidence views. */
export function productRunTargetContext(projection: RunProjection): ProductRunTargetContext {
  const context = projection.definition?.targetContext;
  if (!isRecord(context)) return {};
  return {
    ...(typeof context.sourceRealPath === "string" ? { sourceRealPath: context.sourceRealPath } : {}),
    ...(typeof context.sourceBaseCommit === "string" ? { sourceBaseCommit: context.sourceBaseCommit } : {}),
    ...(typeof context.fingerprint === "string" ? { fingerprint: context.fingerprint } : {}),
    ...(isRecord(context.physicalIdentity)
      && context.physicalIdentity.version === 1
      && typeof context.physicalIdentity.device === "string"
      && typeof context.physicalIdentity.file === "string"
      ? {
          physicalIdentity: {
            version: 1,
            device: context.physicalIdentity.device,
            file: context.physicalIdentity.file
          } as const
        }
      : {})
  };
}

export async function submitProductRunCommand(input: {
  request: Request;
  runId: string;
  command: ProductRunCommand;
  commandId?: string;
  allowMissingRun?: boolean;
}): Promise<{ receipt: IpcJsonValue; projection: RunProjection }> {
  const command = ProductRunCommandSchema.parse(input.command);
  const commandId = input.commandId ?? commandIdForRequest(input.request);
  let projection: RunProjection | undefined;
  try {
    projection = await queryProductRun(input.runId);
  } catch (error) {
    if (!input.allowMissingRun || !isDaemonRequestFailure(error)) throw error;
  }
  const previous = projection?.commandEnvelopes[commandId];
  const envelope = previous === undefined
    ? buildRunCommandEnvelope({
      commandId,
      runId: input.runId,
      expectedRevision: projection?.sequence ?? 0,
      submittedAt: new Date().toISOString(),
      command: command as unknown as RunCommandPayload
    }, sha256Digest)
    : replayEnvelope(previous, command);
  const receipt = await client().submit(envelope);
  return { receipt, projection: await queryProductRun(input.runId) };
}

export function isDaemonRequestFailure(error: unknown): boolean {
  return error instanceof LocalIpcRemoteError && error.code === "request_failed";
}

function replayEnvelope(previous: RunCommandEnvelope, command: ProductRunCommand): RunCommandEnvelope {
  const parsed = RunCommandEnvelopeSchema.parse(previous);
  if (canonicalJson(parsed.command) === canonicalJson(command)) return parsed;
  return buildRunCommandEnvelope({
    commandId: parsed.commandId,
    runId: parsed.runId,
    expectedRevision: parsed.expectedRevision,
    submittedAt: new Date().toISOString(),
    command: command as unknown as RunCommandPayload
  }, sha256Digest);
}

function resolveStateRoot(): string {
  if (process.env.MANYHANDS_DAEMON_STATE_ROOT) {
    return path.resolve(process.env.MANYHANDS_DAEMON_STATE_ROOT);
  }
  const direct = path.resolve(".manyhands/daemon");
  if (existsSync(direct)) return direct;
  const parent = path.resolve("..", "..", ".manyhands/daemon");
  if (existsSync(parent)) return parent;
  return direct;
}

function client(): LocalIpcClient {
  const stateRoot = resolveStateRoot();
  const endpoint = process.env.MANYHANDS_DAEMON_ENDPOINT ?? defaultEndpoint(stateRoot);
  const helper = optionalAbsoluteEnv("MANYHANDS_WINDOWS_IPC_ACL_HELPER");
  return createLocalIpcClient({
    endpoint,
    capabilityFilePath: path.join(stateRoot, "installation", "ipc-capability"),
    production: process.env.NODE_ENV === "production",
    socketTimeoutMs: 60_000,
    ...(helper === undefined ? {} : { assertOsRestrictedCapabilityPath: createAclVerifier(helper) })
  });
}

function createAclVerifier(helper: string) {
  return async (targetPath: string, kind: "directory" | "file"): Promise<void> => {
    await execFileAsync(helper, ["verify", kind, path.resolve(targetPath)], {
      windowsHide: true,
      encoding: "utf8"
    });
  };
}

function parseProjection(value: IpcJsonValue): RunProjection {
  if (!isRecord(value) || typeof value.runId !== "string"
    || typeof value.sequence !== "number" || !Number.isInteger(value.sequence)
    || typeof value.lifecycle !== "string" || !isRecord(value.commandEnvelopes)) {
    throw new TypeError("Daemon projection response is invalid.");
  }
  return value as unknown as RunProjection;
}

function defaultEndpoint(root: string): string {
  const suffix = createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\manyhands-daemon-${suffix}`
    : path.join(root, "daemon.sock");
}

function optionalAbsoluteEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) return undefined;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return path.resolve(value);
}

function isRecord(value: unknown): value is Record<string, IpcJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const sha256Digest: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
