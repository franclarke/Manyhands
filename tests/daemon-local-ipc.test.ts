import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  IPC_PROTOCOL_VERSION,
  IpcAuthenticatedRequestSchema,
  buildRunCommandEnvelope,
  canonicalIpcRequestAuthenticationMaterial,
  type IpcAuthenticatedRequest,
  type RunCommandEnvelope
} from "@manyhands/run-coordinator";
import { ensureInstallationCapability } from "../apps/daemon/src/installation-capability.js";
import {
  startLocalIpcServer,
  type LocalIpcServer,
  type LocalIpcServerHandlers
} from "../apps/daemon/src/local-ipc-server.js";
import {
  createWindowsIpcAclProtector,
  createWindowsIpcAclVerifier,
  verifyWindowsRestrictedNamedPipe
} from "../apps/daemon/src/windows-ipc-acl.js";
import {
  LocalIpcAuthenticationError,
  createLocalIpcClient
} from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const temporaryDirectories: string[] = [];
const servers: LocalIpcServer[] = [];
const rawServers: net.Server[] = [];
const execFileAsync = promisify(execFile);
let windowsAclSuiteDirectory: string | undefined;
let windowsAclHelperPath: string | undefined;

beforeAll(async () => {
  if (process.platform !== "win32") return;
  windowsAclSuiteDirectory = await mkdtemp(path.join(tmpdir(), "manyhands-local-ipc-acl-"));
  windowsAclHelperPath = path.join(windowsAclSuiteDirectory, "manyhands-windows-ipc-acl.exe");
  await execFileAsync("rustc.exe", [
    "--edition=2021",
    path.resolve("native/windows-ipc-acl/src/main.rs"),
    "-O",
    "-o",
    windowsAclHelperPath
  ], { windowsHide: true });
  await access(windowsAclHelperPath);
}, 60_000);

