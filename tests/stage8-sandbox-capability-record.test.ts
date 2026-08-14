import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CredentialBroker,
  WorkspaceSandboxProvider,
  describeSandboxSurface,
  satisfiesSandboxProfile,
  type SandboxCapabilities
} from "@manyhands/execution-core";
import { resolveDaemonProfile } from "../apps/daemon/src/daemon-profile.js";
import { stage8SandboxFor } from "../apps/daemon/src/stage8-sandbox.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

/**
 * The Stage 8 R0 and R17 traces record the sandboxed Codex leaf reading
 * `C:\Users\franc\.agents\skills\code-1.0.4\SKILL.md` — a host path outside the
 * worktree and outside the brokered home — and succeeding, while Codex reported
 * it could still see every host skill. A capability record that calls that
 * boundary `declared_mounts`, `network: "none"` and host tooling `disabled` is a
 * claim the qualifying run refutes.
 */
describe("Stage 8 sandbox capability record", () => {
  it("reports the boundary the executor actually enforces, not the one requested", async () => {
    const root = await temporaryDirectory();
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: root,
      credentialBroker: new CredentialBroker({ rootDirectory: path.join(root, "credentials") })
    });

    expect(provider.capabilities()).toEqual({
      // Codex `workspace-write` confines creation and modification to the workspace.
      filesystemWrite: "workspace_only",
      // It does not confine reads: the qualifying run read the operator's home.
      filesystemRead: "host_visible",
      process: "supervised_only",
      // The executor's own model API egress is network, even when agent
      // commands are denied by `sandbox_workspace_write.network_access=false`.
      network: "provider_only",
      hostIdentity: "brokered",
      // Host-installed skills and plugins remain visible to the executor.
      tooling: "host_visible",
      enforcement: "executor_native"
    });
  });

  it("admits the workspace profile on confined writes and refuses it when writes escape", () => {
    const measured = new WorkspaceSandboxProvider({
      rootDirectory: path.resolve("C:/stage8-capability-root"),
      credentialBroker: new CredentialBroker({ rootDirectory: path.resolve("C:/stage8-capability-credentials") })
    }).capabilities();

    expect(satisfiesSandboxProfile(measured, "workspace")).toBe(true);
    expect(satisfiesSandboxProfile({ ...measured, filesystemWrite: "host_visible" }, "workspace")).toBe(false);
    expect(satisfiesSandboxProfile({ ...measured, network: "host" }, "workspace")).toBe(false);
    expect(satisfiesSandboxProfile({ ...measured, hostIdentity: "inherited" }, "workspace")).toBe(false);
    expect(satisfiesSandboxProfile({ ...measured, enforcement: "advisory" }, "workspace")).toBe(false);
  });

  it("never admits the strong profile while reads or host tooling are unconfined", () => {
    const osEnforced: SandboxCapabilities = {
      filesystemWrite: "declared_mounts",
      filesystemRead: "declared_mounts",
      process: "isolated_tree",
      network: "none",
      hostIdentity: "ephemeral",
      tooling: "declared_only",
      enforcement: "os"
    };

    expect(satisfiesSandboxProfile(osEnforced, "strong")).toBe(true);
    expect(satisfiesSandboxProfile({ ...osEnforced, filesystemRead: "host_visible" }, "strong")).toBe(false);
    expect(satisfiesSandboxProfile({ ...osEnforced, tooling: "host_visible" }, "strong")).toBe(false);
    expect(satisfiesSandboxProfile({ ...osEnforced, enforcement: "executor_native" }, "strong")).toBe(false);
    expect(satisfiesSandboxProfile({ ...osEnforced, process: "supervised_only" }, "strong")).toBe(false);
  });

  it("records the attributable surface from the provider's own capabilities", () => {
    const provider = new WorkspaceSandboxProvider({
      rootDirectory: path.resolve("C:/stage8-surface-root"),
      credentialBroker: new CredentialBroker({ rootDirectory: path.resolve("C:/stage8-surface-credentials") })
    });

    const surface = describeSandboxSurface({
      profile: "workspace",
      capabilities: provider.capabilities(),
      windowsSandbox: "unelevated"
    });

    expect(surface).toEqual({
      profile: "workspace",
      capabilities: provider.capabilities(),
      settingsSources: "fixed",
      additionalDirectories: [],
      windowsSandbox: "unelevated"
    });
    // The surface must not restate host tooling as disabled: the executor
    // profile revision is attributable evidence, not an aspiration.
    expect(JSON.stringify(surface)).not.toContain("disabled");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage8-capability-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Stage 8 qualifies exactly one live executor. The Claude adapter stays in the
 * tree as unqualified code: it has no measured capability record of its own, and
 * Claude Code carries no native OS sandbox, so reusing the Codex-measured record
 * for it would be the silent degradation the gate forbids.
 */
describe("Stage 8 live executor scope", () => {
  it("refuses a live profile that declares only an unqualified executor credential", () => {
    expect(() => resolveDaemonProfile({
      stateRoot: "C:/stage8-state",
      daemonDirectory: "C:/stage8-daemon",
      cwd: "C:/stage8-workspace",
      nodeExecutable: process.execPath,
      env: {
        MANYHANDS_DAEMON_PROFILE: "sandboxed_live",
        MANYHANDS_CLAUDE_CREDENTIAL_PATH: "C:/declared/claude-credentials.json"
      }
    })).toThrow(/declared Codex credential source/i);
  });

  it("still accepts the qualified Codex executor", () => {
    expect(resolveDaemonProfile({
      stateRoot: "C:/stage8-state",
      daemonDirectory: "C:/stage8-daemon",
      cwd: "C:/stage8-workspace",
      nodeExecutable: process.execPath,
      env: {
        MANYHANDS_DAEMON_PROFILE: "sandboxed_live",
        MANYHANDS_CODEX_AUTH_PATH: "C:/declared/codex-auth.json"
      }
    })).toMatchObject({ name: "sandboxed_live" });
  });

  it("blocks an unqualified executor at the sandbox boundary rather than degrading", () => {
    expect(() => stage8SandboxFor({
      stateRoot: "C:/stage8-state",
      executionExecutorId: "claude-code-cli",
      env: { MANYHANDS_STAGE8_SANDBOX: "workspace" }
    })).toThrow(/no qualified live sandbox/i);

    expect(stage8SandboxFor({
      stateRoot: "C:/stage8-state",
      executionExecutorId: "codex-cli",
      env: {
        MANYHANDS_STAGE8_SANDBOX: "workspace",
        MANYHANDS_STAGE8_SANDBOX_SCOPE: "attempt:stage8",
        MANYHANDS_CODEX_AUTH_PATH: "C:/declared/codex-auth.json"
      }
    })).toMatchObject({ profile: "workspace", windowsSandbox: "elevated" });
  });
});
