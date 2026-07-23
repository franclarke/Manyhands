import { access, writeFile } from "node:fs/promises";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "@/lib/server/workspaces/errors";
import { JsonWorkspaceRepository } from "@/lib/server/workspaces/repository";
import { withWorkspaceReferenceLock } from "@/lib/server/workspaces/reference-lock";
import { makeRunRecordV2 } from "./run-v2-record";

type Action = "create" | "fork" | "delete";

async function main(): Promise<void> {
  const [workspacesFile, runsDirectory, workspaceId, runId, actionRaw, participant, gatePath] =
    process.argv.slice(2);
  if (
    workspacesFile === undefined ||
    runsDirectory === undefined ||
    workspaceId === undefined ||
    runId === undefined ||
    (actionRaw !== "create" && actionRaw !== "fork" && actionRaw !== "delete") ||
    participant === undefined ||
    gatePath === undefined
  ) {
    throw new Error(
      "workspace-reference-child requires workspacesFile, runsDirectory, workspaceId, runId, action, participant and gatePath"
    );
  }
  const action: Action = actionRaw;
  process.env.MANYHANDS_WORKSPACES_FILE = workspacesFile;
  process.env.MANYHANDS_RUNS_DIR = runsDirectory;

  await writeFile(`${gatePath}.${participant}.ready`, String(process.pid), "utf8");
  while (!await exists(gatePath)) await new Promise((resolve) => setTimeout(resolve, 5));

  const workspaces = new JsonWorkspaceRepository({ filePath: workspacesFile, seeds: [] });
  const runs = new JsonRunRecordStore({ directory: runsDirectory });
  let outcome: string;
  if (action === "create") {
    try {
      await withWorkspaceReferenceLock(async () => {
        const workspace = await workspaces.get(workspaceId);
        await runs.save(runRecord(runId, workspace.id));
      });
      outcome = "created";
    } catch (error) {
      if (!(error instanceof WorkspaceNotFoundError)) throw error;
      outcome = "workspace_missing";
    }
  } else if (action === "fork") {
    try {
      await withWorkspaceReferenceLock(async () => {
        const workspace = await workspaces.get(workspaceId);
        await runs.save(runRecord(runId, workspace.id));
      });
      outcome = "forked";
    } catch (error) {
      if (!(error instanceof WorkspaceNotFoundError)) throw error;
      outcome = "workspace_missing";
    }
  } else {
    outcome = await withWorkspaceReferenceLock(async () => {
      const equivalentIds = await workspaces.equivalentIds(workspaceId);
      const references = await runs.listStrict({ workspaceIds: equivalentIds, limit: 1 });
      if (references.length > 0) return "reference_exists";
      try {
        await workspaces.delete(workspaceId);
        return "deleted";
      } catch (error) {
        if (error instanceof WorkspaceConflictError) return "reference_exists";
        throw error;
      }
    });
  }

  await writeFile(`${gatePath}.${participant}.result.json`, JSON.stringify({ outcome }), "utf8");
}

function runRecord(runId: string, workspaceId: string): RunRecord {
  return makeRunRecordV2({
    runId,
    workspaceId,
    title: runId,
    userPrompt: "Cross-process publication"
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
