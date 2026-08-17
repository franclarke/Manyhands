import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const OWNER_FILE_NAME = "owner.json";
const GUARD_TICKET_FILE_NAME = "ticket.json";
const GUARD_RETRY_MS = 5;
const GUARD_TIMEOUT_MS = 30_000;

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

export interface InstallationLeaseTestHooks {
  /** @internal Deterministic interleaving seam for the release fencing regression. */
  afterReleaseOwnerObserved?: () => void | Promise<void>;
  /** @internal Pauses a takeover while it holds the installation guard. */
  afterTakeoverOwnerObserved?: () => void | Promise<void>;
  /** @internal Signals that this operation is waiting behind a live guard claim. */
  afterGuardBlocked?: () => void | Promise<void>;
}

export interface AcquireInstallationLeaseOptions {
  processStartIdentity: string;
  processIdentityProbe: ProcessIdentityProbe;
  pid?: number;
  createNonce?: () => string;
  createDaemonEpoch?: () => string;
  now?: () => Date;
  testHooks?: InstallationLeaseTestHooks;
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

interface GuardClaimOwner {
  schemaVersion: 1;
  claimId: string;
  pid: number;
  processStartIdentity: string;
  claimedAt: string;
}

interface GuardTicket {
  schemaVersion: 1;
  number: string;
}

interface GuardClaim {
  directory: string;
  owner: GuardClaimOwner;
  ticket?: bigint;
}

interface GuardContext {
  pid: number;
  processStartIdentity: string;
  processIdentityProbe: ProcessIdentityProbe;
  testHooks?: InstallationLeaseTestHooks;
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
  assertValidPid(owner.pid);

