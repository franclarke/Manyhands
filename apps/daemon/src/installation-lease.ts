import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const OWNER_FILE_NAME = "owner.json";

export type ProcessIdentityStatus = "same" | "different" | "dead" | "unknown";

export interface ProcessIdentityProbe {
  probe(owner: Pick<InstallationLeaseOwner, "pid" | "processStartIdentity">):
    Promise<ProcessIdentityStatus>;
}

export interface InstallationLeaseOwner {
  schemaVersion: 1;
  pid: number;
  processStartIdentity: string;
  nonce: string;
  daemonEpoch: string;
  acquiredAt: string;
}

export interface AcquireInstallationLeaseOptions {
  processStartIdentity: string;
  processIdentityProbe: ProcessIdentityProbe;
  pid?: number;
  createNonce?: () => string;
  createDaemonEpoch?: () => string;
  now?: () => Date;
}

export interface InstallationLease {
  readonly owner: Readonly<InstallationLeaseOwner>;
  assertCurrent(): Promise<void>;
  release(): Promise<void>;
}

export class InstallationLeaseUnavailableError extends Error {
  constructor(
    readonly leaseDirectory: string,
    readonly status: ProcessIdentityStatus,
    readonly currentOwner?: Readonly<InstallationLeaseOwner>
  ) {
    super(`Installation lease ${leaseDirectory} is unavailable (${status}).`);
    this.name = "InstallationLeaseUnavailableError";
  }
}

export class InstallationLeaseLostError extends Error {
  constructor(readonly leaseDirectory: string) {
    super(`Installation lease ${leaseDirectory} is no longer current.`);
    this.name = "InstallationLeaseLostError";
  }
}

