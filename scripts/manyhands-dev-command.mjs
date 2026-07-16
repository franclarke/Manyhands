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
  if (platform !== "win32") {
    return { command: "pnpm", args: [...commandArgs], windowsVerbatimArguments: false };
  }

  const pathEntries = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
  const executable = findOnPath("pnpm.exe", pathEntries, fileExists);
  if (executable !== undefined) {
    return { command: executable, args: [...commandArgs], windowsVerbatimArguments: false };
  }

  const commandShim = findOnPath("pnpm.cmd", pathEntries, fileExists);
  if (commandShim !== undefined) {
    // `/s /c` strips one outer quote pair; retain a quoted executable and
    // quoted argv by wrapping the complete command in an additional pair.
    const commandLine = `"${[commandShim, ...commandArgs].map(quoteCmdArgument).join(" ")}"`;
    return {
      command: comspec,
      args: ["/d", "/s", "/c", commandLine],
      windowsVerbatimArguments: true
    };
  }

  // Preserve the actionable native ENOENT when pnpm is genuinely absent.
  return { command: "pnpm.exe", args: [...commandArgs], windowsVerbatimArguments: false };
}

function findOnPath(fileName, entries, fileExists) {
  for (const entry of entries) {
    const candidate = path.join(stripOuterQuotes(entry), fileName);
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
