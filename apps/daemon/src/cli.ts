import { createHash } from "node:crypto";
import path from "node:path";

import {
  createLocalProcessIdentityProbe,
  currentProcessStartIdentity
} from "./local-process-identity.js";
import { resolveDaemonProfile } from "./daemon-profile.js";
import { startProductiveDaemon } from "./productive-daemon.js";
import {
  createWindowsIpcAclProtector,
  createWindowsIpcAclVerifier
} from "./windows-ipc-acl.js";

import { resolveNativePreflight } from "./native-preflight.js";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const stateRoot = path.resolve(process.env.MANYHANDS_DAEMON_STATE_ROOT ?? ".manyhands/daemon");
  const endpoint = process.env.MANYHANDS_DAEMON_ENDPOINT ?? defaultEndpoint(stateRoot);
  const resolvedProfile = resolveDaemonProfile({
    stateRoot,
    daemonDirectory: __dirname,
    cwd: process.cwd(),
    nodeExecutable: process.execPath
  });

  const preflight = resolveNativePreflight({ cwd: process.cwd() });
  const windowsJobRunnerPath = preflight.windowsJobRunnerPath;
  if (process.platform === "win32" && windowsJobRunnerPath === undefined) {
    throw new Error(
      "MANYHANDS_WINDOWS_JOB_RUNNER is required on Windows. Run \"pnpm build:native\" or set MANYHANDS_WINDOWS_JOB_RUNNER."
    );
  }
  const windowsAclHelperPath = preflight.windowsAclHelperPath;
  const production = process.env.NODE_ENV === "production";
  if (production && process.platform === "win32" && windowsAclHelperPath === undefined) {
    throw new Error(
      "MANYHANDS_WINDOWS_IPC_ACL_HELPER is required for production IPC on Windows. Run \"pnpm build:native\"."
    );
  }
  const protect = windowsAclHelperPath === undefined
    ? undefined
    : createWindowsIpcAclProtector(windowsAclHelperPath);
  const verify = windowsAclHelperPath === undefined
    ? undefined
    : createWindowsIpcAclVerifier(windowsAclHelperPath);

  const kernel = await startProductiveDaemon({
    stateRoot,
    endpoint,
    processStartIdentity: await currentProcessStartIdentity(),
    processIdentityProbe: createLocalProcessIdentityProbe(),
    profile: resolvedProfile.profile,
    ...(windowsJobRunnerPath === undefined ? {} : { windowsJobRunnerPath }),
    production,
    ...(protect === undefined ? {} : { protectCapabilityPath: protect }),
    ...(verify === undefined ? {} : { assertOsRestrictedCapabilityPath: verify }),
    ...(windowsAclHelperPath === undefined ? {} : { windowsPipeAclHelperPath: windowsAclHelperPath }),
    onIpcError(error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
    }
  });

  process.stdout.write(`${JSON.stringify({
    event: "manyhands.daemon.ready",
    endpoint: kernel.endpoint,
    daemonEpoch: kernel.daemonEpoch,
    profile: resolvedProfile.name
  })}\n`);

  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (closing) return;
      closing = true;
      void kernel.close().catch((error: unknown) => {
        process.stderr.write(
          `Daemon shutdown failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
        );
        process.exitCode = 1;
      });
    });
  }
}

function defaultEndpoint(root: string): string {
  const suffix = createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\manyhands-daemon-${suffix}`
    : path.join(root, "daemon.sock");
}
