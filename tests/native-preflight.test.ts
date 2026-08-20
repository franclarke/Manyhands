import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveNativePreflight } from "../apps/daemon/src/native-preflight.js";

describe("resolveNativePreflight", () => {
  it("resolves explicitly set environment variables", () => {
    const fakeEnv = {
      MANYHANDS_WINDOWS_JOB_RUNNER: "C:\\tools\\custom-job-runner.exe",
      MANYHANDS_WINDOWS_IPC_ACL_HELPER: "C:\\tools\\custom-ipc-acl.exe"
    };

    const res = resolveNativePreflight({ env: fakeEnv });
    if (process.platform === "win32") {
      expect(res.windowsJobRunnerPath).toBe(path.resolve("C:\\tools\\custom-job-runner.exe"));
      expect(res.windowsAclHelperPath).toBe(path.resolve("C:\\tools\\custom-ipc-acl.exe"));
      expect(res.warnings).toHaveLength(0);
    } else {
      expect(res.warnings).toHaveLength(0);
    }
  });

  it("produces actionable diagnostic warnings if native binaries are missing on Windows", () => {
    if (process.platform !== "win32") return;

    const emptyEnv = {
      MANYHANDS_WINDOWS_JOB_RUNNER: "",
      MANYHANDS_WINDOWS_IPC_ACL_HELPER: ""
    };

    const res = resolveNativePreflight({ cwd: "C:\\non-existent-empty-dir", env: emptyEnv });
    expect(res.windowsJobRunnerPath).toBeUndefined();
    expect(res.warnings.some((w) => w.includes("pnpm build:native"))).toBe(true);
  });
});
