import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";

export interface ContextPackParams {
  /** Absolute worktree path the files are resolved against. */
  worktreePath: string;
  /** Repo-relative files whose current contents to include (the leaf targets). */
  files: string[];
}

export interface ContextPackResult {
  /** Prompt section to append to the leaf instructions; "" when nothing was packed. */
  section: string;
  /** Files actually read and included. */
  includedFiles: string[];
  /** Total bytes of file content included (after truncation). */
  totalBytes: number;
}

export interface ContextPacker {
  pack(params: ContextPackParams): Promise<ContextPackResult>;
}

export interface FileSystemContextPackerDeps {
  /** Injectable for deterministic tests. Defaults to node:fs/promises readFile. */
  readFile?: (filePath: string) => Promise<string>;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_BYTES_PER_FILE = 8_000;
const DEFAULT_MAX_TOTAL_BYTES = 32_000;
const TRUNCATION_MARKER = "\n…[truncated]";

/**
 * Reads the current contents of a leaf's target files from its worktree and
 * formats them as a prompt section, so the subagent sees the starting point of
 * the files it must change (Etapa B — minimal context packing).
 *
 * Intentionally minimal: only the explicit target files (no globs, no repo
 * scan, no symbol graph). Bounded by per-file and total byte caps to avoid
 * token blow-up. Per-file read errors are swallowed (the file is noted as
 * absent), so a missing target file or a fake worktree never breaks the run.
 */
export class FileSystemContextPacker implements ContextPacker {
  private readonly readFile: (filePath: string) => Promise<string>;
  private readonly maxFiles: number;
  private readonly maxBytesPerFile: number;
  private readonly maxTotalBytes: number;

  constructor(deps: FileSystemContextPackerDeps = {}) {
    this.readFile = deps.readFile ?? ((filePath) => fsReadFile(filePath, "utf8"));
    this.maxFiles = deps.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxBytesPerFile = deps.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
    this.maxTotalBytes = deps.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  async pack(params: ContextPackParams): Promise<ContextPackResult> {
    const blocks: string[] = [];
    const includedFiles: string[] = [];
    let totalBytes = 0;

    for (const file of params.files.slice(0, this.maxFiles)) {
      if (!isWithinWorktree(file)) {
        continue; // refuse path traversal / absolute escapes
      }
      if (totalBytes >= this.maxTotalBytes) {
        break;
      }

      const absolute = path.join(params.worktreePath, file);
      let content: string | undefined;
      try {
        content = await this.readFile(absolute);
      } catch {
        blocks.push(`### ${file}\n(does not exist yet — create it)`);
        continue;
      }

      const budget = Math.min(this.maxBytesPerFile, this.maxTotalBytes - totalBytes);
      const { text, bytes } = clip(content, budget);
      totalBytes += bytes;
      includedFiles.push(file);
      blocks.push(`### ${file}\n\`\`\`\n${text}\n\`\`\``);
    }

    if (blocks.length === 0) {
      return { section: "", includedFiles, totalBytes };
    }

    const section = [
      "Current contents of the files you will work on:",
      "",
      ...blocks
    ].join("\n");
    return { section, includedFiles, totalBytes };
  }
}

/** Rejects absolute paths and any path that escapes the worktree via "..". */
function isWithinWorktree(file: string): boolean {
  if (path.isAbsolute(file)) {
    return false;
  }
  const normalized = path.normalize(file);
  return !normalized.startsWith("..") && !normalized.includes(`..${path.sep}`);
}

function clip(content: string, budget: number): { text: string; bytes: number } {
  if (budget <= 0) {
    return { text: TRUNCATION_MARKER.trim(), bytes: 0 };
  }
  if (Buffer.byteLength(content, "utf8") <= budget) {
    return { text: content, bytes: Buffer.byteLength(content, "utf8") };
  }
  const truncated = content.slice(0, budget);
  return { text: truncated + TRUNCATION_MARKER, bytes: Buffer.byteLength(truncated, "utf8") };
}
