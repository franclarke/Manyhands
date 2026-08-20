import { existsSync } from "node:fs";
import path from "node:path";

export interface NativePreflightResolution {
  readonly windowsJobRunnerPath?: string;
  readonly windowsAclHelperPath?: string;
  readonly warnings: readonly string[];
}

/**
 * Discovers and resolves paths to required native Windows binaries.
 * Inspects environment variables first, then standard workspace `.manyhands/bin/`
 * and target/release directories.
 */
export function resolveNativePreflight(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): NativePreflightResolution {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const isWindows = process.platform === "win32";

  if (!isWindows) {
    return { warnings: [] };
  }

  const warnings: string[] = [];

  // 1. Resolve Job Runner
  let jobRunner = optionalAbsolute(env.MANYHANDS_WINDOWS_JOB_RUNNER);
  if (jobRunner === undefined) {
    const standardLocations = [
      path.join(cwd, ".manyhands", "bin", "manyhands-windows-job-runner.exe"),
      path.join(cwd, "native", "windows-job-runner", "target", "release", "manyhands-windows-job-runner.exe"),
      path.join(cwd, "native", "windows-job-runner", "target", "debug", "manyhands-windows-job-runner.exe")
    ];
    jobRunner = standardLocations.find((loc) => existsSync(loc));
  }

  if (jobRunner === undefined) {
    warnings.push(
      'Native process custodian missing: Run "pnpm build:native" or set MANYHANDS_WINDOWS_JOB_RUNNER.'
    );
  }

  // 2. Resolve IPC ACL Helper
  let aclHelper = optionalAbsolute(env.MANYHANDS_WINDOWS_IPC_ACL_HELPER);
  if (aclHelper === undefined) {
    const standardLocations = [
      path.join(cwd, ".manyhands", "bin", "manyhands-windows-ipc-acl.exe"),
      path.join(cwd, "native", "windows-ipc-acl", "target", "release", "manyhands-windows-ipc-acl.exe"),
      path.join(cwd, "native", "windows-ipc-acl", "target", "debug", "manyhands-windows-ipc-acl.exe")
    ];
    aclHelper = standardLocations.find((loc) => existsSync(loc));
  }

  return {
    ...(jobRunner === undefined ? {} : { windowsJobRunnerPath: jobRunner }),
    ...(aclHelper === undefined ? {} : { windowsAclHelperPath: aclHelper }),
    warnings
  };
}

function optionalAbsolute(val?: string): string | undefined {
  if (val === undefined || val.trim().length === 0) return undefined;
  return path.resolve(val);
}
