import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  resolveCliBinaryPath,
  resolveCliProcessInvocation,
  killCliProcessTree
} from "@manyhands/execution-core";

describe("secure CLI process invocation", () => {
  it("prefers a directly executable .exe over Windows batch shims", () => {
    const resolved = resolveCliBinaryPath("codex", {
      platform: "win32",
      env: {},
      lookupCommand: () => [
        "C:\\tools\\codex.cmd",
        "C:\\tools\\codex.exe",
        "C:\\WindowsApps\\codex.exe",
        "C:\\tools\\codex.bat"
      ]
    });

    expect(resolved).toBe("C:\\tools\\codex.exe");
    expect(resolveCliProcessInvocation(resolved, ["--version"], { platform: "win32" })).toEqual({
      command: "C:\\tools\\codex.exe",
      args: ["--version"],
      shell: false
    });
  });

  it.each(["cmd", "bat"])(
    "invokes a .%s shim through ComSpec with escaped argv and no shell",
    (extension) => {
      const invocation = resolveCliProcessInvocation(
        `C:\\Program Files\\Agent & Tools\\codex.${extension}`,
        ["--model", "gpt 5 & echo owned", "%PATH%", 'quote"tail\\'],
        {
          platform: "win32",
          env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" }
        }
      );

      expect(invocation.command).toBe("C:\\Windows\\System32\\cmd.exe");
      expect(invocation.shell).toBe(false);
      expect(invocation.windowsVerbatimArguments).toBe(true);
      expect(invocation.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
      const commandLine = invocation.args[4] ?? "";
      expect(commandLine).toContain(`Agent^ ^&^ Tools\\codex.${extension}`);
      expect(commandLine).toContain("gpt^^^ 5^^^ ^^^&^^^ echo^^^ owned");
      expect(commandLine).toContain("^^^%PATH^^^%");
    }
  );

  it.skipIf(process.platform !== "win32")(
    "round-trips hostile argv through a real batch shim without executing it",
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "manyhands-cmd-argv-"));
      const probePath = join(tempDir, "argv-probe.cjs");
      const shimPath = join(tempDir, "agent shim.cmd");
      const injectedPath = join(tempDir, "INJECTED.txt");
      const payload = [
        "",
        " ",
        "plain",
        "two words",
        'quote"tail\\',
        "100%",
        "%PATH%",
        "%1",
        "%*",
        "bang!x",
        "caret^x",
        "trailing^",
        "safe&echo INJECTED>INJECTED.txt",
        "pipe|x",
        "redir>x",
        "paren(x)"
      ];

      try {
        await writeFile(probePath, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");
        await writeFile(
          shimPath,
          `@echo off\r\n"${process.execPath}" "${probePath}" %*\r\n`,
          "utf8"
        );

        const invocation = resolveCliProcessInvocation(shimPath, payload, {
          platform: "win32",
          env: process.env
        });
        const result = spawnSync(invocation.command, invocation.args, {
          cwd: tempDir,
          env: process.env,
          encoding: "utf8",
          shell: invocation.shell,
          windowsVerbatimArguments: invocation.windowsVerbatimArguments
        });

        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout.trim())).toEqual(payload);
        expect(existsSync(injectedPath)).toBe(false);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform !== "win32")(
    "forces delayed expansion off while round-tripping literal exclamation marks",
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "manyhands-cmd-delayed-"));
      const probePath = join(tempDir, "argv-probe.cjs");
      const shimPath = join(tempDir, "agent shim.cmd");
      const payload = ["before!MH_DELAYED_EXPANSION!after"];

      try {
        await writeFile(probePath, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");
        await writeFile(
          shimPath,
          `@echo off\r\n"${process.execPath}" "${probePath}" %*\r\n`,
          "utf8"
        );

        const invocation = resolveCliProcessInvocation(shimPath, payload, {
          platform: "win32",
          env: process.env
        });
        const result = spawnSync(invocation.command, invocation.args, {
          cwd: tempDir,
          env: { ...process.env, MH_DELAYED_EXPANSION: "EXPANDED" },
          encoding: "utf8",
          shell: false,
          windowsVerbatimArguments: invocation.windowsVerbatimArguments
        });

        expect(invocation.args).toContain("/v:off");
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout.trim())).toEqual(payload);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  );

  it("keeps structured argv direct and shell-free on non-Windows platforms", () => {
    expect(
      resolveCliProcessInvocation("/opt/codex", ["--model", "gpt 5; rm -rf /"], {
        platform: "linux"
      })
    ).toEqual({
      command: "/opt/codex",
      args: ["--model", "gpt 5; rm -rf /"],
      shell: false
    });
  });

  it("kills the full Windows CLI process tree on timeout", () => {
    const directKill = vi.fn();
    const spawn = vi.fn(() => ({
      exitCode: 0,
      once: (_event: string, listener: () => void) => queueMicrotask(listener)
    }) as never);

    killCliProcessTree({ pid: 4242, kill: directKill }, spawn, "win32");

    expect(spawn).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "4242", "/t", "/f"],
      expect.objectContaining({ shell: false, stdio: "ignore" })
    );
    expect(directKill).not.toHaveBeenCalled();
  });

  it("does not resolve the Windows kill barrier before taskkill and the original handle settle", async () => {
    const root = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      kill: vi.fn()
    });
    const taskkill = Object.assign(new EventEmitter(), {
      pid: 5252,
      exitCode: null,
      signalCode: null,
      kill: vi.fn()
    });
    const spawn = vi.fn(() => taskkill as never);
    let alive = true;
    let resolved = false;

    const pending = killCliProcessTree(root, spawn, "win32", {
      verifyTimeoutMs: 200,
      pollIntervalMs: 1,
      isProcessAlive: () => alive
    }).then((value) => {
      resolved = true;
      return value;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    (taskkill as { exitCode: number | null }).exitCode = 0;
    taskkill.emit("close", 0);
    await Promise.resolve();
    expect(resolved).toBe(false);
    alive = false;
    root.emit("close", null, "SIGKILL");

    await expect(pending).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("never sends taskkill to a completed handle whose numeric pid may have been reused", async () => {
    const spawn = vi.fn();
    const directKill = vi.fn();

    await expect(
      killCliProcessTree(
        { pid: 4242, exitCode: 0, signalCode: null, kill: directKill },
        spawn as never,
        "win32"
      )
    ).resolves.toBe(true);

    expect(spawn).not.toHaveBeenCalled();
    expect(directKill).not.toHaveBeenCalled();
  });

  it("does not retry a failed taskkill after the original handle closes", async () => {
    const root = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn()
    });
    const taskkill = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn()
    });
    const isAlive = vi.fn(() => true);
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        taskkill.exitCode = 1;
        taskkill.emit("close", 1);
        root.signalCode = "SIGKILL";
        root.emit("close", null, "SIGKILL");
      });
      return taskkill as never;
    });

    await expect(
      killCliProcessTree(root, spawn, "win32", {
        verifyTimeoutMs: 100,
        isProcessAlive: isAlive
      })
    ).resolves.toBe(false);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(isAlive).not.toHaveBeenCalled();
  });
});
