import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, readFile, stat } from "node:fs/promises";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";

import {
  IPC_DEFAULT_MAX_CLOCK_SKEW_MS,
  IPC_DEFAULT_MAX_FRAME_BYTES,
  IPC_DEFAULT_MAX_NONCES,
  IPC_DEFAULT_NONCE_TTL_MS,
  IPC_PROTOCOL_VERSION,
  IpcAuthenticatedRequestSchema,
  IpcCapabilityTextSchema,
  IpcJsonValueSchema,
  IpcResponseBodySchema,
  canonicalIpcBody,
  canonicalIpcRequestAuthenticationMaterial,
  canonicalIpcResponseAuthenticationMaterial,
  type IpcAuthenticatedRequest,
  type IpcAuthenticatedResponse,
  type IpcCapabilityOsProtection,
  type IpcEventsReadyRequestBody,
  type IpcJsonValue,
  type IpcQueryRequestBody,
  type IpcResponseBody,
  type IpcUnsignedResponse,
  type RunCommandEnvelope
} from "@manyhands/run-coordinator";
import {
  startWindowsRestrictedNamedPipeProxy,
  verifyWindowsRestrictedNamedPipe,
  type WindowsRestrictedNamedPipeProxy
} from "./windows-ipc-acl.js";

export type LocalIpcTransportSecurity = "os_restricted" | "capability_only";

export interface LocalIpcServerHandlers {
  submit(command: RunCommandEnvelope): Promise<IpcJsonValue> | IpcJsonValue;
  query(input: Omit<IpcQueryRequestBody, "kind">): Promise<IpcJsonValue> | IpcJsonValue;
  eventsReady(input: Omit<IpcEventsReadyRequestBody, "kind">): Promise<IpcJsonValue> | IpcJsonValue;
}

export interface StartLocalIpcServerOptions {
  endpoint: string;
  capabilityFilePath: string;
  handlers: LocalIpcServerHandlers;
  production?: boolean;
  windowsPipeAclHelperPath?: string;
  assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  now?: () => number;
  maxFrameBytes?: number;
  maxClockSkewMs?: number;
  nonceTtlMs?: number;
  maxNonces?: number;
  socketTimeoutMs?: number;
  onError?: (error: Error) => void;
}

export interface LocalIpcServer {
  readonly endpoint: string;
  readonly transportSecurity: LocalIpcTransportSecurity;
  close(): Promise<void>;
}

export async function startLocalIpcServer(
  options: StartLocalIpcServerOptions
): Promise<LocalIpcServer> {
  const endpoint = assertLocalEndpoint(options.endpoint);
  const production = options.production ?? process.env.NODE_ENV === "production";
  if (process.platform === "win32" && production && options.windowsPipeAclHelperPath === undefined) {
    throw new Error("Windows production IPC requires the native OS-restricted named-pipe owner.");
  }
  if (process.platform === "win32" && production && options.assertOsRestrictedCapabilityPath === undefined) {
    throw new Error("Windows production IPC requires an injected OS-restricted capability ACL assertion.");
  }

  const maxFrameBytes = positiveInteger(options.maxFrameBytes ?? IPC_DEFAULT_MAX_FRAME_BYTES, "maxFrameBytes");
  const maxClockSkewMs = positiveInteger(
    options.maxClockSkewMs ?? IPC_DEFAULT_MAX_CLOCK_SKEW_MS,
    "maxClockSkewMs"
  );
  const nonceTtlMs = positiveInteger(options.nonceTtlMs ?? IPC_DEFAULT_NONCE_TTL_MS, "nonceTtlMs");
  if (nonceTtlMs < maxClockSkewMs * 2) {
    throw new RangeError("nonceTtlMs must cover both sides of the accepted clock-skew window.");
  }
  const maxNonces = positiveInteger(options.maxNonces ?? IPC_DEFAULT_MAX_NONCES, "maxNonces");
  const socketTimeoutMs = positiveInteger(options.socketTimeoutMs ?? 10_000, "socketTimeoutMs");
  const now = options.now ?? Date.now;
  const capability = await loadCapability(
    options.capabilityFilePath,
    process.platform === "win32" ? options.assertOsRestrictedCapabilityPath : undefined
  );
  const replayCache = new ExpiringNonceReplayCache(maxNonces, nonceTtlMs);
  const sockets = new Set<Socket>();
  let ready = false;
  let closed = false;
  let windowsPipeProxy: WindowsRestrictedNamedPipeProxy | undefined;

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (!ready) {
      socket.destroy();
      return;
    }
    acceptOneFrame(socket, {
      capability,
      handlers: options.handlers,
      replayCache,
      now,
      maxFrameBytes,
      maxClockSkewMs,
      socketTimeoutMs
    });
  });

  try {
    const listenEndpoint = process.platform === "win32" && production
      ? windowsBackendEndpoint()
      : endpoint;
    await listen(server, listenEndpoint);
    if (process.platform === "win32" && production) {
      const helperPath = options.windowsPipeAclHelperPath!;
      windowsPipeProxy = await startWindowsRestrictedNamedPipeProxy({
        helperPath,
        endpoint,
        backendEndpoint: listenEndpoint,
        onUnexpectedExit(error) {
          ready = false;
          options.onError?.(error);
          void closeServer(server, sockets);
        }
      });
      await verifyWindowsRestrictedNamedPipe(helperPath, endpoint);
    } else {
      if (process.platform !== "win32") await assertPrivateUnixSocket(endpoint);
    }
    ready = true;
  } catch (error) {
    await windowsPipeProxy?.close().catch(() => undefined);
    await closeServer(server, sockets);
    capability.fill(0);
    throw error;
  }

  server.on("error", (error) => options.onError?.(error));
  const transportSecurity: LocalIpcTransportSecurity = process.platform === "win32" && !production
    ? "capability_only"
    : "os_restricted";

  return Object.freeze({
    endpoint,
    transportSecurity,
    async close() {
      if (closed) return;
      closed = true;
      ready = false;
      try {
        await windowsPipeProxy?.close();
      } finally {
        await closeServer(server, sockets);
        capability.fill(0);
      }
    }
  });
}

