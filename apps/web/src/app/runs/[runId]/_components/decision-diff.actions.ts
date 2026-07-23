"use server";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeGitArgs } from "@manyhands/execution-core";

import { getRunRepository } from "@/lib/server/runs";
import { resolveRunTargetPath } from "@/lib/server/runs/target-context";
import { readCanonicalRunModelEvents } from "@/lib/server/runs/v2/run-event-reader";

const execFileAsync = promisify(execFile);
const MAX_FILES = 20;
const MAX_BUFFER = 2 * 1024 * 1024;

export interface CandidateDiffComparison {
  before: { label: string; content: string };
  after: { label: string; content: string };
  exact: boolean;
}

/**
 * Loads candidate contents from the immutable commit recorded by the run
 * journal. The client supplies node ids, never a commit or repository path.
 */
export async function loadCandidateDiffComparison(
  runId: string,
  affectedNodeIds: readonly string[]
): Promise<CandidateDiffComparison | null> {
  const [run, events] = await Promise.all([
    getRunRepository().get(runId),
    readCanonicalRunModelEvents(runId)
  ]);
  const candidateEvent = [...events].reverse().find((event) => (
    event.type === "attempt.candidate_created" &&
    typeof event.payload.nodeId === "string" &&
    affectedNodeIds.includes(event.payload.nodeId) &&
    typeof event.payload.candidateCommit === "string"
  ));
  if (candidateEvent === undefined) return null;

  const candidateCommit = candidateEvent.payload.candidateCommit as string;
  const repoRoot = await resolveRunTargetPath(run);
  if (repoRoot === undefined) return null;
  const baseCommit = await git(repoRoot, "rev-parse", `${candidateCommit}^`);
  const changedFiles = Array.isArray(candidateEvent.payload.changedFiles)
    ? candidateEvent.payload.changedFiles.filter((file): file is string => typeof file === "string").slice(0, MAX_FILES)
    : [];
  if (changedFiles.length === 0) return null;

  const pairs = await Promise.all(changedFiles.map(async (file) => ({
    file,
    before: await fileAt(repoRoot, baseCommit, file),
    after: await fileAt(repoRoot, candidateCommit, file)
  })));
  return {
    before: {
      label: `Base ${baseCommit.slice(0, 12)}`,
      content: pairs.map(({ file, before }) => `// ${file}\n${before}`).join("\n\n")
    },
    after: {
      label: `Candidate ${candidateCommit.slice(0, 12)}`,
      content: pairs.map(({ file, after }) => `// ${file}\n${after}`).join("\n\n")
    },
    exact: true
  };
}

async function fileAt(repoRoot: string, commit: string, file: string): Promise<string> {
  return git(repoRoot, "show", `${commit}:${file}`).catch(() => "// File does not exist in this revision.");
}

async function git(repoRoot: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    safeGitArgs(repoRoot, ["-C", repoRoot, ...args]),
    { windowsHide: true, maxBuffer: MAX_BUFFER, encoding: "utf8" }
  );
  return stdout;
}
