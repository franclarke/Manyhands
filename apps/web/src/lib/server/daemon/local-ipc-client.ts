import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  IPC_DEFAULT_MAX_CLOCK_SKEW_MS,
  IPC_DEFAULT_MAX_FRAME_BYTES,
  IPC_PROTOCOL_VERSION,
  IpcAuthenticatedResponseSchema,
  IpcCapabilityTextSchema,
  canonicalIpcBody,
  canonicalIpcRequestAuthenticationMaterial,
  canonicalIpcResponseAuthenticationMaterial,
  type IpcAuthenticatedRequest,
  type IpcAuthenticatedResponse,
  type IpcCapabilityOsProtection,
  type IpcEventsReadyRequestBody,
  type IpcJsonValue,
  type IpcQueryRequestBody,
  type IpcRequestBody,
  type IpcUnsignedRequest,
  type RunCommandEnvelope
} from "@manyhands/run-coordinator";

export interface LocalIpcClientOptions {
  endpoint: string;
  capabilityFilePath: string;
  production?: boolean;
  assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  now?: () => number;
  createRequestId?: () => string;
  createNonce?: () => string;
  maxFrameBytes?: number;
  maxClockSkewMs?: number;
  socketTimeoutMs?: number;
}

export interface LocalIpcClient {
  submit(command: RunCommandEnvelope): Promise<IpcJsonValue>;
  query(input: Omit<IpcQueryRequestBody, "kind">): Promise<IpcJsonValue>;
  eventsReady(input: Omit<IpcEventsReadyRequestBody, "kind">): Promise<IpcJsonValue>;
}

export class LocalIpcAuthenticationError extends Error {
  constructor(message = "Daemon IPC authentication failed.") {
    super(message);
    this.name = "LocalIpcAuthenticationError";
  }
}

export class LocalIpcProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalIpcProtocolError";
  }
}

export class LocalIpcRemoteError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LocalIpcRemoteError";
  }
}

/**
 * This module intentionally lives below `lib/server` and imports Node-only
 * primitives. It exposes no secret-bearing value and cannot be used by a
 * browser bundle as an isomorphic transport.
 */
export function createLocalIpcClient(options: LocalIpcClientOptions): LocalIpcClient {
  const endpoint = assertLocalEndpoint(options.endpoint);
  const production = options.production ?? process.env.NODE_ENV === "production";
  if (process.platform === "win32" && production && options.assertOsRestrictedCapabilityPath === undefined) {
    throw new Error("Windows production IPC requires an injected OS-restricted capability ACL assertion.");
  }
  const now = options.now ?? Date.now;
  const createRequestId = options.createRequestId ?? (() => `request:${randomUUID()}`);
  const createNonce = options.createNonce ?? (() => randomBytes(32).toString("hex"));
  const maxFrameBytes = positiveInteger(options.maxFrameBytes ?? IPC_DEFAULT_MAX_FRAME_BYTES, "maxFrameBytes");
  const maxClockSkewMs = positiveInteger(
    options.maxClockSkewMs ?? IPC_DEFAULT_MAX_CLOCK_SKEW_MS,
    "maxClockSkewMs"
  );
  const socketTimeoutMs = positiveInteger(options.socketTimeoutMs ?? 10_000, "socketTimeoutMs");

  const send = async (body: IpcRequestBody): Promise<IpcJsonValue> => {
    const capability = await loadCapability(
      options.capabilityFilePath,
      process.platform === "win32" ? options.assertOsRestrictedCapabilityPath : undefined
    );
    try {
      const unsigned: IpcUnsignedRequest = {
        version: IPC_PROTOCOL_VERSION,
        requestId: createRequestId(),
        nonce: createNonce(),
        issuedAtMs: now(),
        bodyDigest: digest(body),
        body
      };
      const request: IpcAuthenticatedRequest = {
        ...unsigned,
        mac: mac(capability, canonicalIpcRequestAuthenticationMaterial(unsigned))
      };
      const frame = `${JSON.stringify(request)}\n`;
      if (Buffer.byteLength(frame, "utf8") > maxFrameBytes) {
        throw new LocalIpcProtocolError("Daemon IPC request exceeds the configured frame limit.");
      }
      const responseFrame = await exchange(endpoint, frame, maxFrameBytes, socketTimeoutMs);
      const response = authenticateResponse(responseFrame, request, capability, now(), maxClockSkewMs);
      if (!response.body.ok) {
        throw new LocalIpcRemoteError(response.body.error.code, response.body.error.message);
      }
      return response.body.result;
    } finally {
      capability.fill(0);
    }
  };

  const client: LocalIpcClient = {
    submit(command: RunCommandEnvelope) {
      return send({ kind: "submit", command });
    },
    query(input: Omit<IpcQueryRequestBody, "kind">) {
      return send({ kind: "query", ...input });
    },
    eventsReady(input: Omit<IpcEventsReadyRequestBody, "kind">) {
      return send({ kind: "events_ready", ...input });
    }
  };
  return Object.freeze(client);
}

function authenticateResponse(
  frame: string,
  request: IpcAuthenticatedRequest,
  capability: Buffer,
  observedAt: number,
  maxClockSkewMs: number
): IpcAuthenticatedResponse {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(frame);
  } catch {
    throw new LocalIpcAuthenticationError();
  }
  const parsed = IpcAuthenticatedResponseSchema.safeParse(parsedJson);
  if (!parsed.success) throw new LocalIpcAuthenticationError();
  const response = parsed.data;
  if (response.requestId !== request.requestId || response.nonce !== request.nonce) {
    throw new LocalIpcAuthenticationError();
  }
  if (Math.abs(observedAt - response.issuedAtMs) > maxClockSkewMs) {
    throw new LocalIpcAuthenticationError();
  }
  if (!constantTimeHexEquals(response.bodyDigest, digest(response.body))) {
    throw new LocalIpcAuthenticationError();
  }
  const expectedMac = mac(capability, canonicalIpcResponseAuthenticationMaterial(response));
  if (!constantTimeHexEquals(response.mac, expectedMac)) {
    throw new LocalIpcAuthenticationError();
  }
  return response;
}

async function exchange(
  endpoint: string,
  requestFrame: string,
  maxFrameBytes: number,
  socketTimeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffered = Buffer.alloc(0);
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(socketTimeoutMs, () => fail(new LocalIpcAuthenticationError()));
    socket.on("connect", () => socket.write(requestFrame));
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) {
        if (buffered.byteLength > maxFrameBytes) fail(new LocalIpcAuthenticationError());
        return;
      }
      if (newline + 1 > maxFrameBytes || newline !== buffered.byteLength - 1) {
        fail(new LocalIpcAuthenticationError());
        return;
      }
      settled = true;
      const frame = buffered.subarray(0, newline).toString("utf8").replace(/\r$/, "");
      socket.end();
      resolve(frame);
    });
    socket.on("end", () => {
      if (!settled) fail(new LocalIpcAuthenticationError());
    });
    socket.on("close", () => {
      if (!settled) fail(new LocalIpcAuthenticationError());
    });
    socket.on("error", (error) => fail(error));
  });
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}
