import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { ProcessIdentityProbe, ProcessIdentityStatus } from "./installation-lease.js";

export async function currentProcessStartIdentity(): Promise<string> {
  const identity = await processStartIdentity(process.pid);
  if (identity === undefined) {
    throw new Error("Cannot establish the daemon process creation identity.");
  }
  return identity;
}

export function createLocalProcessIdentityProbe(): ProcessIdentityProbe {
  return {
    async probe(owner): Promise<ProcessIdentityStatus> {
      const liveness = processLiveness(owner.pid);
      if (liveness === "dead") return "dead";
      const observed = await processStartIdentity(owner.pid).catch(() => undefined);
      if (observed === undefined) return "unknown";
      return observed === owner.processStartIdentity ? "same" : "different";
    }
  };
}

async function processStartIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  if (process.platform === "win32") return windowsProcessStartIdentity(pid);
  if (process.platform === "linux") return linuxProcessStartIdentity(pid);
  return undefined;
}

async function windowsProcessStartIdentity(pid: number): Promise<string | undefined> {
  const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop; `
    + "[Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)";
  const output = await capture("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]);
  const ticks = output.trim();
  return /^\d+$/.test(ticks) ? `windows:start-ticks:${ticks}` : undefined;
}

async function linuxProcessStartIdentity(pid: number): Promise<string | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const closing = stat.lastIndexOf(")");
  if (closing < 0) return undefined;
  const fieldsFromThree = stat.slice(closing + 2).trim().split(/\s+/u);
  const startTicks = fieldsFromThree[19];
  return startTicks === undefined ? undefined : `linux:start-ticks:${startTicks}`;
}

function processLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "alive";
    return "unknown";
  }
}

function capture(executable: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${executable} process identity probe failed (${code}): ${stderr.trim()}`));
    });
  });
}