afterAll(async () => {
  if (windowsAclSuiteDirectory !== undefined) {
    await rm(windowsAclSuiteDirectory, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(rawServers.splice(0).map(closeRawServer));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("authenticated local daemon IPC", () => {
  it("creates one 256-bit installation capability with private filesystem modes", async () => {
    const root = await createTemporaryDirectory();
    const capability = await ensureInstallationCapability(path.join(root, "private"));
    const persisted = (await readFile(capability.filePath, "utf8")).trim();

    expect(Buffer.from(persisted, "base64url")).toHaveLength(32);
    await expect(ensureInstallationCapability(path.join(root, "private"))).resolves.toEqual(capability);

    if (process.platform !== "win32") {
      expect((await stat(path.dirname(capability.filePath))).mode & 0o777).toBe(0o700);
      expect((await stat(capability.filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("fails closed before creating a Windows production capability without an OS protector", async () => {
    if (process.platform !== "win32") return;
    const root = await createTemporaryDirectory();

    await expect(ensureInstallationCapability(path.join(root, "private"), {
      production: true
    })).rejects.toThrow(/os-restricted|acl|protector/i);
    await expect(readFile(path.join(root, "private", "ipc-capability"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("protects the Windows directory and empty file before generating or writing the secret", async () => {
    if (process.platform !== "win32") return;
    const root = await createTemporaryDirectory();
    const observations: string[] = [];
    let secretCreated = false;

    await ensureInstallationCapability(path.join(root, "private"), {
      production: true,
      createSecret() {
        observations.push("create-secret");
        secretCreated = true;
        return Buffer.alloc(32, 7);
      },
      async protectOrVerifyOsRestrictedPath(targetPath, kind) {
        if (kind === "directory") {
          observations.push(`directory:${secretCreated}`);
          return;
        }
        observations.push(`file:${secretCreated}:${(await readFile(targetPath, "utf8")).length}`);
      }
    });

    expect(observations).toEqual([
      "directory:false",
      "file:false:0",
      "create-secret",
      "directory:true",
      "file:true:44"
    ]);
  });

  it("does not read a Windows production capability when server or client verification fails", async () => {
    if (process.platform !== "win32") return;
    const root = await createTemporaryDirectory();
    const allowProtection = async () => undefined;
    const capability = await ensureInstallationCapability(path.join(root, "private"), {
      production: true,
      protectOrVerifyOsRestrictedPath: allowProtection
    });
    await writeFile(capability.filePath, "corrupt-secret-that-must-not-be-read\n", "utf8");
    const verificationFailure = new Error("capability ACL verification failed");
    const rejectFile = vi.fn(async (_targetPath: string, kind: "directory" | "file") => {
      if (kind === "file") throw verificationFailure;
    });

    await expect(startLocalIpcServer({
      endpoint: windowsPipeName(),
      capabilityFilePath: capability.filePath,
      handlers: handlers(),
      production: true,
      windowsPipeAclHelperPath: windowsAclHelperPath,
      assertOsRestrictedCapabilityPath: rejectFile
    })).rejects.toBe(verificationFailure);

    const client = createLocalIpcClient({
      endpoint: windowsPipeName(),
      capabilityFilePath: capability.filePath,
      production: true,
      assertOsRestrictedCapabilityPath: rejectFile
    });
    await expect(client.query({ runId: "run:1", query: "projection" })).rejects.toBe(verificationFailure);
    expect(rejectFile.mock.calls.filter(([, kind]) => kind === "file")).toHaveLength(2);
  });

  it("round-trips submit, query and events-ready over a real local net transport", async () => {
    const fixture = await startFixture();
    const command = commandEnvelope();

    await expect(fixture.client.submit(command)).resolves.toEqual({
      accepted: "command:1"
    });
    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).resolves.toEqual({
      lifecycle: "running"
    });
    await expect(fixture.client.eventsReady({ runId: "run:1", afterSequence: 7 })).resolves.toEqual({
      ready: true,
      latestSequence: 9
    });

    expect(fixture.handlers.submit).toHaveBeenCalledWith(command);
    expect(fixture.handlers.query).toHaveBeenCalledWith({ runId: "run:1", query: "projection" });
    expect(fixture.handlers.eventsReady).toHaveBeenCalledWith({ runId: "run:1", afterSequence: 7 });
    expect(fixture.server.transportSecurity).toBe(
      process.platform === "win32" ? "capability_only" : "os_restricted"
    );
  });

  it("serves Windows production IPC through a current-user plus SYSTEM pipe DACL", async () => {
    if (process.platform !== "win32") return;
    const helperPath = windowsAclHelperPath!;
    const root = await createTemporaryDirectory();
    const protect = createWindowsIpcAclProtector(helperPath);
    const verify = createWindowsIpcAclVerifier(helperPath);
    const capability = await ensureInstallationCapability(path.join(root, "private"), {
      production: true,
      protectOrVerifyOsRestrictedPath: protect
    });
    const endpoint = windowsPipeName();
    const fixtureHandlers = handlers();
    const server = await startLocalIpcServer({
      endpoint,
      capabilityFilePath: capability.filePath,
      handlers: fixtureHandlers,
      production: true,
      windowsPipeAclHelperPath: helperPath,
      assertOsRestrictedCapabilityPath: verify
    });
    servers.push(server);
    const client = createLocalIpcClient({
      endpoint,
      capabilityFilePath: capability.filePath,
      production: true,
      assertOsRestrictedCapabilityPath: verify
    });

    expect(server.transportSecurity).toBe("os_restricted");
    await expect(verifyWindowsRestrictedNamedPipe(helperPath, endpoint)).resolves.toBeUndefined();
    await expect(client.query({ runId: "run:1", query: "projection" })).resolves.toEqual({
      lifecycle: "running"
    });
  }, 30_000);

  it("rejects an authenticated nonce replay without invoking the handler twice", async () => {
    const fixture = await startFixture({
      createRequestId: () => "request:fixed",
      createNonce: () => "a".repeat(64)
    });

    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).resolves.toEqual({
      lifecycle: "running"
    });
    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).rejects.toBeInstanceOf(
      LocalIpcAuthenticationError
    );
    expect(fixture.handlers.query).toHaveBeenCalledTimes(1);
  });

  it("rejects request-id replay even when the nonce changes", async () => {
    const nonces = ["a".repeat(64), "b".repeat(64)];
    const fixture = await startFixture({
      createRequestId: () => "request:fixed",
      createNonce: () => nonces.shift() ?? "c".repeat(64)
    });

    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).resolves.toBeDefined();
    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).rejects.toBeInstanceOf(
      LocalIpcAuthenticationError
    );
    expect(fixture.handlers.query).toHaveBeenCalledTimes(1);
  });

  it("keeps the replay cache bounded and only frees entries after expiry", async () => {
    let observedAt = Date.parse("2026-08-12T12:00:00.000Z");
    const nonces = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    const fixture = await startFixture({
      now: () => observedAt,
      maxNonces: 1,
      maxClockSkewMs: 1_000,
      nonceTtlMs: 2_000,
      createNonce: () => nonces.shift() ?? "d".repeat(64)
    });

    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).resolves.toBeDefined();
    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).rejects.toBeInstanceOf(
      LocalIpcAuthenticationError
    );
    observedAt += 2_001;
    await expect(fixture.client.query({ runId: "run:1", query: "projection" })).resolves.toBeDefined();
    expect(fixture.handlers.query).toHaveBeenCalledTimes(2);
  });

  it("rejects tampered authenticated bodies before dispatch", async () => {
    const fixture = await startFixture();
    const request = await signedRawRequest(fixture.capabilityFilePath, {
      kind: "query",
      runId: "run:1",
      query: "projection"
    });
    const tampered = {
      ...request,
      body: { kind: "query", runId: "run:other", query: "projection" }
    } satisfies IpcAuthenticatedRequest;

    await expect(rawExchange(fixture.endpoint, `${JSON.stringify(tampered)}\n`)).resolves.toBe("");
    expect(fixture.handlers.query).not.toHaveBeenCalled();
  });

  it("closes oversized frames without parsing or dispatching them", async () => {
    const fixture = await startFixture({ maxFrameBytes: 512 });
    const oversized = `${"x".repeat(513)}\n`;

    await expect(rawExchange(fixture.endpoint, oversized)).resolves.toBe("");
    expect(fixture.handlers.submit).not.toHaveBeenCalled();
    expect(fixture.handlers.query).not.toHaveBeenCalled();
    expect(fixture.handlers.eventsReady).not.toHaveBeenCalled();
  });

  it("refuses a second server on the same endpoint", async () => {
    const fixture = await startFixture();

    await expect(startLocalIpcServer({
      endpoint: fixture.endpoint,
      capabilityFilePath: fixture.capabilityFilePath,
      handlers: fixture.handlers,
      production: false
    })).rejects.toThrow(/address|endpoint|use|listen/i);
  });

  it("fails closed on Windows production startup without the native pipe owner", async () => {
    if (process.platform !== "win32") return;
    const root = await createTemporaryDirectory();
    const capability = await ensureInstallationCapability(path.join(root, "private"), {
      production: true,
      protectOrVerifyOsRestrictedPath: async () => undefined
    });

    await expect(startLocalIpcServer({
      endpoint: windowsPipeName(),
      capabilityFilePath: capability.filePath,
      handlers: handlers(),
      production: true
    })).rejects.toThrow(/native|named-pipe|os-restricted|acl/i);
  });

  it("rejects stale timestamps", async () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const fixture = await startFixture({ now: () => now });
    const staleClient = createLocalIpcClient({
      endpoint: fixture.endpoint,
      capabilityFilePath: fixture.capabilityFilePath,
      now: () => now - 120_000,
      production: false
    });

    await expect(staleClient.query({ runId: "run:1", query: "projection" })).rejects.toBeInstanceOf(
      LocalIpcAuthenticationError
    );
  });

  it("rejects a response with an invalid HMAC", async () => {
    const root = await createTemporaryDirectory();
    const capability = await ensureInstallationCapability(path.join(root, "private"));
    const endpoint = process.platform === "win32" ? windowsPipeName() : path.join(root, "fake.sock");
    const rawServer = net.createServer((socket) => {
      let input = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        input += chunk;
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        const request = IpcAuthenticatedRequestSchema.parse(JSON.parse(input.slice(0, newline)));
        const body = { ok: true as const, result: { forged: true } };
        socket.end(`${JSON.stringify({
          version: IPC_PROTOCOL_VERSION,
          requestId: request.requestId,
          nonce: request.nonce,
          issuedAtMs: Date.now(),
          bodyDigest: createHash("sha256").update(canonicalJson(body)).digest("hex"),
          body,
          mac: "0".repeat(64)
        })}\n`);
      });
    });
    await listenRawServer(rawServer, endpoint);
    rawServers.push(rawServer);
    const client = createLocalIpcClient({
      endpoint,
      capabilityFilePath: capability.filePath,
      production: false
    });

    await expect(client.query({ runId: "run:1", query: "projection" })).rejects.toBeInstanceOf(
      LocalIpcAuthenticationError
    );
  });
});

interface FixtureOptions {
  maxFrameBytes?: number;
  now?: () => number;
  createRequestId?: () => string;
  createNonce?: () => string;
  maxClockSkewMs?: number;
  nonceTtlMs?: number;
  maxNonces?: number;
}

async function startFixture(options: FixtureOptions = {}) {
  const root = await createTemporaryDirectory();
  const capability = await ensureInstallationCapability(path.join(root, "private"));
  const endpoint = process.platform === "win32"
    ? windowsPipeName()
    : path.join(root, "daemon.sock");
  const fixtureHandlers = handlers();
  const server = await startLocalIpcServer({
    endpoint,
    capabilityFilePath: capability.filePath,
    handlers: fixtureHandlers,
    production: false,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.maxClockSkewMs === undefined ? {} : { maxClockSkewMs: options.maxClockSkewMs }),
    ...(options.nonceTtlMs === undefined ? {} : { nonceTtlMs: options.nonceTtlMs }),
    ...(options.maxNonces === undefined ? {} : { maxNonces: options.maxNonces })
  });
  servers.push(server);
  const client = createLocalIpcClient({
    endpoint,
    capabilityFilePath: capability.filePath,
    production: false,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.maxClockSkewMs === undefined ? {} : { maxClockSkewMs: options.maxClockSkewMs }),
    ...(options.createRequestId === undefined ? {} : { createRequestId: options.createRequestId }),
    ...(options.createNonce === undefined ? {} : { createNonce: options.createNonce })
  });
  return {
    endpoint,
    capabilityFilePath: capability.filePath,
    handlers: fixtureHandlers,
    server,
    client
  };
}

function handlers(): LocalIpcServerHandlers {
  return {
    submit: vi.fn(async (command: RunCommandEnvelope) => ({
      accepted: command.commandId
    })),
    query: vi.fn(async () => ({ lifecycle: "running" })),
    eventsReady: vi.fn(async () => ({ ready: true, latestSequence: 9 }))
  };
}

function commandEnvelope(): RunCommandEnvelope {
  return buildRunCommandEnvelope({
    commandId: "command:1",
    runId: "run:1",
    expectedRevision: 0,
    submittedAt: "2026-08-12T12:00:00.000Z",
    command: { type: "pause", reason: "integration test" }
  }, (canonical) => createHash("sha256").update(canonical).digest("hex"));
}

async function signedRawRequest(
  capabilityFilePath: string,
  body: IpcAuthenticatedRequest["body"]
): Promise<IpcAuthenticatedRequest> {
  const secret = (await readFile(capabilityFilePath, "utf8")).trim();
  const request = {
    version: IPC_PROTOCOL_VERSION,
    requestId: `request:${randomUUID()}`,
    nonce: randomBytes(32).toString("hex"),
    issuedAtMs: Date.now(),
    bodyDigest: createHash("sha256").update(canonicalJson(body)).digest("hex"),
    body
  };
  return IpcAuthenticatedRequestSchema.parse({
    ...request,
    mac: createHmac("sha256", secret)
      .update(canonicalIpcRequestAuthenticationMaterial(request))
      .digest("hex")
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function rawExchange(endpoint: string, frame: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(frame));
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
  });
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "manyhands-ipc-"));
  temporaryDirectories.push(directory);
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

function windowsPipeName(): string {
  return `\\\\.\\pipe\\manyhands-${randomUUID()}`;
}

async function listenRawServer(server: net.Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
}

async function closeRawServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
