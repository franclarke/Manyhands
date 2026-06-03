import { describe, expect, it } from "vitest";
import { runPreflight, PreflightError, type PreflightDeps } from "@/lib/server/runs/preflight";
import { inspectGeminiReadiness, type GeminiReadinessDeps } from "@/lib/server/providers/readiness";

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

const READINESS_DEPS: Required<GeminiReadinessDeps> = {
  checkCli: async () => ({ ok: true, version: "gemini 0.44.1" }),
  hasCredentials: () => true,
  gitPorcelain: async () => "",
  branchExists: async () => true
};

describe("inspectGeminiReadiness", () => {
  it("reports ready when CLI, auth, repo, and branch checks pass", async () => {
    const readiness = await inspectGeminiReadiness(
      workspace({ repoPath: "C:/repo", defaultBranch: "main" }),
      READINESS_DEPS
    );

    expect(readiness.status).toBe("ready");
    expect(readiness.version).toBe("gemini 0.44.1");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cli", status: "pass" }),
        expect.objectContaining({ id: "auth", status: "pass" }),
        expect.objectContaining({ id: "repo_clean", status: "pass" }),
        expect.objectContaining({ id: "branch", status: "pass" }),
        expect.objectContaining({ id: "quota", status: "warning" })
      ])
    );
  });

  it("reports error when the Gemini binary is missing", async () => {
    const readiness = await inspectGeminiReadiness(
      workspace({ repoPath: "C:/repo" }),
      { ...READINESS_DEPS, checkCli: async () => ({ ok: false }) }
    );

    expect(readiness.status).toBe("error");
    expect(readiness.checks.find((check) => check.id === "cli")?.message).toContain("not found");
  });

  it("reports error when credentials are missing", async () => {
    const readiness = await inspectGeminiReadiness(
      workspace({ repoPath: "C:/repo" }),
      { ...READINESS_DEPS, hasCredentials: () => false }
    );

    expect(readiness.status).toBe("error");
    expect(readiness.checks.find((check) => check.id === "auth")?.status).toBe("fail");
  });

  it("reports warnings for dirty repos and missing branches", async () => {
    const readiness = await inspectGeminiReadiness(
      workspace({ repoPath: "C:/repo", defaultBranch: "main" }),
      {
        ...READINESS_DEPS,
        gitPorcelain: async () => " M src/index.ts\n",
        branchExists: async () => false
      }
    );

    expect(readiness.status).toBe("warning");
    expect(readiness.checks.find((check) => check.id === "repo_clean")?.status).toBe("warning");
    expect(readiness.checks.find((check) => check.id === "branch")?.status).toBe("warning");
  });
});

function workspace(overrides: { repoPath?: string; defaultBranch?: string }) {
  return {
    id: "ws-1",
    slug: "workspace",
    name: "Workspace",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    ...overrides
  };
}
