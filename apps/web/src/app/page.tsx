import { CommandCenterShell } from "./(command-center)/_components/command-center-shell.client";
import { RecentRunsStrip } from "./(command-center)/_components/recent-runs-strip";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { getRunRepository } from "@/lib/server/runs";
import { toRunPreview } from "@/lib/server/runs/presenter";
import { getWorkspaceRepository } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<React.ReactElement> {
  const [workspaces, runs] = await Promise.all([
    getWorkspaceRepository().list(),
    getRunRepository().list({ limit: 6 })
  ]);
  const wsByid = new Map(workspaces.map((entry) => [entry.id, entry]));
  const previews = runs.map((run) => toRunPreview(run, wsByid));

  return (
    <div>
      <section style={{ margin: "52px auto 30px", maxWidth: 760 }}>
        <p className="mh-coord" style={{ margin: 0, marginBottom: 14, color: "var(--copper)" }}>
          alpha / command center
        </p>
        <h1
          className="mh-serif"
          style={{
            fontSize: 46,
            lineHeight: 1.06,
            color: "var(--text)",
            margin: 0
          }}
        >
          Orchestrate a software task.
        </h1>
        <p
          style={{
            marginTop: 14,
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--text-2)"
          }}
        >
          Decompose work into a DAG of agent tasks. Prepare leaf work for isolated Codex
          worktrees, inspect the contract, then compare granularities without pretending the
          MVP is a cloud platform.
        </p>
      </section>

      <CommandCenterShell
        workspaces={workspaces}
        initialGranularity="media"
        initialModelId={DEFAULT_MODEL_ID}
      />

      <RecentRunsStrip runs={previews} />
    </div>
  );
}
