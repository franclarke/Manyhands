import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { killProcessTree } from "../executor/kill";
import { superviseChildProcess } from "../executor/live-process-registry";

export type PackageManager = "npm" | "pnpm" | "yarn";

/** B-005: ties install subprocesses to their run for cancel/kill/report. */
export interface InstallSupervision {
  runId: string;
  operationId?: string;
  signal?: AbortSignal;
}

export interface EnsureDependenciesResult {
  /** True only when an install ran and exited 0. */
  installed: boolean;
  /** Why nothing was installed, when applicable. */
  reason?: "no_manifest" | "already_installed";
  packageManager?: PackageManager;
  exitCode?: number;
  output?: string;
}

/**
 * Ensures a worktree's npm dependencies are present so validation commands can
 * resolve their toolchain. Idempotent: a no-op when there is no package.json or
 * node_modules already exists.
 */
export interface DependencyInstaller {
  ensure(params: { cwd: string; supervision?: InstallSupervision }): Promise<EnsureDependenciesResult>;
}

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type ExistsFn = (path: string) => Promise<boolean>;

export interface ChildProcessDependencyInstallerDeps {
  spawn?: SpawnFn;
  /** Path-existence probe. Injectable so tests never touch disk. */
  exists?: ExistsFn;
  /** Run through a shell. Defaults to true on Windows (npm/pnpm/yarn are .cmd shims). */
  useShell?: boolean;
  /** Install timeout. Installs are slow; default 5 minutes. */
  timeoutMs?: number;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const INSTALL_TIMEOUT_EXIT_CODE = 124;

/**
 * DependencyInstaller backed by child processes. Detects the package manager
 * from the lockfile (pnpm-lock.yaml → pnpm, yarn.lock → yarn, else npm) and
 * runs `<pm> install`. Best-effort: a failed install is reported, never thrown,
 * so the caller can let the subsequent validation surface the real cause.
 */
export class ChildProcessDependencyInstaller implements DependencyInstaller {
  private readonly spawnFn: SpawnFn;
  private readonly exists: ExistsFn;
  private readonly useShell: boolean;
  private readonly timeoutMs: number;

  constructor(deps: ChildProcessDependencyInstallerDeps = {}) {
    this.spawnFn = deps.spawn ?? spawn;
    this.exists = deps.exists ?? defaultExists;
    this.useShell = deps.useShell ?? process.platform === "win32";
    this.timeoutMs = deps.timeoutMs ?? 300_000;
  }

  async ensure({
    cwd,
    supervision
  }: {
    cwd: string;
    supervision?: InstallSupervision;
  }): Promise<EnsureDependenciesResult> {
    if (!(await this.exists(join(cwd, "package.json")))) {
      return { installed: false, reason: "no_manifest" };
    }
    if (await this.exists(join(cwd, "node_modules"))) {
      return { installed: false, reason: "already_installed" };
    }
    if (supervision?.signal?.aborted === true) {
      return { installed: false, exitCode: 130, output: "install aborted (run cancelled)" };
    }

    const packageManager = await this.detectPackageManager(cwd);
    const { exitCode, output } = await this.runInstall(packageManager, cwd, supervision);
    return { installed: exitCode === 0, packageManager, exitCode, output };
  }

  private async detectPackageManager(cwd: string): Promise<PackageManager> {
    if (await this.exists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (await this.exists(join(cwd, "yarn.lock"))) return "yarn";
    return "npm";
  }

  private runInstall(
    packageManager: PackageManager,
    cwd: string,
    supervision?: InstallSupervision
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const child = this.spawnFn(packageManager, ["install"], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: this.useShell
      });

      if (supervision !== undefined) {
        superviseChildProcess(
          {
            runId: supervision.runId,
            label: "install",
            ...(supervision.operationId !== undefined ? { operationId: supervision.operationId } : {})
          },
          child,
          {
            ...(supervision.signal !== undefined ? { signal: supervision.signal } : {}),
            spawnFn: this.spawnFn
          }
        );
      }

      let output = "";
      let settled = false;
      const finish = (result: { exitCode: number; output: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        killProcessTree(child, this.spawnFn);
        finish({ exitCode: INSTALL_TIMEOUT_EXIT_CODE, output });
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error: Error) => {
        finish({ exitCode: 127, output: output + error.message });
      });
      child.on("close", (code) => {
        finish({ exitCode: code ?? 127, output });
      });
    });
  }
}