  await mkdir(path.dirname(leaseDirectory), { recursive: true });
  const stagingDirectory = `${leaseDirectory}.staging-${randomUUID()}`;
  try {
    await writeJsonDirectory(stagingDirectory, owner);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const guardContext = createGuardContext(owner, options);
  try {
    await withInstallationGuard(leaseDirectory, guardContext, async () => {
      await publishInstallationOwner(leaseDirectory, stagingDirectory, owner, options);
      if (!sameOwner(await readStrictOwner(leaseDirectory), owner)) {
        throw new InstallationLeaseLostError(leaseDirectory);
      }
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  return createLease(leaseDirectory, Object.freeze({ ...owner }), guardContext);
}

async function publishInstallationOwner(
  leaseDirectory: string,
  stagingDirectory: string,
  owner: InstallationLeaseOwner,
  options: AcquireInstallationLeaseOptions
): Promise<void> {
  try {
    await rename(stagingDirectory, leaseDirectory);
    return;
  } catch (error) {
    if (!isPathCollision(error)) throw error;
  }

  const currentOwner = await readStrictOwner(leaseDirectory);
  const status = currentOwner === undefined
    ? "unknown"
    : await probeProcessIdentity(options.processIdentityProbe, currentOwner);
  if (currentOwner === undefined || status === "same" || status === "unknown") {
    throw new InstallationLeaseUnavailableError(leaseDirectory, status, currentOwner);
  }
  await options.testHooks?.afterTakeoverOwnerObserved?.();
  await replaceAbandonedOwner(leaseDirectory, stagingDirectory, currentOwner);

  if (!sameOwner(await readStrictOwner(leaseDirectory), owner)) {
    throw new InstallationLeaseLostError(leaseDirectory);
  }
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
    await renameWithRetry(leaseDirectory, quarantine);
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
    await renameWithRetry(stagingDirectory, leaseDirectory);
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
  owner: Readonly<InstallationLeaseOwner>,
  guardContext: GuardContext
): InstallationLease {
  return {
    owner,
    async assertCurrent(): Promise<void> {
      await withInstallationGuard(leaseDirectory, guardContext, async () => {
        if (!sameOwner(await readStrictOwner(leaseDirectory), owner)) {
          throw new InstallationLeaseLostError(leaseDirectory);
        }
      });
    },
    async release(): Promise<void> {
      await withInstallationGuard(leaseDirectory, guardContext, async () => {
        const current = await readStrictOwner(leaseDirectory);
        if (!sameOwner(current, owner)) return;
        await guardContext.testHooks?.afterReleaseOwnerObserved?.();

        const quarantine = `${leaseDirectory}.released-${randomUUID()}`;
        try {
          await renameWithRetry(leaseDirectory, quarantine);
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
      });
    }
  };
}

async function withInstallationGuard<T>(
  leaseDirectory: string,
  context: GuardContext,
  operation: () => Promise<T>
): Promise<T> {
  const claim = await publishGuardClaim(leaseDirectory, context);
  try {
    const ticket = await publishGuardTicket(leaseDirectory, claim);
    await waitUntilGuardElected(leaseDirectory, claim.owner, ticket, context);
    return await operation();
  } finally {
    await removeGuardClaim(leaseDirectory, claim.directory);
  }
}

async function publishGuardClaim(
  leaseDirectory: string,
  context: GuardContext
): Promise<GuardClaim> {
  const guardDirectory = guardDirectoryFor(leaseDirectory);
  const claimsDirectory = path.join(guardDirectory, "claims");
  await mkdir(claimsDirectory, { recursive: true, mode: 0o700 });

  const claimId = randomUUID();
  const stagingDirectory = path.join(guardDirectory, `.claim-staging-${claimId}`);
  const claimDirectory = path.join(claimsDirectory, claimId);
  const owner: GuardClaimOwner = {
    schemaVersion: 1,
    claimId,
    pid: context.pid,
    processStartIdentity: context.processStartIdentity,
    claimedAt: new Date().toISOString()
  };
  try {
    await writeJsonDirectory(stagingDirectory, owner);
    await renameWithRetry(stagingDirectory, claimDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { directory: claimDirectory, owner };
}

async function publishGuardTicket(
  leaseDirectory: string,
  ownClaim: GuardClaim
): Promise<bigint> {
  const claims = await readGuardClaims(leaseDirectory);
  let maximumTicket = 0n;
  for (const claim of claims) {
    if (claim.ticket !== undefined && claim.ticket > maximumTicket) {
      maximumTicket = claim.ticket;
    }
  }
  const ticket = maximumTicket + 1n;
  await writeJsonFileAtomically(
    ownClaim.directory,
    GUARD_TICKET_FILE_NAME,
    { schemaVersion: 1, number: ticket.toString() } satisfies GuardTicket
  );
  return ticket;
}

async function waitUntilGuardElected(
  leaseDirectory: string,
  ownOwner: GuardClaimOwner,
  ownTicket: bigint,
  context: GuardContext
): Promise<void> {
  const deadline = Date.now() + GUARD_TIMEOUT_MS;
  for (;;) {
    let blocked = false;
    for (const claim of await readGuardClaims(leaseDirectory)) {
      if (claim.owner.claimId === ownOwner.claimId) continue;

      const isChoosing = claim.ticket === undefined;
      const hasPriority = claim.ticket !== undefined &&
        compareGuardPriority(claim.ticket, claim.owner.claimId, ownTicket, ownOwner.claimId) < 0;
      if (!isChoosing && !hasPriority) continue;

      if (isChoosing && Date.now() - Date.parse(claim.owner.claimedAt) > 2_000) {
        await removeGuardClaim(leaseDirectory, claim.directory);
        continue;
      }

      const status = sameProcessIdentity(claim.owner, context)
        ? "same"
        : await probeProcessIdentity(context.processIdentityProbe, claim.owner);
      if (status === "different" || status === "dead") {
        await removeGuardClaim(leaseDirectory, claim.directory);
        continue;
      }
      if (status === "unknown") {
        throw new Error(
          `Installation guard ${guardDirectoryFor(leaseDirectory)} has an owner with unknown identity.`
        );
      }
      blocked = true;
    }

    if (!blocked) return;
    await context.testHooks?.afterGuardBlocked?.();
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for installation guard ${guardDirectoryFor(leaseDirectory)}.`);
    }
    await delay(GUARD_RETRY_MS);
  }
}

async function readGuardClaims(leaseDirectory: string): Promise<GuardClaim[]> {
  const claimsDirectory = path.join(guardDirectoryFor(leaseDirectory), "claims");
  let entries;
  try {
    entries = await readdir(claimsDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const claims: GuardClaim[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      throw new Error(`Installation guard contains an invalid claim entry: ${entry.name}.`);
    }
    const directory = path.join(claimsDirectory, entry.name);
    const owner = await readGuardClaimOwner(directory);
    if (owner === undefined) continue;
    if (owner === null || owner.claimId !== entry.name) {
      throw new Error(`Installation guard contains an unreadable claim: ${entry.name}.`);
    }
    claims.push({
      directory,
      owner,
      ...await readGuardTicket(directory)
    });
  }
  return claims;
}

async function readGuardClaimOwner(
  directory: string
): Promise<GuardClaimOwner | null | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(directory, OWNER_FILE_NAME), "utf8"));
  } catch (error) {
    if (isNotFound(error)) {
      return await pathExists(directory) ? null : undefined;
    }
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expectedKeys = ["claimId", "claimedAt", "pid", "processStartIdentity", "schemaVersion"];
  if (Object.keys(record).sort().join("\0") !== expectedKeys.join("\0")) return null;
  if (
    record.schemaVersion !== 1 ||
    !isNonEmptyString(record.claimId) ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    !isNonEmptyString(record.processStartIdentity) ||
    !isCanonicalTimestamp(record.claimedAt)
  ) return null;
  return record as unknown as GuardClaimOwner;
}

async function removeGuardClaim(leaseDirectory: string, claimDirectory: string): Promise<void> {
  const quarantine = path.join(
    guardDirectoryFor(leaseDirectory),
    `.claim-released-${path.basename(claimDirectory)}-${randomUUID()}`
  );
  try {
    await renameWithRetry(claimDirectory, quarantine);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
}

async function readGuardTicket(directory: string): Promise<{ ticket?: bigint }> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(directory, GUARD_TICKET_FILE_NAME), "utf8"));
  } catch (error) {
    if (isNotFound(error)) return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Installation guard contains a corrupt ticket at ${directory}.`);
    }
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Installation guard contains an invalid ticket at ${directory}.`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !== "number\0schemaVersion" ||
    record.schemaVersion !== 1 ||
    typeof record.number !== "string" ||
    !/^[1-9][0-9]{0,39}$/.test(record.number)
  ) {
    throw new Error(`Installation guard contains an invalid ticket at ${directory}.`);
  }
  return { ticket: BigInt(record.number) };
}

function compareGuardPriority(
  leftTicket: bigint,
  leftClaimId: string,
  rightTicket: bigint,
  rightClaimId: string
): number {
  if (leftTicket < rightTicket) return -1;
  if (leftTicket > rightTicket) return 1;
  return leftClaimId.localeCompare(rightClaimId);
}

function sameProcessIdentity(owner: GuardClaimOwner, context: GuardContext): boolean {
  return owner.pid === context.pid &&
    owner.processStartIdentity === context.processStartIdentity;
}

function createGuardContext(
  owner: InstallationLeaseOwner,
  options: AcquireInstallationLeaseOptions
): GuardContext {
  const context: GuardContext = {
    pid: owner.pid,
    processStartIdentity: owner.processStartIdentity,
    processIdentityProbe: options.processIdentityProbe
  };
  if (options.testHooks !== undefined) context.testHooks = options.testHooks;
  return context;
}

function guardDirectoryFor(leaseDirectory: string): string {
  return `${leaseDirectory}.guard`;
}

async function writeJsonDirectory(directory: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const ownerFile = await open(path.join(directory, OWNER_FILE_NAME), "wx", 0o600);
  try {
    await ownerFile.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await ownerFile.sync();
  } finally {
    await ownerFile.close();
  }
  await syncDirectoryWhenSupported(directory);
}

async function writeJsonFileAtomically(
  directory: string,
  fileName: string,
  value: unknown
): Promise<void> {
  const stagingPath = path.join(directory, `.${fileName}.staging-${randomUUID()}`);
  const targetPath = path.join(directory, fileName);
  const handle = await open(stagingPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(stagingPath, targetPath);
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined);
  }
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

async function probeProcessIdentity(
  probe: ProcessIdentityProbe,
  owner: Pick<InstallationLeaseOwner, "pid" | "processStartIdentity">
): Promise<ProcessIdentityStatus> {
  try {
    return normalizeProcessIdentityStatus(await probe.probe({
      pid: owner.pid,
      processStartIdentity: owner.processStartIdentity
    }));
  } catch {
    return "unknown";
  }
}

async function restoreQuarantine(quarantine: string, leaseDirectory: string): Promise<void> {
  try {
    await renameWithRetry(quarantine, leaseDirectory);
  } catch (error) {
    if (!isPathCollision(error)) throw error;
  }
}

async function renameWithRetry(
  source: string,
  destination: string,
  maxAttempts = 80
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (attempt < maxAttempts && isTransientWindowsRenameError(error)) {
        await delay(5 + Math.floor(Math.random() * 15));
        continue;
      }
      throw error;
    }
  }
}

function assertValidPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Installation lease pid must be a positive safe integer.");
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return isErrno(error) && ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error.code ?? "");
}

function isTransientWindowsRenameError(error: unknown): boolean {
  return isErrno(error) && ["EACCES", "EBUSY", "EPERM"].includes(error.code ?? "");
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
