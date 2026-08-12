import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe.skipIf(process.platform !== "win32")("Stage 0 PowerShell native runner", () => {
  it("captures a real native exit and fails closed for a missing executable", async () => {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(REPO_ROOT, "scripts", "test-stage0-native-process.ps1")
      ],
      { cwd: REPO_ROOT, windowsHide: true }
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("STAGE0_NATIVE_PROCESS_SMOKE=pass");
    expect(result.stdout).toContain("STAGE0_EXPECTED_OBSERVED_VARIABLES=pass");
  });
});