function windowsBackendEndpoint(): string {
  return `\\\\.\\pipe\\manyhands-ipc-backend-${process.pid}-${randomUUID()}`;
}

interface ConnectionContext {
  capability: Buffer;
  handlers: LocalIpcServerHandlers;
  replayCache: ExpiringNonceReplayCache;
  now: () => number;
  maxFrameBytes: number;
  maxClockSkewMs: number;
  socketTimeoutMs: number;
}

function acceptOneFrame(socket: Socket, context: ConnectionContext): void {
  let buffered = Buffer.alloc(0);
  let handled = false;
  socket.setTimeout(context.socketTimeoutMs, () => socket.destroy());

  socket.on("data", (chunk: Buffer) => {
    if (handled) {
      socket.destroy();
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    const newline = buffered.indexOf(0x0a);
    if (newline < 0) {
      if (buffered.byteLength > context.maxFrameBytes) socket.destroy();
      return;
    }
    if (newline + 1 > context.maxFrameBytes || newline !== buffered.byteLength - 1) {
      socket.destroy();
      return;
    }
    handled = true;
    socket.pause();
    const frame = buffered.subarray(0, newline).toString("utf8").replace(/\r$/, "");
    void processFrame(frame, context)
      .then((response) => {
        if (response === undefined || socket.destroyed) {
          socket.destroy();
          return;
        }
        socket.end(response);
      })
      .catch(() => socket.destroy());
  });

  socket.on("end", () => {
    if (!handled) socket.destroy();
  });
}

async function processFrame(frame: string, context: ConnectionContext): Promise<string | undefined> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(frame);
  } catch {
    return undefined;
  }
  const parsed = IpcAuthenticatedRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return undefined;
  const request = parsed.data;
  const observedAt = context.now();
  if (Math.abs(observedAt - request.issuedAtMs) > context.maxClockSkewMs) return undefined;
  if (!constantTimeHexEquals(request.bodyDigest, digest(request.body))) return undefined;
  const expectedMac = mac(context.capability, canonicalIpcRequestAuthenticationMaterial(request));
  if (!constantTimeHexEquals(request.mac, expectedMac)) return undefined;
  if (!context.replayCache.consume(request.requestId, request.nonce, observedAt)) return undefined;

  let body: IpcResponseBody;
  try {
    const result = IpcJsonValueSchema.parse(await dispatch(request, context.handlers));
    body = { ok: true, result };
  } catch {
    body = {
      ok: false,
      error: { code: "request_failed", message: "Daemon request failed." }
    };
  }
  return encodeBoundedResponse(request, body, context);
}

