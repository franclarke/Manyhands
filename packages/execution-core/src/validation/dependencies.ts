import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { killProcessTree } from "../executor/kill";
import { superviseChildProcess } from "../executor/live-process-registry";
import { BoundedOutput } from "../executor/bounded-output";

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
  environment?: DependencyEnvironmentDescriptor;
}

/** Durable identity of the install tree owned by exactly one worktree. */
export interface DependencyEnvironmentDescriptor {
  version: 1;
  worktreePath: string;
  packageManager: PackageManager;
  lockfileHash?: string;
  runtime: string;
  ownerRunId?: string;
  status: "ready" | "failed";
  installedAt: string;
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
    const packageManager = await this.detectPackageManager(cwd);
    if (await this.exists(join(cwd, "node_modules"))) {
      const environment = await persistEnvironment(cwd, packageManager, "ready", supervision?.runId);
      return { installed: false, reason: "already_installed", packageManager, environment };
    }
    if (supervision?.signal?.aborted === true) {
      return { installed: false, exitCode: 130, output: "install aborted (run cancelled)" };
    }

    const { exitCode, output } = await this.runInstall(packageManager, cwd, supervision);
    const environment = await persistEnvironment(cwd, packageManager, exitCode === 0 ? "ready" : "failed", supervision?.runId);
    return { installed: exitCode === 0, packageManager, exitCode, output, environment };
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

      const output = new BoundedOutput();
      let settled = false;
      const finish = (result: { exitCode: number; output: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        killProcessTree(child, this.spawnFn);
        finish({ exitCode: INSTALL_TIMEOUT_EXIT_CODE, output: output.text() });
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        output.append(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output.append(chunk.toString("utf8"));
      });
      child.on("error", (error: Error) => {
        output.append(error.message);
        finish({ exitCode: 127, output: output.text() });
      });
      child.on("close", (code) => {
        finish({ exitCode: code ?? 127, output: output.text() });
      });
    });
  }
}

async function persistEnvironment(
  cwd: string,
  packageManager: PackageManager,
  status: DependencyEnvironmentDescriptor["status"],
  ownerRunId?: string
): Promise<DependencyEnvironmentDescriptor> {
  const lockfile = packageManager === "pnpm" ? "pnpm-lock.yaml" : packageManager === "yarn" ? "yarn.lock" : "package-lock.json";
  const lockfileHash = await readFile(join(cwd, lockfile)).then((content) => createHash("sha256").update(content).digest("hex")).catch(() => undefined);
  const descriptor: DependencyEnvironmentDescriptor = { version: 1, worktreePath: cwd, packageManager, ...(lockfileHash !== undefined ? { lockfileHash } : {}), runtime: process.version, ...(ownerRunId !== undefined ? { ownerRunId } : {}), status, installedAt: new Date().toISOString() };
  await mkdir(join(cwd, ".manyhands"), { recursive: true })
    .then(() => writeFile(join(cwd, ".manyhands", "dependency-environment.json"), JSON.stringify(descriptor), "utf8"))
    .catch(() => undefined);
  return descriptor;
}
