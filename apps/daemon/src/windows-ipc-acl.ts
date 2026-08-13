import { spawn } from "node:child_process";
import path from "node:path";

import type {
  IpcCapabilityOsProtection,
  IpcCapabilityPathKind
} from "@manyhands/run-coordinator";

const MAX_HELPER_DIAGNOSTICS_BYTES = 8 * 1024;

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

function createWindowsIpcAclOperation(
  helperPath: string,
  operation: "apply" | "verify"
): IpcCapabilityOsProtection {
  if (!path.isAbsolute(helperPath) || helperPath.includes("\0")) {
    throw new TypeError("Windows IPC ACL helper path must be absolute and contain no NUL bytes.");
  }
  const executable = path.resolve(helperPath);
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
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [operation, kind, targetPath], {
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
        `Windows IPC ACL ${operation} failed (${code ?? signal ?? "unknown"})${
          detail.length === 0 ? "." : `: ${detail}`
        }`
      ));
    });
  });
}
