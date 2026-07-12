import { describe, expect, it } from "vitest";
import { cliPathRequiresShell, resolveCliBinaryPath } from "@manyhands/execution-core";

describe("CLI binary resolution", () => {
  it("resolves a bare Windows command to the preferred executable candidate", () => {
    const resolved = resolveCliBinaryPath("codex", {
      platform: "win32",
      lookupCommand: () => [
        "C:\\Users\\franc\\AppData\\Roaming\\npm\\codex.cmd",
        "C:\\Users\\franc\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe"
      ]
    });

    expect(resolved).toBe("C:\\Users\\franc\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe");
  });

  it("keeps explicit paths unchanged", () => {
    expect(resolveCliBinaryPath("C:\\tools\\codex.cmd", { platform: "win32" })).toBe("C:\\tools\\codex.cmd");
  });

  it("uses a shell only for Windows batch shims", () => {
    expect(cliPathRequiresShell("C:\\tools\\codex.cmd", "win32")).toBe(true);
    expect(cliPathRequiresShell("C:\\tools\\codex.exe", "win32")).toBe(false);
    expect(cliPathRequiresShell("/usr/local/bin/codex", "linux")).toBe(false);
  });
});
