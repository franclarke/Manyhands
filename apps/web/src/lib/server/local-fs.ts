import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectLocalGitRepo, type LocalGitRepoInfo } from "./workspaces/repo-validation";

const execFileAsync = promisify(execFile);

export interface LocalDirectoryEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface LocalDirectoryListing {
  cwd: string;
  parent?: string;
  entries: LocalDirectoryEntry[];
  git?: LocalGitRepoInfo;
}

export async function pickFolderNative(): Promise<string | null> {
  if (process.platform === "win32") {
    return pickFolderWindows();
  }
  if (process.platform === "darwin") {
    return pickFolderMac();
  }
  if (process.platform === "linux") {
    return pickFolderLinux();
  }
  throw new Error(`Native folder picker is not available on ${process.platform}`);
}

export async function browseLocalDirectories(inputPath?: string): Promise<LocalDirectoryListing> {
  const cwd = path.resolve(inputPath && inputPath.length > 0 ? inputPath : os.homedir());
  const stats = await stat(cwd);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${cwd}`);
  }

  const dirents = await readdir(cwd, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".") || entry.name === ".git")
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 250)
      .map(async (entry): Promise<LocalDirectoryEntry> => {
        const entryPath = path.join(cwd, entry.name);
        return {
          name: entry.name,
          path: entryPath,
          isGitRepo: await isGitRepoRoot(entryPath)
        };
      })
  );

  const listing: LocalDirectoryListing = {
    cwd,
    entries
  };
  const parent = path.dirname(cwd);
  if (parent !== cwd) listing.parent = parent;
  const git = await inspectLocalGitRepo(cwd).catch(() => undefined);
  if (git !== undefined) listing.git = git;
  return listing;
}

/**
 * Open a local directory in the OS file explorer. Validates the target is a real
 * directory first (callers must scope it to a known repo path, never user input).
 */
export async function revealInFileExplorer(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  const stats = await stat(resolved);
  const dir = stats.isDirectory() ? resolved : path.dirname(resolved);

  if (process.platform === "win32") {
    // `explorer` returns exit code 1 even on success; ignore the throw.
    await execFileAsync("explorer", [dir]).catch(() => undefined);
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [dir]);
    return;
  }
  await execFileAsync("xdg-open", [dir]);
}

async function isGitRepoRoot(dir: string): Promise<boolean> {
  try {
    const dotGit = await stat(path.join(dir, ".git"));
    return dotGit.isDirectory() || dotGit.isFile();
  } catch {
    return false;
  }
}

async function pickFolderWindows(): Promise<string | null> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.WindowState = 'Minimized'
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose repository folder'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
  exit 0
}
exit 2
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    return normalizePickedPath(stdout);
  } catch (error) {
    if (isProcessExitCode(error, 2)) return null;
    throw new Error(`Could not open the Windows folder picker: ${processErrorDetail(error)}`);
  }
}

async function pickFolderMac(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Choose repository folder")'
    ]);
    return normalizePickedPath(stdout);
  } catch (error) {
    if (isProcessExitCode(error, 1) && processErrorDetail(error).toLowerCase().includes("user canceled")) {
      return null;
    }
    throw new Error(`Could not open the macOS folder picker: ${processErrorDetail(error)}`);
  }
}

async function pickFolderLinux(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Choose repository folder"
    ]);
    return normalizePickedPath(stdout);
  } catch (error) {
    if (isProcessExitCode(error, 1)) return null;
    if (isErrnoCode(error, "ENOENT")) {
      throw new Error("Native folder picker is not available on Linux. Install zenity to enable folder selection.");
    }
    throw new Error(`Could not open the Linux folder picker: ${processErrorDetail(error)}`);
  }
}

function normalizePickedPath(stdout: string): string | null {
  const selected = stdout.trim();
  return selected.length > 0 ? path.resolve(selected) : null;
}

function isProcessExitCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function processErrorDetail(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "").trim() : "";
    if (stderr.length > 0) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}
