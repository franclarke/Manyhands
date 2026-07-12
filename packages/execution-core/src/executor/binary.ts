import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

export interface ResolveCliBinaryPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  lookupCommand?: (binaryPath: string, env: NodeJS.ProcessEnv) => string[];
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

/**
 * Resolve bare CLI names to concrete executable paths on Windows.
 *
 * Node's child_process behavior differs across execFile/spawn, shells, npm
 * shims, and packaged app PATHs. Resolving once keeps preflight and execution
 * looking at the same binary instead of letting one pass and the other fail.
 */
export function resolveCliBinaryPath(binaryPath: string, options: ResolveCliBinaryPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || isPathLike(binaryPath)) {
    return binaryPath;
  }

  const env = options.env ?? process.env;
  const candidates = (options.lookupCommand ?? lookupWindowsCommand)(binaryPath, env);
  const existing = candidates.filter((candidate) => candidate.length > 0 && existsSync(candidate));
  const usable = existing.length > 0 ? existing : candidates;
  return preferWindowsExecutable(usable) ?? binaryPath;
}

export function cliPathRequiresShell(binaryPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  const extension = extname(binaryPath).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

function isPathLike(binaryPath: string): boolean {
  return isAbsolute(binaryPath) || binaryPath.includes("/") || binaryPath.includes("\\");
}

function preferWindowsExecutable(candidates: readonly string[]): string | undefined {
  const byExtension = new Map(candidates.map((candidate) => [extname(candidate).toLowerCase(), candidate]));
  for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
    const match = byExtension.get(extension);
    if (match !== undefined) return match;
  }
  return candidates[0];
}

function lookupWindowsCommand(binaryPath: string, env: NodeJS.ProcessEnv): string[] {
  const where = spawnSync("where.exe", [binaryPath], {
    encoding: "utf8",
    env,
    windowsHide: true
  });
  if (where.status === 0 && where.stdout.trim().length > 0) {
    return where.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return lookupWindowsPath(binaryPath, env);
}

function lookupWindowsPath(binaryPath: string, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.Path ?? env.PATH ?? "";
  const pathext = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const requestedExtension = extname(binaryPath).toLowerCase();
  const extensions = requestedExtension.length > 0 ? [""] : pathext;
  const matches: string[] = [];
  for (const dir of pathValue.split(delimiter).filter((value) => value.length > 0)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${binaryPath}${extension}`);
      if (existsSync(candidate)) matches.push(candidate);
    }
  }
  return matches;
}
