import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ProcessSupervisor,
  readProcessSupervisorReceipts,
  type ProcessSpawnRequest
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
let suiteDirectory: string;
let helperPath: string;

beforeAll(async () => {
  suiteDirectory = await mkdtemp(path.join(os.tmpdir(), "mh-process-supervisor-physical-"));
  helperPath = path.join(suiteDirectory, "manyhands-windows-job-runner.exe");
  if (process.platform === "win32") {
    await execFileAsync("rustc.exe", [
      path.resolve("native/windows-job-runner/src/main.rs"),
      "--edition=2021",
      "-O",
      "-o",
      helperPath
    ], { windowsHide: true });
    await access(helperPath);
  }
}, 60_000);

afterAll(async () => {
  await rm(suiteDirectory, { recursive: true, force: true }).catch(() => undefined);
});

describe.skipIf(process.platform !== "win32")("ProcessSupervisor physical Windows custody", () => {
  it("uses a shell-free argv and captures a durable successful final receipt", async () => {
    const receiptRoot = path.join(suiteDirectory, "success-receipts");
    const shellMarker = path.join(suiteDirectory, "must-not-exist.txt");
    const literal = `literal & echo owned > ${shellMarker}`;
    const supervisor = windowsSupervisor(receiptRoot);
    const handle = await supervisor.spawn(request("effect:success", [
      "-e",
      "process.stdout.write(process.argv[1]); process.stderr.write('diagnostic');",
      literal
    ]));

    const final = await handle.completion;

    expect(final).toMatchObject({ phase: "final", outcome: "succeeded", exitCode: 0 });
    expect(final.startedReceiptChecksum).toBe(handle.started.receiptChecksum);
    expect(await readFile(final.stdoutPath, "utf8")).toBe(literal);
    expect(await readFile(final.stderrPath, "utf8")).toBe("diagnostic");
    await expect(access(shellMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:success")).toEqual([
      expect.objectContaining({
        phase: "started",
        receiptChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        processIdentity: expect.objectContaining({
          pid: expect.any(Number),
          creationIdentity: expect.stringMatching(/^windows-filetime:\d+$/),
          supervisorNonce: expect.any(String)
        }),
        custodianIdentity: expect.objectContaining({
          pid: expect.any(Number),
          creationIdentity: expect.stringMatching(/^windows-filetime:\d+$/)
        })
      }),
      expect.objectContaining({
        phase: "final",
        outcome: "succeeded",
        exitCode: 0,
        startedReceiptChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        receiptChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    ]);
    await expect(supervisor.spawn({
      ...request("effect:success", ["-e", "process.exit(0)"]),
      inputDigest: "sha256:different-input"
    })).rejects.toThrow(/different effect inputs/i);
  }, 30_000);

  it("closes Job Object ownership and prevents both child and grandchild late writes", async () => {
    const receiptRoot = path.join(suiteDirectory, "termination-receipts");
    const pidFile = path.join(suiteDirectory, "tree-pids.json");
    const childMarker = path.join(suiteDirectory, "child-late.txt");
    const grandchildMarker = path.join(suiteDirectory, "grandchild-late.txt");
    const childProgram = [
      "const {spawn}=require('node:child_process');",
      "const {writeFileSync}=require('node:fs');",
      "const [pidFile,childMarker,grandchildMarker]=process.argv.slice(1);",
      "const grandchild=spawn(process.execPath,['-e',",
      "  `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(grandchildMarker)},'late'),1800);setInterval(()=>{},1000)`",
      "],{stdio:'ignore'});",
      "writeFileSync(pidFile,JSON.stringify({child:process.pid,grandchild:grandchild.pid}));",
      "setTimeout(()=>writeFileSync(childMarker,'late'),1800);",
      "setInterval(()=>{},1000);"
    ].join("");
    const supervisor = windowsSupervisor(receiptRoot);
    const handle = await supervisor.spawn(request("effect:tree", [
      "-e",
      childProgram,
      pidFile,
      childMarker,
      grandchildMarker
    ]));
    const pids = await waitForJson<{ child: number; grandchild: number }>(pidFile);

    const final = await handle.terminate("test_requested");
    expect(isAlive(pids.child) || isAlive(pids.grandchild)).toBe(false);
    await waitUntil(() => !isAlive(pids.child) && !isAlive(pids.grandchild));
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    expect(final).toMatchObject({ phase: "final", outcome: "terminated", reason: "test_requested" });
    await expect(access(childMarker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(grandchildMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readProcessSupervisorReceipts(receiptRoot, "effect:tree")).at(-1))
      .toMatchObject({ phase: "final", outcome: "terminated" });
  }, 30_000);

  it("fails closed when Job Objects are absent but the durable identities are still live", async () => {
    const receiptRoot = path.join(suiteDirectory, "missing-job-live-identities-receipts");
    const supervisor = windowsSupervisor(receiptRoot);
    const handle = await supervisor.spawn(request("effect:missing-job-live-identities", [
      "-e",
      "setInterval(() => {}, 1000)"
    ]));

    await expect(execFileAsync(helperPath, [
      "terminate",
      `${handle.started.platformOwnership}-absent`,
      String(handle.started.processIdentity.pid),
      handle.started.processIdentity.creationIdentity,
      String(handle.started.custodianIdentity.pid),
      handle.started.custodianIdentity.creationIdentity
    ], { windowsHide: true })).rejects.toThrow(/not provably dead/i);

    expect(isAlive(handle.started.processIdentity.pid)).toBe(true);
    expect(isAlive(handle.started.custodianIdentity.pid)).toBe(true);
    await expect(handle.terminate("test_cleanup")).resolves.toMatchObject({
      outcome: "terminated",
      reason: "test_cleanup"
    });
  }, 30_000);

  it("recovers a started-only effect after a custodian crash without repeating or blindly killing it", async () => {
    const receiptRoot = path.join(suiteDirectory, "custodian-crash-receipts");
    const pidFile = path.join(suiteDirectory, "crash-tree-pids.json");
    const childMarker = path.join(suiteDirectory, "crash-child-late.txt");
    const grandchildMarker = path.join(suiteDirectory, "crash-grandchild-late.txt");
    const supervisor = windowsSupervisor(receiptRoot);
    const handle = await supervisor.spawn(request("effect:custodian-crash", [
      "-e",
      processTreeProgram(),
      pidFile,
      childMarker,
      grandchildMarker
    ]));
    const pids = await waitForJson<{ child: number; grandchild: number }>(pidFile);

    process.kill(handle.custodianPid, "SIGKILL");
    await expect(handle.completion).rejects.toThrow(/custody ended without a verified terminal receipt/i);
    await waitUntil(() => !isAlive(pids.child) && !isAlive(pids.grandchild));
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    await expect(access(childMarker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(grandchildMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:custodian-crash"))
      .toEqual([expect.objectContaining({ phase: "started" })]);

    const restartedSupervisor = windowsSupervisor(receiptRoot);
    const final = await restartedSupervisor.terminate(
      "effect:custodian-crash",
      "recovered_after_custodian_crash"
    );

    expect(final).toMatchObject({
      phase: "final",
      outcome: "terminated",
      reason: "recovered_after_custodian_crash",
      startedReceiptChecksum: handle.started.receiptChecksum
    });
    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:custodian-crash"))
      .toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({
          phase: "final",
          outcome: "terminated",
          startedReceiptChecksum: handle.started.receiptChecksum
        })
      ]);
  }, 30_000);
});

function processTreeProgram(): string {
  return [
    "const {spawn}=require('node:child_process');",
    "const {writeFileSync}=require('node:fs');",
    "const [pidFile,childMarker,grandchildMarker]=process.argv.slice(1);",
    "const grandchild=spawn(process.execPath,['-e',",
    "  `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(grandchildMarker)},'late'),1800);setInterval(()=>{},1000)`",
    "],{stdio:'ignore'});",
    "writeFileSync(pidFile,JSON.stringify({child:process.pid,grandchild:grandchild.pid}));",
    "setTimeout(()=>writeFileSync(childMarker,'late'),1800);",
    "setInterval(()=>{},1000);"
  ].join("");
}

function windowsSupervisor(receiptRoot: string): ProcessSupervisor {
  return new ProcessSupervisor({ receiptRoot, platform: "win32", windowsJobRunnerPath: helperPath });
}

function request(effectId: string, argv: readonly string[]): ProcessSpawnRequest {
  return {
    effectId,
    inputDigest: `sha256:${effectId}`,
    daemonEpoch: "daemon:physical-1",
    attemptId: `attempt:${effectId}`,
    executable: process.execPath,
    argv,
    cwd: suiteDirectory,
    env: {
      SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
      ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR })
    }
  };
}

async function waitForJson<T>(filePath: string): Promise<T> {
  let lastError: unknown;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!predicate()) throw new Error("condition never became true");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