async function dispatch(
  request: IpcAuthenticatedRequest,
  handlers: LocalIpcServerHandlers
): Promise<IpcJsonValue> {
  switch (request.body.kind) {
    case "submit":
      return handlers.submit(request.body.command);
    case "query":
      return handlers.query(request.body.arguments === undefined
        ? { runId: request.body.runId, query: request.body.query }
        : { runId: request.body.runId, query: request.body.query, arguments: request.body.arguments });
    case "events_ready":
      return handlers.eventsReady({
        runId: request.body.runId,
        afterSequence: request.body.afterSequence
      });
  }
}

function encodeBoundedResponse(
  request: IpcAuthenticatedRequest,
  initialBody: IpcResponseBody,
  context: ConnectionContext
): string {
  let body = IpcResponseBodySchema.parse(initialBody);
  let response = signResponse(request, body, context);
  let frame = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(frame, "utf8") <= context.maxFrameBytes) return frame;

  body = {
    ok: false,
    error: { code: "response_too_large", message: "Daemon response exceeds the IPC frame limit." }
  };
  response = signResponse(request, body, context);
  frame = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(frame, "utf8") > context.maxFrameBytes) {
    throw new Error("IPC frame limit is too small for an authenticated error response.");
  }
  return frame;
}

function signResponse(
  request: IpcAuthenticatedRequest,
  body: IpcResponseBody,
  context: ConnectionContext
): IpcAuthenticatedResponse {
  const unsigned: IpcUnsignedResponse = {
    version: IPC_PROTOCOL_VERSION,
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAtMs: context.now(),
    bodyDigest: digest(body),
    body
  };
  return {
    ...unsigned,
    mac: mac(context.capability, canonicalIpcResponseAuthenticationMaterial(unsigned))
  };
}

class ExpiringNonceReplayCache {
  private readonly expirations = new Map<string, number>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number
  ) {}

  consume(requestId: string, nonce: string, observedAt: number): boolean {
    for (const [knownIdentity, expiresAt] of this.expirations) {
      if (expiresAt <= observedAt) this.expirations.delete(knownIdentity);
    }
    const identities = [`request:${requestId}`, `nonce:${nonce}`];
    if (identities.some((identity) => this.expirations.has(identity))) return false;
    // Evicting a live nonce would make a still-fresh replay valid. Saturation
    // therefore rejects new work until an entry expires.
    if (this.expirations.size / 2 >= this.maxEntries) return false;
    for (const identity of identities) this.expirations.set(identity, observedAt + this.ttlMs);
    return true;
  }
}

function digest(body: unknown): string {
  return createHash("sha256").update(canonicalIpcBody(body), "utf8").digest("hex");
}

function mac(capability: Buffer, material: string): string {
  return createHmac("sha256", capability).update(material, "utf8").digest("hex");
}

function constantTimeHexEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

async function loadCapability(
  filePath: string,
  osProtection: IpcCapabilityOsProtection | undefined
): Promise<Buffer> {
  const directory = path.dirname(filePath);
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("Installation IPC capability directory must be a real directory.");
  }
  if (process.platform === "win32") {
    await osProtection?.(directory, "directory");
  } else if ((directoryMetadata.mode & 0o777) !== 0o700) {
    throw new Error("Installation IPC capability directory must have mode 0700.");
  }
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Installation IPC capability must be a regular file.");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600) {
    throw new Error("Installation IPC capability must have mode 0600.");
  }
  await osProtection?.(filePath, "file");
  const persisted = (await readFile(filePath, "utf8")).trim();
  const parsed = IpcCapabilityTextSchema.safeParse(persisted);
  if (!parsed.success) throw new Error("Installation IPC capability file is corrupt.");
  const capability = Buffer.from(parsed.data, "base64url");
  if (capability.byteLength !== 32) throw new Error("Installation IPC capability file is corrupt.");
  return capability;
}

function assertLocalEndpoint(endpoint: string): string {
  if (endpoint.includes("\0")) throw new TypeError("IPC endpoint cannot contain a null byte.");
  if (process.platform === "win32") {
    if (!/^\\\\\.\\pipe\\[^\\/]+(?:\\[^\\/]+)*$/.test(endpoint)) {
      throw new TypeError("Windows IPC endpoint must be a named-pipe path.");
    }
    return endpoint;
  }
  if (!path.isAbsolute(endpoint)) throw new TypeError("Unix IPC endpoint must be an absolute socket path.");
  return endpoint;
}

async function assertPrivateUnixSocket(endpoint: string): Promise<void> {
  await chmod(endpoint, 0o600);
  const metadata = await stat(endpoint);
  if (!metadata.isSocket() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("Unix IPC endpoint is not an OS-restricted mode-0600 socket.");
  }
}

async function listen(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}
