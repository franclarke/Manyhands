import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ProcessIdentitySchema, type ProcessIdentity } from "@manyhands/contracts";

const CommonReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  effectId: z.string().min(1),
  inputDigest: z.string().min(1),
  daemonEpoch: z.string().min(1),
  attemptId: z.string().min(1).optional(),
  processIdentity: ProcessIdentitySchema,
  custodianIdentity: ProcessIdentitySchema,
  platformOwnership: z.string().min(1),
  stdoutPath: z.string().min(1),
  stderrPath: z.string().min(1)
}).strict();

export const ProcessSupervisorStartedReceiptSchema = CommonReceiptSchema.extend({
  phase: z.literal("started"),
  startedAtEpochMs: z.number().int().nonnegative(),
  receiptChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();

export const ProcessSupervisorFinalReceiptSchema = CommonReceiptSchema.extend({
  phase: z.literal("final"),
  outcome: z.enum(["succeeded", "failed", "terminated", "timed_out", "interrupted"]),
  exitCode: z.number().int().nullable(),
  reason: z.string().min(1).optional(),
  completedAtEpochMs: z.number().int().nonnegative(),
  startedReceiptChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  receiptChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();

export const ProcessSupervisorReceiptSchema = z.discriminatedUnion("phase", [
  ProcessSupervisorStartedReceiptSchema,
  ProcessSupervisorFinalReceiptSchema
]);

export type ProcessSupervisorStartedReceipt = z.infer<typeof ProcessSupervisorStartedReceiptSchema>;
export type ProcessSupervisorFinalReceipt = z.infer<typeof ProcessSupervisorFinalReceiptSchema>;
export type ProcessSupervisorReceipt = z.infer<typeof ProcessSupervisorReceiptSchema>;

export interface ProcessSpawnRequest {
  effectId: string;
  inputDigest: string;
  daemonEpoch: string;
  attemptId?: string;
  executable: string;
  argv: readonly string[];
  cwd: string;
  /** Complete child environment. The supervisor never inherits host variables implicitly. */
  env: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface ProcessSupervisorOptions {
  receiptRoot: string;
  platform?: NodeJS.Platform;
  windowsJobRunnerPath?: string;
  startupTimeoutMs?: number;
}

export interface SupervisedProcess {
  readonly started: ProcessSupervisorStartedReceipt;
  readonly custodianPid: number;
  readonly completion: Promise<ProcessSupervisorFinalReceipt>;
  terminate(reason?: string): Promise<ProcessSupervisorFinalReceipt>;
}

interface RunningProcess {
  child: ChildProcess;
  started: ProcessSupervisorStartedReceipt;
  completion: Promise<ProcessSupervisorFinalReceipt>;
  termination?: { outcome: "terminated" | "timed_out"; reason: string };
  terminationVerification?: Promise<void>;
}

interface HelperRequest {
  receiptDirectory: string;
  effectId: string;
  inputDigest: string;
  daemonEpoch: string;
  attemptId?: string;
  supervisorNonce: string;
  platformOwnership: string;
  cwd: string;
  executable: string;
  stdoutPath: string;
  stderrPath: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
}

const RECEIPT_FILES = ["started.json", "final.json"] as const;
const MAX_HELPER_DIAGNOSTICS = 32 * 1024;

/**
 * Owns the physical process tree for one durable process effect. The caller
 * supplies an already-journaled effect identity; this module owns only physical
 * receipts and never changes run lifecycle state.
 */
export class ProcessSupervisor {
  private readonly receiptRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly windowsJobRunnerPath: string | undefined;
  private readonly startupTimeoutMs: number;
  private readonly running = new Map<string, RunningProcess>();

  constructor(options: ProcessSupervisorOptions) {
    if (!path.isAbsolute(options.receiptRoot)) {
      throw new Error("Process supervisor receipt root must be an absolute path.");
    }
    this.receiptRoot = path.resolve(options.receiptRoot);
    this.platform = options.platform ?? process.platform;
    this.windowsJobRunnerPath = options.windowsJobRunnerPath;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  }

  async spawn(requestInput: ProcessSpawnRequest): Promise<SupervisedProcess> {
    const request = validateSpawnRequest(requestInput);
    const existing = await readProcessSupervisorReceipts(this.receiptRoot, request.effectId);
    const final = existing.find(isFinalReceipt);
    if (final !== undefined) {
      const started = existing.find(isStartedReceipt);
      if (started === undefined) throw new Error(`Final process receipt ${request.effectId} has no started observation.`);
      assertReceiptBinding(started, request);
      return completedHandle(final, existing);
    }
    if (existing.length > 0 || await effectDirectoryExists(this.receiptRoot, request.effectId)) {
      throw new Error(
        `Process effect ${request.effectId} already has physical state; reconcile it before any repeat.`
      );
    }

    if (this.platform !== "win32") {
      throw new Error(
        "POSIX process supervision is unavailable until a verified parent-death and process-group adapter is installed."
      );
    }
    const helper = this.windowsJobRunnerPath;
    if (helper === undefined || !path.isAbsolute(helper) || !await isExecutableFile(helper)) {
      throw new Error("Windows Job Object helper is unavailable or unbuilt; refusing unsupervised spawn.");
    }
    return this.spawnWindows(request, path.resolve(helper));
  }

  async terminate(effectId: string, reason = "termination_requested"): Promise<ProcessSupervisorFinalReceipt> {
    const current = this.running.get(effectId);
    if (current !== undefined) {
      current.termination = { outcome: "terminated", reason };
      current.terminationVerification ??= this.terminateWindowsTree(current.started);
      return current.completion;
    }

    const receipts = await readProcessSupervisorReceipts(this.receiptRoot, effectId);
    const final = receipts.find(isFinalReceipt);
    if (final !== undefined) return final;
    const started = receipts.find(isStartedReceipt);
    if (started === undefined) throw new Error(`Process effect ${effectId} has no durable started receipt.`);
    await this.terminateWindowsTree(started);
    return writeSyntheticFinal(this.receiptRoot, started, "terminated", reason);
  }

  readReceipts(effectId: string): Promise<ProcessSupervisorReceipt[]> {
    return readProcessSupervisorReceipts(this.receiptRoot, effectId);
  }

  private async spawnWindows(
    request: ProcessSpawnRequest,
    helperPath: string
  ): Promise<SupervisedProcess> {
    const paths = await claimEffectDirectory(this.receiptRoot, request.effectId);
    const helperRequest: HelperRequest = {
      receiptDirectory: paths.directory,
      effectId: request.effectId,
      inputDigest: request.inputDigest,
      daemonEpoch: request.daemonEpoch,
      ...(request.attemptId === undefined ? {} : { attemptId: request.attemptId }),
      supervisorNonce: `nonce:${randomUUID()}`,
      platformOwnership: `Local\\ManyHands-${effectDirectoryName(request.effectId)}`,
      cwd: request.cwd,
      executable: request.executable,
      stdoutPath: paths.stdout,
      stderrPath: paths.stderr,
      argv: request.argv,
      env: request.env
    };
    await writeWindowsHelperRequest(paths.request, helperRequest);

    let child: ChildProcess;
    try {
      child = spawn(helperPath, ["run", paths.request], {
        cwd: request.cwd,
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true
      });
    } catch (error) {
      await rm(paths.directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return this.bindHelper(request, child);
  }

  private async bindHelper(request: ProcessSpawnRequest, child: ChildProcess): Promise<SupervisedProcess> {
    const diagnostics: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      if (diagnostics.join("").length < MAX_HELPER_DIAGNOSTICS) diagnostics.push(chunk.toString("utf8"));
    });
    const closed = waitForChildClose(child);
    const handshake = await waitForHandshake(child, closed, this.startupTimeoutMs);
    if (handshake !== "STARTED") {
      const receipts = await readProcessSupervisorReceipts(this.receiptRoot, request.effectId);
      const final = receipts.find(isFinalReceipt);
      throw new Error(
        final?.reason ?? (diagnostics.join("") || "Process supervisor helper failed before custody.")
      );
    }
    const receipts = await readProcessSupervisorReceipts(this.receiptRoot, request.effectId);
    const started = receipts.find(isStartedReceipt);
    if (started === undefined) throw new Error("Supervisor helper acknowledged start without a durable started receipt.");
    assertReceiptBinding(started, request);

    const running: RunningProcess = {
      child,
      started,
      completion: Promise.resolve(undefined as never)
    };
    running.completion = this.completeAfterHelperExit(request.effectId, running, closed, diagnostics);
    this.running.set(request.effectId, running);
    if (request.timeoutMs !== undefined) {
      const timer = setTimeout(() => {
        running.termination = { outcome: "timed_out", reason: `timeout_after_${request.timeoutMs}ms` };
        running.terminationVerification ??= this.terminateWindowsTree(running.started);
      }, request.timeoutMs);
      timer.unref();
      void running.completion.finally(() => clearTimeout(timer));
    }
    return {
      started,
      custodianPid: started.custodianIdentity.pid,
      completion: running.completion,
      terminate: (reason) => this.terminate(request.effectId, reason)
    };
  }

  private async completeAfterHelperExit(
    effectId: string,
    running: RunningProcess,
    closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
    diagnostics: readonly string[]
  ): Promise<ProcessSupervisorFinalReceipt> {
    const helperExit = await closed;
    this.running.delete(effectId);
    const receipts = await readProcessSupervisorReceipts(this.receiptRoot, effectId);
    const durableFinal = receipts.find(isFinalReceipt);
    if (durableFinal !== undefined) return durableFinal;

    if (running.termination !== undefined) {
      if (running.terminationVerification === undefined) {
        throw new Error(`Process termination for ${effectId} has no verification operation.`);
      }
      await running.terminationVerification;
      return writeSyntheticFinal(
        this.receiptRoot,
        running.started,
        running.termination.outcome,
        running.termination.reason
      );
    }
    const detail = diagnostics.join("").trim();
    throw new Error(
      `Process custody ended without a verified terminal receipt for ${effectId}: ${detail || helperExit.code || helperExit.signal || "unknown"}`
    );
  }

  private async terminateWindowsTree(started: ProcessSupervisorStartedReceipt): Promise<void> {
    if (this.platform !== "win32") {
      throw new Error("Verified process-tree termination is unavailable on this platform.");
    }
    const helper = this.windowsJobRunnerPath;
    if (helper === undefined || !await isExecutableFile(helper)) {
      throw new Error("Windows Job Object helper is unavailable or unbuilt; refusing blind kill.");
    }
    await runWindowsTerminationHelper(helper, started);
    await waitForOwnedIdentitiesGone(started, helper);
  }
}

export async function readProcessSupervisorReceipts(
  receiptRoot: string,
  effectId: string
): Promise<ProcessSupervisorReceipt[]> {
  const directory = effectDirectory(receiptRoot, effectId);
  const receipts: ProcessSupervisorReceipt[] = [];
  for (const fileName of RECEIPT_FILES) {
    try {
      const parsed = ProcessSupervisorReceiptSchema.parse(
        JSON.parse(await readFile(path.join(directory, fileName), "utf8"))
      );
      if (parsed.effectId !== effectId) {
        throw new Error(`Supervisor receipt directory for ${effectId} contains a receipt for ${parsed.effectId}.`);
      }
      assertReceiptChecksum(parsed);
      receipts.push(parsed);
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      throw error;
    }
  }
  const started = receipts.find(isStartedReceipt);
  const final = receipts.find(isFinalReceipt);
  if (final !== undefined && started === undefined) {
    throw new Error(`Process effect ${effectId} has a terminal receipt without a started receipt.`);
  }
  if (started !== undefined && final !== undefined) {
    for (const key of [
      "effectId",
      "inputDigest",
      "daemonEpoch",
      "attemptId",
      "platformOwnership",
      "stdoutPath",
      "stderrPath"
    ] as const) {
      if (started[key] !== final[key]) throw new Error(`Process receipt ${key} binding changed for ${effectId}.`);
    }
    if (JSON.stringify(started.processIdentity) !== JSON.stringify(final.processIdentity)) {
      throw new Error(`Process identity binding changed for ${effectId}.`);
    }
    if (JSON.stringify(started.custodianIdentity) !== JSON.stringify(final.custodianIdentity)) {
      throw new Error(`Process custodian identity binding changed for ${effectId}.`);
    }
    if (final.startedReceiptChecksum !== started.receiptChecksum) {
      throw new Error(`Process final receipt is not bound to the exact started receipt for ${effectId}.`);
    }
  }
  return receipts;
}

function validateSpawnRequest(input: ProcessSpawnRequest): ProcessSpawnRequest {
  if (typeof input !== "object" || input === null) throw new Error("Process spawn request is required.");
  for (const [name, value] of [
    ["effectId", input.effectId],
    ["inputDigest", input.inputDigest],
    ["daemonEpoch", input.daemonEpoch]
  ] as const) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      throw new Error(`${name} must be a non-empty string without NUL bytes.`);
    }
  }
  if (typeof input.executable !== "string" || !path.isAbsolute(input.executable)) {
    throw new Error("Process executable must be an absolute path.");
  }
  if (typeof input.cwd !== "string" || !path.isAbsolute(input.cwd)) {
    throw new Error("Process working directory must be an absolute path.");
  }
  if (!Array.isArray(input.argv) || input.argv.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new Error("Process argv must be an explicit string array without NUL bytes.");
  }
  if (typeof input.env !== "object" || input.env === null || Array.isArray(input.env)) {
    throw new Error("Process environment must be explicit.");
  }
  for (const [key, value] of Object.entries(input.env)) {
    if (key.length === 0 || key.includes("=") || key.includes("\0") || typeof value !== "string" || value.includes("\0")) {
      throw new Error("Process environment contains an invalid key or value.");
    }
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new Error("Process timeout must be a positive integer.");
  }
  return { ...input, argv: [...input.argv], env: { ...input.env } };
}

function completedHandle(
  final: ProcessSupervisorFinalReceipt,
  receipts: readonly ProcessSupervisorReceipt[]
): SupervisedProcess {
  const started = receipts.find(isStartedReceipt);
  if (started === undefined) throw new Error(`Final process receipt ${final.effectId} has no started observation.`);
  return {
    started,
    custodianPid: started.custodianIdentity.pid,
    completion: Promise.resolve(final),
    terminate: async () => final
  };
}

function isStartedReceipt(receipt: ProcessSupervisorReceipt): receipt is ProcessSupervisorStartedReceipt {
  return receipt.phase === "started";
}

function isFinalReceipt(receipt: ProcessSupervisorReceipt): receipt is ProcessSupervisorFinalReceipt {
  return receipt.phase === "final";
}

function assertReceiptBinding(receipt: ProcessSupervisorStartedReceipt, request: ProcessSpawnRequest): void {
  if (
    receipt.effectId !== request.effectId
    || receipt.inputDigest !== request.inputDigest
    || receipt.daemonEpoch !== request.daemonEpoch
    || receipt.attemptId !== request.attemptId
  ) {
    throw new Error(`Supervisor helper returned a started receipt bound to different effect inputs.`);
  }
}

function effectDirectory(receiptRoot: string, effectId: string): string {
  return path.join(path.resolve(receiptRoot), effectDirectoryName(effectId));
}

function effectDirectoryName(effectId: string): string {
  return createHash("sha256").update(effectId).digest("hex");
}

async function effectDirectoryExists(receiptRoot: string, effectId: string): Promise<boolean> {
  try {
    await access(effectDirectory(receiptRoot, effectId), constants.F_OK);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

async function claimEffectDirectory(receiptRoot: string, effectId: string): Promise<{
  directory: string;
  request: string;
  stdout: string;
  stderr: string;
}> {
  await mkdir(path.resolve(receiptRoot), { recursive: true });
  const directory = effectDirectory(receiptRoot, effectId);
  await mkdir(directory);
  return {
    directory,
    request: path.join(directory, "request.bin"),
    stdout: path.join(directory, "stdout.log"),
    stderr: path.join(directory, "stderr.log")
  };
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  const temporary = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // Publishing by hard-link is atomic and exclusive: an existing receipt is
    // never replaced, even after a crash or concurrent recovery attempt.
    await link(temporary, filePath);
    await rm(temporary, { force: true }).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeWindowsHelperRequest(filePath: string, request: HelperRequest): Promise<void> {
  const fields = [
    request.receiptDirectory,
    request.effectId,
    request.inputDigest,
    request.daemonEpoch,
    request.attemptId ?? "",
    request.supervisorNonce,
    request.platformOwnership,
    request.cwd,
    request.executable,
    request.stdoutPath,
    request.stderrPath
  ];
  const chunks: Buffer[] = [Buffer.from("MHJR1\0", "ascii")];
  for (const field of fields) chunks.push(lengthPrefixed(field));
  chunks.push(u32(request.argv.length));
  for (const argument of request.argv) chunks.push(lengthPrefixed(argument));
  const environment = Object.entries(request.env).sort(([left], [right]) => left.localeCompare(right));
  chunks.push(u32(environment.length));
  for (const [key, value] of environment) {
    chunks.push(lengthPrefixed(key), lengthPrefixed(value));
  }
  await atomicWrite(filePath, Buffer.concat(chunks));
}

function lengthPrefixed(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  return Buffer.concat([u32(encoded.length), encoded]);
}

function u32(value: number): Buffer {
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32LE(value, 0);
  return encoded;
}

function waitForChildClose(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHandshake(
  child: ChildProcess,
  closed: Promise<unknown>,
  timeoutMs: number
): Promise<"STARTED" | "FAILED"> {
  if (child.stdout === null) throw new Error("Process supervisor helper has no handshake channel.");
  const handshake = new Promise<"STARTED" | "FAILED">((resolve, reject) => {
    let buffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split(/\r?\n/, 1)[0];
      if (line === "STARTED" || line === "FAILED") resolve(line);
      else if (buffer.includes("\n")) reject(new Error(`Invalid process supervisor handshake: ${line}`));
    });
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      handshake,
      closed.then(() => { throw new Error("Process supervisor helper exited before its durable handshake."); }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for process supervisor custody.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function writeSyntheticFinal(
  receiptRoot: string,
  started: ProcessSupervisorStartedReceipt,
  outcome: "terminated" | "timed_out" | "interrupted",
  reason: string
): Promise<ProcessSupervisorFinalReceipt> {
  const existing = (await readProcessSupervisorReceipts(receiptRoot, started.effectId)).find(isFinalReceipt);
  if (existing !== undefined) return existing;
  const material = {
    schemaVersion: 1,
    effectId: started.effectId,
    inputDigest: started.inputDigest,
    daemonEpoch: started.daemonEpoch,
    ...(started.attemptId === undefined ? {} : { attemptId: started.attemptId }),
    processIdentity: started.processIdentity,
    custodianIdentity: started.custodianIdentity,
    platformOwnership: started.platformOwnership,
    stdoutPath: started.stdoutPath,
    stderrPath: started.stderrPath,
    phase: "final",
    outcome,
    exitCode: null,
    reason,
    completedAtEpochMs: Date.now(),
    startedReceiptChecksum: started.receiptChecksum
  } as const;
  const final = ProcessSupervisorFinalReceiptSchema.parse({
    ...material,
    receiptChecksum: receiptChecksum(material)
  });
  await atomicWrite(
    path.join(effectDirectory(receiptRoot, started.effectId), "final.json"),
    `${JSON.stringify(final)}\n`
  );
  return final;
}

async function runWindowsTerminationHelper(
  helperPath: string,
  started: ProcessSupervisorStartedReceipt
): Promise<void> {
  const result = spawn(helperPath, [
    "terminate",
    started.platformOwnership,
    String(started.processIdentity.pid),
    started.processIdentity.creationIdentity,
    String(started.custodianIdentity.pid),
    started.custodianIdentity.creationIdentity
  ], { stdio: "ignore", shell: false, windowsHide: true });
  const { code } = await waitForChildClose(result);
  if (code !== 0) throw new Error(`Windows process termination helper failed with exit code ${code}.`);
}

async function waitForOwnedIdentitiesGone(
  started: ProcessSupervisorStartedReceipt,
  windowsHelperPath: string
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [provider, custodian] = await Promise.all([
      probeWindowsIdentity(windowsHelperPath, started.processIdentity),
      probeWindowsIdentity(windowsHelperPath, started.custodianIdentity)
    ]);
    if ((provider === "dead" || provider === "different")
      && (custodian === "dead" || custodian === "different")) return;
    if (provider === "unknown" || custodian === "unknown") {
      throw new Error(`Owned process identities for ${started.effectId} are unknowable.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Supervised process tree ${started.effectId} remained alive after verified Job termination.`);
}

async function probeWindowsIdentity(
  helperPath: string | undefined,
  identity: ProcessIdentity
): Promise<"same" | "different" | "dead" | "unknown"> {
  if (helperPath === undefined || !await isExecutableFile(helperPath)) return "unknown";
  const child = spawn(helperPath, ["probe", String(identity.pid), identity.creationIdentity], {
    stdio: ["ignore", "pipe", "ignore"],
    shell: false,
    windowsHide: true
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  await waitForChildClose(child);
  const status = stdout.trim();
  return status === "same" || status === "different" || status === "dead" ? status : "unknown";
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function receiptChecksum(material: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(material)).digest("hex")}`;
}

function receiptMaterial(receipt: ProcessSupervisorReceipt): object {
  const common = {
    schemaVersion: receipt.schemaVersion,
    effectId: receipt.effectId,
    inputDigest: receipt.inputDigest,
    daemonEpoch: receipt.daemonEpoch,
    ...(receipt.attemptId === undefined ? {} : { attemptId: receipt.attemptId }),
    processIdentity: receipt.processIdentity,
    custodianIdentity: receipt.custodianIdentity,
    platformOwnership: receipt.platformOwnership,
    stdoutPath: receipt.stdoutPath,
    stderrPath: receipt.stderrPath
  };
  return receipt.phase === "started"
    ? { ...common, phase: receipt.phase, startedAtEpochMs: receipt.startedAtEpochMs }
    : {
        ...common,
        phase: receipt.phase,
        outcome: receipt.outcome,
        exitCode: receipt.exitCode,
        ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
        completedAtEpochMs: receipt.completedAtEpochMs,
        startedReceiptChecksum: receipt.startedReceiptChecksum
      };
}

function assertReceiptChecksum(receipt: ProcessSupervisorReceipt): void {
  if (receipt.receiptChecksum !== receiptChecksum(receiptMaterial(receipt))) {
    throw new Error(`Process supervisor receipt checksum mismatch for ${receipt.effectId}/${receipt.phase}.`);
  }
}