export async function acquireInstallationLease(
  leaseDirectory: string,
  options: AcquireInstallationLeaseOptions
): Promise<InstallationLease> {
  const owner: InstallationLeaseOwner = {
    schemaVersion: 1,
    pid: options.pid ?? process.pid,
    processStartIdentity: requireNonEmpty(options.processStartIdentity, "processStartIdentity"),
    nonce: requireNonEmpty((options.createNonce ?? randomUUID)(), "nonce"),
    daemonEpoch: requireNonEmpty((options.createDaemonEpoch ?? randomUUID)(), "daemonEpoch"),
    acquiredAt: (options.now ?? (() => new Date()))().toISOString()
  };
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    throw new Error("Installation lease pid must be a positive safe integer.");
  }

  await mkdir(path.dirname(leaseDirectory), { recursive: true });
  const stagingDirectory = `${leaseDirectory}.staging-${randomUUID()}`;
  try {
    await writeOwnerDirectory(stagingDirectory, owner);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  try {
    await rename(stagingDirectory, leaseDirectory);
  } catch (error) {
    if (!isPathCollision(error)) throw error;
    const currentOwner = await readStrictOwner(leaseDirectory);
    const status = currentOwner === undefined
      ? "unknown"
      : normalizeProcessIdentityStatus(
        await options.processIdentityProbe.probe({
          pid: currentOwner.pid,
          processStartIdentity: currentOwner.processStartIdentity
        })
      );
    if (currentOwner === undefined || status === "same" || status === "unknown") {
      throw new InstallationLeaseUnavailableError(
        leaseDirectory,
        status,
        currentOwner
      );
    }
    await replaceAbandonedOwner(leaseDirectory, stagingDirectory, currentOwner);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  const published = await readStrictOwner(leaseDirectory);
  if (!sameOwner(published, owner)) {
    throw new InstallationLeaseLostError(leaseDirectory);
  }

  return createLease(leaseDirectory, Object.freeze({ ...owner }));
}

async function replaceAbandonedOwner(
  leaseDirectory: string,
  stagingDirectory: string,
  expectedOwner: InstallationLeaseOwner
): Promise<void> {
  const immediatelyObserved = await readStrictOwner(leaseDirectory);
  if (!sameOwner(immediatelyObserved, expectedOwner)) {
    throw new InstallationLeaseUnavailableError(
      leaseDirectory,
      "unknown",
      immediatelyObserved
    );
  }

  const quarantine = `${leaseDirectory}.abandoned-${randomUUID()}`;
  try {
    await rename(leaseDirectory, quarantine);
  } catch (error) {
    if (isNotFound(error) || isPathCollision(error)) {
      throw new InstallationLeaseUnavailableError(
        leaseDirectory,
        "unknown",
        await readStrictOwner(leaseDirectory)
      );
    }
    throw error;
  }

  const quarantinedOwner = await readStrictOwner(quarantine);
  if (!sameOwner(quarantinedOwner, expectedOwner)) {
    await restoreQuarantine(quarantine, leaseDirectory);
    throw new InstallationLeaseUnavailableError(
      leaseDirectory,
      "unknown",
      await readStrictOwner(leaseDirectory)
    );
  }

  try {
    await rename(stagingDirectory, leaseDirectory);
  } catch (error) {
    await restoreQuarantine(quarantine, leaseDirectory);
    if (isPathCollision(error) || isNotFound(error)) {
      throw new InstallationLeaseUnavailableError(
        leaseDirectory,
        "unknown",
        await readStrictOwner(leaseDirectory)
      );
    }
    throw error;
  }

  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
}

function createLease(
  leaseDirectory: string,
  owner: Readonly<InstallationLeaseOwner>
): InstallationLease {
  return {
    owner,
    async assertCurrent(): Promise<void> {
      if (!sameOwner(await readStrictOwner(leaseDirectory), owner)) {
        throw new InstallationLeaseLostError(leaseDirectory);
      }
    },
    async release(): Promise<void> {
      const current = await readStrictOwner(leaseDirectory);
      if (!sameOwner(current, owner)) return;

      const quarantine = `${leaseDirectory}.released-${randomUUID()}`;
      try {
        await rename(leaseDirectory, quarantine);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }

      const captured = await readStrictOwner(quarantine);
      if (!sameOwner(captured, owner)) {
        await restoreQuarantine(quarantine, leaseDirectory);
        throw new InstallationLeaseLostError(leaseDirectory);
      }
      await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

async function writeOwnerDirectory(
  directory: string,
  owner: InstallationLeaseOwner
): Promise<void> {
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const ownerFile = await open(path.join(directory, OWNER_FILE_NAME), "wx", 0o600);
  try {
    await ownerFile.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await ownerFile.sync();
  } finally {
    await ownerFile.close();
  }
  await syncDirectoryWhenSupported(directory);
}

async function syncDirectoryWhenSupported(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isDirectorySyncUnsupported(error)) throw error;
  }
}

async function readStrictOwner(
  directory: string
): Promise<InstallationLeaseOwner | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(directory, OWNER_FILE_NAME), "utf8"));
  } catch (error) {
    if (isNotFound(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
  return parseOwner(value);
}

function parseOwner(value: unknown): InstallationLeaseOwner | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "acquiredAt",
    "daemonEpoch",
    "nonce",
    "pid",
    "processStartIdentity",
    "schemaVersion"
  ];
  if (Object.keys(record).sort().join("\0") !== expectedKeys.join("\0")) return undefined;
  if (
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    !isNonEmptyString(record.processStartIdentity) ||
    !isNonEmptyString(record.nonce) ||
    !isNonEmptyString(record.daemonEpoch) ||
    !isCanonicalTimestamp(record.acquiredAt)
  ) return undefined;
  return record as unknown as InstallationLeaseOwner;
}

function sameOwner(
  actual: InstallationLeaseOwner | undefined,
  expected: Readonly<InstallationLeaseOwner>
): boolean {
  return actual !== undefined &&
    actual.schemaVersion === expected.schemaVersion &&
    actual.pid === expected.pid &&
    actual.processStartIdentity === expected.processStartIdentity &&
    actual.nonce === expected.nonce &&
    actual.daemonEpoch === expected.daemonEpoch &&
    actual.acquiredAt === expected.acquiredAt;
}

async function restoreQuarantine(quarantine: string, leaseDirectory: string): Promise<void> {
  try {
    await rename(quarantine, leaseDirectory);
  } catch (error) {
    if (!isPathCollision(error)) throw error;
  }
}

function requireNonEmpty(value: string, field: string): string {
  if (!isNonEmptyString(value)) throw new Error(`Installation lease ${field} must be non-empty.`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizeProcessIdentityStatus(value: unknown): ProcessIdentityStatus {
  return value === "same" || value === "different" || value === "dead" || value === "unknown"
    ? value
    : "unknown";
}

function isPathCollision(error: unknown): boolean {
  return isErrno(error) && ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code ?? "");
}

function isNotFound(error: unknown): boolean {
  return isErrno(error) && error.code === "ENOENT";
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return isErrno(error) && ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error.code ?? "");
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
