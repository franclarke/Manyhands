import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProcessSupervisor,
  readProcessSupervisorReceipts,
  type ProcessSpawnRequest
} from "@manyhands/execution-core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("ProcessSupervisor contract", () => {
  it("rejects implicit executable, working-directory, and environment authority", async () => {
    const receiptRoot = await temporaryDirectory();
    const supervisor = new ProcessSupervisor({
      receiptRoot,
      platform: "win32",
      windowsJobRunnerPath: path.join(receiptRoot, "missing-helper.exe")
    });

    await expect(supervisor.spawn(request({ executable: "node.exe" })))
      .rejects.toThrow(/executable must be an absolute path/i);
    await expect(supervisor.spawn(request({ cwd: "." })))
      .rejects.toThrow(/working directory must be an absolute path/i);
    await expect(supervisor.spawn({
      ...request(),
      env: undefined
    } as unknown as ProcessSpawnRequest)).rejects.toThrow(/environment must be explicit/i);

    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:contract")).toEqual([]);
  });

  it("fails closed before a physical process starts when the Windows Job Object helper is absent", async () => {
    const receiptRoot = await temporaryDirectory();
    const supervisor = new ProcessSupervisor({
      receiptRoot,
      platform: "win32",
      windowsJobRunnerPath: path.join(receiptRoot, "missing-helper.exe")
    });

    await expect(supervisor.spawn(request())).rejects.toThrow(
      /Windows Job Object helper is unavailable/i
    );
    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:contract")).toEqual([]);
  });

  it("fails closed on POSIX until process-tree custody has an OS-verifiable adapter", async () => {
    const receiptRoot = await temporaryDirectory();
    const supervisor = new ProcessSupervisor({ receiptRoot, platform: "linux" });

    await expect(supervisor.spawn(request())).rejects.toThrow(
      /POSIX process supervision is unavailable.*verified parent-death/i
    );
    expect(await readProcessSupervisorReceipts(receiptRoot, "effect:contract")).toEqual([]);
  });

  it("rejects a replaced receipt whose checksum no longer matches its physical observation", async () => {
    const receiptRoot = await temporaryDirectory();
    const receiptDirectory = path.join(
      receiptRoot,
      "811fa4d6fd2cc7b8d881a9c274cab6acf152fcda137e99d9ba6a361322733720"
    );
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(path.join(receiptDirectory, "started.json"), JSON.stringify({
      schemaVersion: 1,
      effectId: "effect:contract",
      inputDigest: "sha256:contract-input",
      daemonEpoch: "daemon:epoch-1",
      attemptId: "attempt:contract-1",
      processIdentity: { pid: 11, creationIdentity: "windows-filetime:11", supervisorNonce: "nonce:one" },
      custodianIdentity: { pid: 12, creationIdentity: "windows-filetime:12", supervisorNonce: "nonce:one" },
      platformOwnership: "Local\\ManyHands-contract",
      phase: "started",
      startedAtEpochMs: 1,
      stdoutPath: path.join(receiptDirectory, "stdout.log"),
      stderrPath: path.join(receiptDirectory, "stderr.log"),
      receiptChecksum: `sha256:${"0".repeat(64)}`
    }), "utf8");

    await expect(readProcessSupervisorReceipts(receiptRoot, "effect:contract"))
      .rejects.toThrow(/checksum/i);
    expect(await readFile(path.join(receiptDirectory, "started.json"), "utf8"))
      .toContain(`sha256:${"0".repeat(64)}`);
  });
});

function request(overrides: Partial<ProcessSpawnRequest> = {}): ProcessSpawnRequest {
  return {
    effectId: "effect:contract",
    inputDigest: "sha256:contract-input",
    daemonEpoch: "daemon:epoch-1",
    attemptId: "attempt:contract-1",
    executable: process.execPath,
    argv: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
    ...overrides
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-process-supervisor-contract-"));
  temporaryDirectories.push(directory);
  return directory;
}
