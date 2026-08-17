import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Resolve the default pnpm child without `shell: true`. Node 24 deprecates
 * passing an argv array through a shell (DEP0190), and the dev launcher never
 * needs shell expansion. Windows installations may expose either pnpm.exe or
 * only the conventional pnpm.cmd shim; the latter is invoked explicitly via
 * cmd.exe with a constant, quoted command line.
 */
export function resolveDefaultDevSpawn(
  commandArgs,
  {
    platform = process.platform,
    pathValue = process.env.PATH ?? "",
    comspec = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
    fileExists = existsSync
  } = {}
) {
  const pathEntries = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);

  // The version lives in `packageManager` and corepack is what honours it.
  // Searching PATH for pnpm finds whichever one is installed, which on a machine
  // with a standalone pnpm is not the pinned one — `engines.pnpm` then rejects
  // the build before it starts, even when the operator invoked the launcher
  // through corepack, because this resolution starts over.
  if (platform !== "win32") {
    const corepack = findOnPath("corepack", pathEntries, fileExists, path.posix.join);
    if (corepack !== undefined) {
      return { command: corepack, args: ["pnpm", ...commandArgs], windowsVerbatimArguments: false };
    }
    return { command: "pnpm", args: [...commandArgs], windowsVerbatimArguments: false };
  }

  const corepackExecutable = findOnPath("corepack.exe", pathEntries, fileExists);
  if (corepackExecutable !== undefined) {
    return { command: corepackExecutable, args: ["pnpm", ...commandArgs], windowsVerbatimArguments: false };
  }
  const corepackShim = findOnPath("corepack.cmd", pathEntries, fileExists);
  if (corepackShim !== undefined) {
    return cmdInvocation(comspec, [corepackShim, "pnpm", ...commandArgs]);
  }

  const executable = findOnPath("pnpm.exe", pathEntries, fileExists);
  if (executable !== undefined) {
    return { command: executable, args: [...commandArgs], windowsVerbatimArguments: false };
  }

  const commandShim = findOnPath("pnpm.cmd", pathEntries, fileExists);
  if (commandShim !== undefined) return cmdInvocation(comspec, [commandShim, ...commandArgs]);

  // Preserve the actionable native ENOENT when pnpm is genuinely absent.
  return { command: "pnpm.exe", args: [...commandArgs], windowsVerbatimArguments: false };
}

/**
 * `/s /c` strips one outer quote pair; retain a quoted executable and quoted
 * argv by wrapping the complete command in an additional pair.
 */
function cmdInvocation(comspec, parts) {
  return {
    command: comspec,
    args: ["/d", "/s", "/c", `"${parts.map(quoteCmdArgument).join(" ")}"`],
    windowsVerbatimArguments: true
  };
}

function findOnPath(fileName, entries, fileExists, join = path.join) {
  for (const entry of entries) {
    const candidate = join(stripOuterQuotes(entry), fileName);
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

function stripOuterQuotes(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function quoteCmdArgument(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
