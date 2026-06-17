import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPreflight, PreflightError, type PreflightDeps } from "@/lib/server/runs/preflight";
import { inspectPrimaryProviderReadiness, type ProviderReadinessDeps } from "@/lib/server/providers/readiness";

const OK_DEPS: Required<Pick<PreflightDeps, "checkCli" | "hasCredentials" | "gitPorcelain" | "branchExists">> = {
  checkCli: async () => true,
  hasCredentials: () => true,
  gitPorcelain: async () => "",
  branchExists: async () => true
};

const INPUT = { repoRoot: "C:/repo", baseBranch: "main" };

describe("runPreflight", () => {
  it("passes when every check is green", async () => {
    const report = await runPreflight(INPUT, OK_DEPS);
    expect(report.warnings.every((warning) => warning.check === "gitignore")).toBe(true);
  });

  it("warns (without blocking) when the repo has no .gitignore", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-preflight-"));
    try {
      const report = await runPreflight({ repoRoot, baseBranch: "main" }, OK_DEPS);
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]?.check).toBe("gitignore");
      expect(report.warnings[0]?.message).toContain("info/exclude");
    } finally {
      await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("emits no warning when a .gitignore exists", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-preflight-"));
    try {
      await writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");
      const report = await runPreflight({ repoRoot, baseBranch: "main" }, OK_DEPS);
      expect(report.warnings).toHaveLength(0);
    } finally {
      await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fails with repo_path when no repo is configured", async () => {
    await expect(runPreflight({ repoRoot: "  ", baseBranch: "main" }, OK_DEPS)).rejects.toMatchObject({
      name: "PreflightError",
      check: "repo_path"
    });
  });

  it("fails with cli when the Claude Code binary is missing", async () => {
    const error = await runPreflight(INPUT, { ...OK_DEPS, checkCli: async () => false }).catch((e) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect((error as PreflightError).check).toBe("cli");
    expect((error as PreflightError).message).toContain("Claude Code CLI not found");
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

  it("checks the grounding executor before execution starts", async () => {
    const checked: string[] = [];
    await runPreflight(
      {
        ...INPUT,
        defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
        groundingSelection: { executorId: "codex-cli", model: "gpt-5.5" }
      },
      {
        ...OK_DEPS,
        checkCli: async (binaryPath) => {
          checked.push(binaryPath);
          return true;
        }
      }
    );

    expect(checked.filter((binaryPath) => binaryPath === "codex")).toHaveLength(1);
  });

  it("fails preflight when the grounding executor CLI is unavailable", async () => {
    const error = await runPreflight(
      {
        ...INPUT,
        groundingSelection: { executorId: "codex-cli", model: "gpt-5.5" }
      },
      {
        ...OK_DEPS,
        checkCli: async (binaryPath) => binaryPath !== "codex"
      }
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PreflightError);
    expect((error as PreflightError).check).toBe("cli");
    expect((error as PreflightError).message).toContain("Codex CLI not found");
  });
});

const READINESS_DEPS: Required<ProviderReadinessDeps> = {
  checkCli: async () => ({ ok: true, version: "claude 1.0.0" }),
  hasCredentials: () => true,
  gitPorcelain: async () => "",
  branchExists: async () => true,
  detectCommands: async () => ({ packageManager: "pnpm", test: "pnpm run test" })
};

describe("inspectPrimaryProviderReadiness", () => {
  it("reports ready when CLI, auth, repo, and branch checks pass", async () => {
    const readiness = await inspectPrimaryProviderReadiness(
      workspace({ repoPath: "C:/repo", defaultBranch: "main" }),
      READINESS_DEPS
    );

    expect(readiness.status).toBe("ready");
    expect(readiness.version).toBe("claude 1.0.0");
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

  it("reports error when the Claude Code binary is missing", async () => {
    const readiness = await inspectPrimaryProviderReadiness(
      workspace({ repoPath: "C:/repo" }),
      { ...READINESS_DEPS, checkCli: async () => ({ ok: false }) }
    );

    expect(readiness.status).toBe("error");
    expect(readiness.checks.find((check) => check.id === "cli")?.message).toContain("No se encontró");
  });

  it("reports error when credentials are missing", async () => {
    const readiness = await inspectPrimaryProviderReadiness(
      workspace({ repoPath: "C:/repo" }),
      { ...READINESS_DEPS, hasCredentials: () => false }
    );

    expect(readiness.status).toBe("error");
    expect(readiness.checks.find((check) => check.id === "auth")?.status).toBe("fail");
  });

  it("reports warnings for dirty repos and missing branches", async () => {
    const readiness = await inspectPrimaryProviderReadiness(
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
