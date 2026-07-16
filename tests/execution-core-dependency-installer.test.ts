/**
 * ChildProcessDependencyInstaller — make a composed greenfield tree runnable.
 *
 * Run-level validation executes against the integrated worktree, which for a
 * from-scratch project has a freshly-composed package.json but no node_modules
 * (git worktrees never carry gitignored trees and the base had nothing to link).
 * The installer fills that gap once, before run-level validation, so checks like
 * `npm run build` / `tsc` can actually resolve their toolchain.
 */
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { ChildProcessDependencyInstaller } from "@manyhands/execution-core";

interface FakeChildScript {
  exitCode?: number | null;
  stdout?: string;
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function fakeChild(script: FakeChildScript): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    pid: 4242,
    kill: vi.fn().mockReturnValue(true)
  }) as unknown as ChildProcess;

  queueMicrotask(() => {
    if (script.stdout !== undefined) stdout.emit("data", Buffer.from(script.stdout));
    emitter.emit("close", script.exitCode ?? 0);
  });
  return child;
}

/** Builds an installer whose filesystem is the given set of existing paths. */
function makeInstaller(existingPaths: string[], script: FakeChildScript = { exitCode: 0 }) {
  const present = new Set(existingPaths.map((p) => p.replace(/\\/g, "/")));
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ command, args, options });
    return fakeChild(script);
  };
  const installer = new ChildProcessDependencyInstaller({
    spawn,
    exists: async (path: string) => present.has(path.replace(/\\/g, "/")),
    useShell: true,
    platform: "linux"
  });
  return { installer, calls };
}

const CWD = "/wt/root";

describe("ChildProcessDependencyInstaller", () => {
  it("skips (no spawn) when there is no package.json", async () => {
    const { installer, calls } = makeInstaller([]);
    const result = await installer.ensure({ cwd: CWD });
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("no_manifest");
    expect(calls).toHaveLength(0);
  });

  it("skips (no spawn) when node_modules already exists", async () => {
    const { installer, calls } = makeInstaller([`${CWD}/package.json`, `${CWD}/node_modules`]);
    const result = await installer.ensure({ cwd: CWD });
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("already_installed");
    expect(calls).toHaveLength(0);
  });

  it("runs `pnpm install` when a pnpm lockfile is present", async () => {
    const { installer, calls } = makeInstaller([`${CWD}/package.json`, `${CWD}/pnpm-lock.yaml`]);
    const result = await installer.ensure({ cwd: CWD });
    expect(result.installed).toBe(true);
    expect(result.packageManager).toBe("pnpm");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("pnpm");
    expect(calls[0]?.args).toEqual(["install"]);
    expect(calls[0]?.options.cwd).toBe(CWD);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("defaults to `npm install` when only a package.json is present", async () => {
    const { installer, calls } = makeInstaller([`${CWD}/package.json`]);
    const result = await installer.ensure({ cwd: CWD });
    expect(result.installed).toBe(true);
    expect(result.packageManager).toBe("npm");
    expect(calls[0]?.command).toBe("npm");
    expect(calls[0]?.args).toEqual(["install"]);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("reports installed=false (without throwing) when install exits non-zero", async () => {
    const { installer } = makeInstaller([`${CWD}/package.json`], { exitCode: 1, stdout: "ERR" });
    const result = await installer.ensure({ cwd: CWD });
    expect(result.installed).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
