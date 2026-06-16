import { execFile } from "node:child_process";
import { access, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { WorkspaceValidationError } from "./errors";
import { inspectLocalGitRepo, type LocalGitRepoInfo } from "./repo-validation";

const execFileAsync = promisify(execFile);

const GITIGNORE_CONTENT = `node_modules/
dist/
build/
coverage/
.env
.env.*
*.log
.DS_Store
`;

/**
 * Makes a local folder ready to drive a run: it must be a git repo with at least
 * one commit (the worktree manager bases leaves on `HEAD`). Behaviour:
 *
 * - Not a git repo -> `git init -b main` in place.
 * - Git repo without commits (unborn HEAD) -> create the initial commit.
 * - Git repo that already has commits -> no-op (never touch a working repo).
 *
 * When an initial commit is needed it seeds `README.md` + `.gitignore` only if
 * they are missing, then commits everything present so existing files get tracked.
 */
export async function ensureRunnableRepo(inputPath: string): Promise<LocalGitRepoInfo> {
  const resolved = path.resolve(inputPath);
  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    throw new WorkspaceValidationError(`Repo path does not exist: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    throw new WorkspaceValidationError(`Repo path is not a directory: ${resolved}`);
  }

  const toplevel = await git(resolved, ["rev-parse", "--show-toplevel"]).catch(() => undefined);

  let repoRoot = resolved;
  let needsInitialCommit: boolean;
  try {
    if (toplevel === undefined) {
      await gitInitMain(resolved);
      needsInitialCommit = true;
    } else {
      repoRoot = path.resolve(toplevel);
      const head = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"])
        .then((value) => value || undefined)
        .catch(() => undefined);
      needsInitialCommit = head === undefined;
    }

    if (needsInitialCommit) {
      await createInitialCommit(repoRoot);
    }
  } catch (error) {
    if (error instanceof WorkspaceValidationError) throw error;
    throw new WorkspaceValidationError(`Failed to initialize git repo at ${repoRoot}: ${gitErrorDetail(error)}`);
  }

  return inspectLocalGitRepo(repoRoot);
}

async function gitInitMain(dir: string): Promise<void> {
  try {
    await git(dir, ["init", "-b", "main"]);
  } catch {
    // Older git without `init -b`: init then point the unborn HEAD at main.
    await git(dir, ["init"]);
    await git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }
}

async function createInitialCommit(repoRoot: string): Promise<void> {
  await ensureFile(path.join(repoRoot, "README.md"), `# ${path.basename(repoRoot)}\n`);
  await ensureFile(path.join(repoRoot, ".gitignore"), GITIGNORE_CONTENT);
  await git(repoRoot, ["add", "-A"]);
  const identity = await commitIdentityArgs(repoRoot);
  await git(repoRoot, ["-c", "commit.gpgsign=false", ...identity, "commit", "-m", "chore: initial commit"]);
}

/**
 * Respect the user's global git identity when present; otherwise fall back to a
 * ManyHands identity for this single commit so the init never fails on a machine
 * without `user.name`/`user.email` configured.
 */
async function commitIdentityArgs(repoRoot: string): Promise<string[]> {
  const email = await git(repoRoot, ["config", "user.email"]).catch(() => "");
  const name = await git(repoRoot, ["config", "user.name"]).catch(() => "");
  if (email.trim().length > 0 && name.trim().length > 0) return [];
  return ["-c", "user.name=ManyHands", "-c", "user.email=manyhands@local"];
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await access(filePath);
    return; // Already present; never overwrite the user's file.
  } catch {
    await writeFile(filePath, content, "utf8");
  }
}

function gitErrorDetail(error: unknown): string {
  if (error !== null && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr.length > 0) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
