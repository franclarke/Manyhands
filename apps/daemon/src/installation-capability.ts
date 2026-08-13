import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  IpcCapabilityTextSchema,
  type IpcCapabilityOsProtection
} from "@manyhands/run-coordinator";

export const INSTALLATION_CAPABILITY_FILE_NAME = "ipc-capability";

export interface InstallationCapabilityFile {
  readonly filePath: string;
}

export interface EnsureInstallationCapabilityOptions {
  createSecret?: () => Buffer;
  production?: boolean;
  protectOrVerifyOsRestrictedPath?: IpcCapabilityOsProtection;
}

/**
 * Creates the installation-scoped IPC capability exactly once. The secret is
 * intentionally never returned: daemon and server-side clients consume it
 * from the protected file, which makes accidental response/log serialization
 * substantially harder.
 */
export async function ensureInstallationCapability(
  capabilityDirectory: string,
  options: EnsureInstallationCapabilityOptions = {}
): Promise<InstallationCapabilityFile> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const osProtection = windowsOsProtection(
    production,
    options.protectOrVerifyOsRestrictedPath
  );
  const directory = path.resolve(capabilityDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertRealDirectory(directory);
  await chmod(directory, 0o700);
  await osProtection?.(directory, "directory");

  const filePath = path.join(directory, INSTALLATION_CAPABILITY_FILE_NAME);
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
    await validateExistingCapability(filePath, osProtection);
    return Object.freeze({ filePath });
  }

  try {
    await handle.chmod(0o600);
    await osProtection?.(filePath, "file");
    const secret = (options.createSecret ?? (() => randomBytes(32)))();
    if (!Buffer.isBuffer(secret) || secret.byteLength !== 32) {
      throw new TypeError("Installation IPC capability source must return exactly 32 random bytes.");
    }
    const encoded = secret.toString("base64url");
    IpcCapabilityTextSchema.parse(encoded);
    await handle.writeFile(`${encoded}\n`, { encoding: "utf8" });
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    handle = undefined;
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close();
  }

  await validateExistingCapability(filePath, osProtection);
  return Object.freeze({ filePath });
}

async function assertRealDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Installation capability directory must be a real directory.");
  }
}

async function validateExistingCapability(
  filePath: string,
  osProtection: IpcCapabilityOsProtection | undefined
): Promise<void> {
  const directory = path.dirname(filePath);
  await assertRealDirectory(directory);
  await osProtection?.(directory, "directory");
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Installation IPC capability must be a regular file.");
  }
  await chmod(filePath, 0o600);
  await osProtection?.(filePath, "file");
  const persisted = (await readFile(filePath, "utf8")).trim();
  const parsed = IpcCapabilityTextSchema.safeParse(persisted);
  if (!parsed.success || Buffer.from(parsed.data, "base64url").byteLength !== 32) {
    throw new Error("Installation IPC capability file is corrupt.");
  }
}

function windowsOsProtection(
  production: boolean,
  protection: IpcCapabilityOsProtection | undefined
): IpcCapabilityOsProtection | undefined {
  if (process.platform !== "win32") return undefined;
  if (production && protection === undefined) {
    throw new Error("Windows production IPC capability creation requires an OS-restricted ACL protector.");
  }
  return protection;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
