import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CredentialBroker,
  SandboxUnavailableError,
  WorkspaceSandboxProvider,
  buildClaudeCodeArgs,
  buildCodexArgs,
  type AgentExecutorOptions
} from "@manyhands/execution-core";
import { resolveDaemonProfile } from "../apps/daemon/src/daemon-profile.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Stage 8 sandbox boundary", () => {
  it("fails closed when the configured unattended minimum is stronger than the provider", async () => {
    const root = await temporaryDirectory();
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: root,
      credentialBroker: new CredentialBroker({ rootDirectory: path.join(root, "credentials") })
    });

    await expect(provider.create({
      attemptId: "attempt:strong-required",
      workspacePath: path.join(root, "workspace"),
      profile: "strong",
      credentials: []
    })).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it("brokers only declared credentials into an ephemeral identity and never inherits host home", async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, "workspace");
    const source = path.join(root, "codex-auth.json");
    await writeFile(source, '{"token":"secret-value"}', "utf8");
    await mkdir(path.join(root, ".sandbox"), { recursive: true });
    await writeFile(
      path.join(root, ".sandbox", "setup_marker.json"),
      JSON.stringify({ version: 5, offline_username: "CodexSandboxOffline", online_username: "CodexSandboxOnline" }),
      "utf8"
    );
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: path.join(root, "sandboxes"),
      credentialBroker: new CredentialBroker({ rootDirectory: path.join(root, "credentials") })
    });

    const session = await provider.create({
      attemptId: "attempt:brokered",
      workspacePath: workspace,
      profile: "workspace",
      credentials: [{ provider: "codex", sourcePath: source }]
    });

    expect(session.capabilities).toMatchObject({
      filesystem: "declared_mounts",
      process: "supervised_only",
      network: "none",
      hostIdentity: "brokered",
      enforcement: "executor_native"
    });
    expect(session.environment.USERPROFILE).not.toBe(process.env.USERPROFILE);
    expect(session.environment.HOME).not.toBe(process.env.HOME);
    expect(session.environment.LOCALAPPDATA).toBe(path.join(session.environment.HOME!, "AppData", "Local"));
    expect(session.environment.PSModuleAnalysisCachePath).toBe(
      path.join(session.environment.TEMP!, "PowerShell", "ModuleAnalysisCache")
    );
    expect(session.environment.PSModuleAnalysisCachePath).not.toContain("Microsoft/Windows/PowerShell");
    expect(await readFile(path.join(session.environment.HOME!, ".codex", "auth.json"), "utf8"))
      .toBe('{"token":"secret-value"}');
    expect(JSON.parse(await readFile(path.join(session.environment.CODEX_HOME!, ".sandbox", "setup_marker.json"), "utf8")))
      .toMatchObject({ version: 5, offline_username: "CodexSandboxOffline", online_username: "CodexSandboxOnline" });
    expect(JSON.stringify(session.receipt)).not.toContain("secret-value");

    await session.dispose();
    await expect(access(session.environment.HOME!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects undeclared additional directories and credential providers", async () => {
    const root = await temporaryDirectory();
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: root,
      credentialBroker: new CredentialBroker({ rootDirectory: path.join(root, "credentials") })
    });

    await expect(provider.create({
      attemptId: "attempt:directories",
      workspacePath: path.join(root, "workspace"),
      profile: "workspace",
      additionalDirectories: [path.join(root, "outside")],
      credentials: []
    })).rejects.toThrow(/additional directories/i);
    await expect(provider.create({
      attemptId: "attempt:provider",
      workspacePath: path.join(root, "workspace"),
      profile: "workspace",
      credentials: [{ provider: "unknown", sourcePath: path.join(root, "missing") } as never]
    })).rejects.toThrow(/credential provider/i);
  });

  it("fails closed before a Codex spawn when its native Windows sandbox receipt is absent", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "codex-auth.json");
    await writeFile(source, '{"token":"declared"}', "utf8");
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: path.join(root, "sandboxes"),
      credentialBroker: new CredentialBroker({ rootDirectory: path.join(root, "credentials") })
    });

    const expectation = provider.create({
      attemptId: "attempt:missing-native-receipt",
      workspacePath: path.join(root, "workspace"),
      profile: "workspace",
      credentials: [{ provider: "codex", sourcePath: source }]
    });
    if (process.platform === "win32") {
      await expect(expectation).rejects.toThrow(/native sandbox setup marker is unavailable/i);
    } else {
      await expect(expectation).resolves.toMatchObject({ capabilities: { enforcement: "executor_native" } });
    }
  });

  it("pins unattended Codex and Claude arguments against repo settings and permission bypasses", () => {
    const options: AgentExecutorOptions = {
      cwd: "C:/workspace",
      instructionFilePath: "C:/instructions.txt",
      model: "test-model",
      timeoutMs: 1_000,
      bypassApprovals: false
    };

    expect(buildCodexArgs(options)).toEqual(expect.arrayContaining([
      "--sandbox", "workspace-write", "--ignore-user-config",
      "sandbox_workspace_write.network_access=false", "--cd", "C:/workspace", "--add-dir", "C:/workspace"
    ]));
    expect(buildCodexArgs(options)).not.toContain("danger-full-access");
    expect(buildClaudeCodeArgs(options)).toEqual(expect.arrayContaining([
      "--setting-sources", ""
    ]));
    expect(buildClaudeCodeArgs(options)).not.toEqual(expect.arrayContaining([
      "--dangerously-skip-permissions", "project,local"
    ]));
  });

  it("selects the live daemon profile only with a declared broker source", () => {
    const root = "C:/stage8-state";
    expect(() => resolveDaemonProfile({
      stateRoot: root,
      daemonDirectory: "C:/stage8-daemon",
      cwd: "C:/stage8-workspace",
      nodeExecutable: process.execPath,
      env: { MANYHANDS_DAEMON_PROFILE: "sandboxed_live" }
    })).toThrow(/declared Codex or Claude credential source/i);

    const resolved = resolveDaemonProfile({
      stateRoot: root,
      daemonDirectory: "C:/stage8-daemon",
      cwd: "C:/stage8-workspace",
      nodeExecutable: process.execPath,
      env: {
        MANYHANDS_DAEMON_PROFILE: "sandboxed_live",
        MANYHANDS_CODEX_AUTH_PATH: "C:/declared/codex-auth.json",
        MANYHANDS_STAGE8_WINDOWS_SANDBOX: "unelevated"
      }
    });
    expect(resolved).toMatchObject({ name: "sandboxed_live", profile: { kind: "sandboxed_live" } });
    if (resolved.profile.kind === "sandboxed_live") {
      const processSpec = resolved.profile.executionProcess({} as never, {
        runId: "run:stage8",
        attemptId: "attempt:stage8"
      });
      expect(processSpec.env).toMatchObject({
        MANYHANDS_STAGE8_SANDBOX: "workspace",
        MANYHANDS_STAGE8_WINDOWS_SANDBOX: "unelevated",
        MANYHANDS_CODEX_AUTH_PATH: path.resolve("C:/declared/codex-auth.json")
      });
      expect(processSpec.env.USERPROFILE).toBeUndefined();
    }

    expect(() => resolveDaemonProfile({
      stateRoot: root,
      daemonDirectory: "C:/stage8-daemon",
      cwd: "C:/stage8-workspace",
      nodeExecutable: process.execPath,
      env: {
        MANYHANDS_DAEMON_PROFILE: "sandboxed_live",
        MANYHANDS_CODEX_AUTH_PATH: "C:/declared/codex-auth.json",
        MANYHANDS_STAGE8_WINDOWS_SANDBOX: "host"
      }
    })).toThrow(/unsupported Stage 8 Windows sandbox/i);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage8-sandbox-"));
  temporaryDirectories.push(directory);
  return directory;
}
