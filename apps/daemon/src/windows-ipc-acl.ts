import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import type {
  IpcCapabilityOsProtection,
  IpcCapabilityPathKind
} from "@manyhands/run-coordinator";

const MAX_HELPER_DIAGNOSTICS_BYTES = 8 * 1024;

export interface StartWindowsRestrictedNamedPipeProxyOptions {
  helperPath: string;
  endpoint: string;
  backendEndpoint: string;
  startupTimeoutMs?: number;
  onUnexpectedExit?: (error: Error) => void;
}

export interface WindowsRestrictedNamedPipeProxy {
  readonly endpoint: string;
  readonly backendEndpoint: string;
  close(): Promise<void>;
}

export function createWindowsIpcAclProtector(
  helperPath: string
): IpcCapabilityOsProtection {
  return createWindowsIpcAclOperation(helperPath, "apply");
}

export function createWindowsIpcAclVerifier(
  helperPath: string
): IpcCapabilityOsProtection {
  return createWindowsIpcAclOperation(helperPath, "verify");
}

/**
 * Starts the native owner of the public Windows named pipe. The helper creates
 * every public pipe instance with the protected current-user + SYSTEM DACL;
 * Node only owns the unadvertised backend transport.
 */
export async function startWindowsRestrictedNamedPipeProxy(
  options: StartWindowsRestrictedNamedPipeProxyOptions
): Promise<WindowsRestrictedNamedPipeProxy> {
  const executable = assertHelperPath(options.helperPath);
  const endpoint = assertNamedPipeEndpoint(options.endpoint, "public");
  const backendEndpoint = assertNamedPipeEndpoint(options.backendEndpoint, "backend");
  if (endpoint === backendEndpoint) {
    throw new TypeError("Windows public and backend named-pipe endpoints must differ.");
  }
  const startupTimeoutMs = positiveInteger(options.startupTimeoutMs ?? 10_000, "startupTimeoutMs");
  const child = spawn(executable, ["serve-pipe", endpoint, backendEndpoint], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    env: {}
  });
  const diagnostics = collectDiagnostics(child);
  const exit = waitForExit(child);
  try {
    await waitForReady(child, exit, startupTimeoutMs, diagnostics);
  } catch (error) {
    child.stdin?.destroy();
    child.kill();
    await exit.catch(() => undefined);
    throw error;
  }

  let closing = false;
  let closed = false;
  void exit.then(({ code, signal }) => {
    if (!closing) {
      options.onUnexpectedExit?.(new Error(
        `Windows restricted named-pipe owner exited unexpectedly (${code ?? signal ?? "unknown"})${
          diagnosticSuffix(diagnostics)
        }`
      ));
    }
  });
  return Object.freeze({
    endpoint,
    backendEndpoint,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      closing = true;
      child.stdin?.end();
      const result = await withExitTimeout(child, exit, 5_000);
      if (result.code !== 0 && result.signal === null) {
        throw new Error(
          `Windows restricted named-pipe owner failed during shutdown (${result.code})${
            diagnosticSuffix(diagnostics)
          }`
        );
      }
    }
  });
}

/** Independently verifies the DACL exposed by the live public pipe handle. */
export async function verifyWindowsRestrictedNamedPipe(
  helperPath: string,
  endpoint: string
): Promise<void> {
  const executable = assertHelperPath(helperPath);
  const target = assertNamedPipeEndpoint(endpoint, "public");
  await runHelperArguments(executable, ["verify-pipe", target], "named-pipe ACL verification");
}

function createWindowsIpcAclOperation(
  helperPath: string,
  operation: "apply" | "verify"
): IpcCapabilityOsProtection {
  const executable = assertHelperPath(helperPath);
  return async (targetPath, kind) => {
    assertTarget(targetPath, kind);
    await runHelper(executable, operation, kind, path.resolve(targetPath));
  };
}

function assertTarget(targetPath: string, kind: IpcCapabilityPathKind): void {
  if (!path.isAbsolute(targetPath) || targetPath.includes("\0")) {
    throw new TypeError("Windows IPC ACL target path must be absolute and contain no NUL bytes.");
  }
  if (kind !== "directory" && kind !== "file") {
    throw new TypeError("Windows IPC ACL target kind must be directory or file.");
  }
}

async function runHelper(
  executable: string,
  operation: "apply" | "verify",
  kind: IpcCapabilityPathKind,
  targetPath: string
): Promise<void> {
  await runHelperArguments(
    executable,
    [operation, kind, targetPath],
    `Windows IPC ACL ${operation}`
  );
}

async function runHelperArguments(
  executable: string,
  args: readonly string[],
  label: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      windowsHide: true
    });
    const diagnostics: Buffer[] = [];
    let diagnosticBytes = 0;
    let settled = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (diagnosticBytes >= MAX_HELPER_DIAGNOSTICS_BYTES) return;
      const remaining = MAX_HELPER_DIAGNOSTICS_BYTES - diagnosticBytes;
      const bounded = chunk.subarray(0, remaining);
      diagnostics.push(bounded);
      diagnosticBytes += bounded.byteLength;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(diagnostics).toString("utf8").trim();
      reject(new Error(
        `${label} failed (${code ?? signal ?? "unknown"})${
          detail.length === 0 ? "." : `: ${detail}`
        }`
      ));
    });
  });
}

function assertHelperPath(helperPath: string): string {
  if (!path.isAbsolute(helperPath) || helperPath.includes("\0")) {
    throw new TypeError("Windows IPC ACL helper path must be absolute and contain no NUL bytes.");
  }
  return path.resolve(helperPath);
}

function assertNamedPipeEndpoint(endpoint: string, label: string): string {
  if (endpoint.includes("\0") || !/^\\\\\.\\pipe\\[^\\/]+(?:\\[^\\/]+)*$/.test(endpoint)) {
    throw new TypeError(`Windows ${label} endpoint must be a local named-pipe path.`);
  }
  return endpoint;
}

function collectDiagnostics(child: ChildProcess): Buffer[] {
  const diagnostics: Buffer[] = [];
  let diagnosticBytes = 0;
  child.stderr?.on("data", (chunk: Buffer) => {
    if (diagnosticBytes >= MAX_HELPER_DIAGNOSTICS_BYTES) return;
    const bounded = chunk.subarray(0, MAX_HELPER_DIAGNOSTICS_BYTES - diagnosticBytes);
    diagnostics.push(bounded);
    diagnosticBytes += bounded.byteLength;
  });
  return diagnostics;
}

function waitForExit(
  child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForReady(
  child: ChildProcess,
  exit: Promise<unknown>,
  timeoutMs: number,
  diagnostics: readonly Buffer[]
): Promise<void> {
  if (child.stdout === null) throw new Error("Windows named-pipe owner has no readiness channel.");
  const readiness = new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      if (output.slice(0, newline).replace(/\r$/, "") === "READY") resolve();
      else reject(new Error("Windows named-pipe owner returned an invalid readiness frame."));
    });
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      readiness,
      exit.then(() => {
        throw new Error(`Windows named-pipe owner exited before readiness${diagnosticSuffix(diagnostics)}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out starting Windows named-pipe owner.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function withExitTimeout(
  child: ChildProcess,
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exit,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error("Timed out stopping Windows named-pipe owner."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function diagnosticSuffix(diagnostics: readonly Buffer[]): string {
  const detail = Buffer.concat(diagnostics).toString("utf8").trim();
  return detail.length === 0 ? "." : `: ${detail}`;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}
