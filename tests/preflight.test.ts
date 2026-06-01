import { describe, expect, it } from "vitest";
import { runPreflight, PreflightError, type PreflightDeps } from "@/lib/server/runs/preflight";

const OK_DEPS: Required<Pick<PreflightDeps, "checkCli" | "hasCredentials" | "gitPorcelain" | "branchExists">> = {
  checkCli: async () => true,
  hasCredentials: () => true,
  gitPorcelain: async () => "",
  branchExists: async () => true
};

const INPUT = { repoRoot: "C:/repo", baseBranch: "main" };

describe("runPreflight", () => {
  it("passes when every check is green", async () => {
    await expect(runPreflight(INPUT, OK_DEPS)).resolves.toBeUndefined();
  });

  it("fails with repo_path when no repo is configured", async () => {
    await expect(runPreflight({ repoRoot: "  ", baseBranch: "main" }, OK_DEPS)).rejects.toMatchObject({
      name: "PreflightError",
      check: "repo_path"
    });
  });

  it("fails with cli when the Gemini binary is missing", async () => {
    const error = await runPreflight(INPUT, { ...OK_DEPS, checkCli: async () => false }).catch((e) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect((error as PreflightError).check).toBe("cli");
    expect((error as PreflightError).message).toContain("Gemini CLI not found");
  });

  it("fails with auth when there are no credentials", async () => {
    await expect(runPreflight(INPUT, { ...OK_DEPS, hasCredentials: () => false })).rejects.toMatchObject({
      check: "auth"
    });
  });

  it("fails with repo_clean when the worktree is dirty", async () => {
    await expect(
      runPreflight(INPUT, { ...OK_DEPS, gitPorcelain: async () => " M src/index.ts\n" })
    ).rejects.toMatchObject({ check: "repo_clean" });
  });

  it("fails with branch when the base branch does not resolve", async () => {
    await expect(
      runPreflight(INPUT, { ...OK_DEPS, branchExists: async () => false })
    ).rejects.toMatchObject({ check: "branch" });
  });

  it("stops at the first failing check (CLI before repo state)", async () => {
    let porcelainCalled = false;
    const error = await runPreflight(INPUT, {
      ...OK_DEPS,
      checkCli: async () => false,
      gitPorcelain: async () => {
        porcelainCalled = true;
        return "";
      }
    }).catch((e) => e);
    expect((error as PreflightError).check).toBe("cli");
    expect(porcelainCalled).toBe(false);
  });
});
