import { CommandCenterShell } from "./(command-center)/_components/command-center-shell.client";
import { RecentRunsStrip } from "./(command-center)/_components/recent-runs-strip";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { getRunRepository } from "@/lib/server/runs";
import { toRunPreview } from "@/lib/server/runs/presenter";
import { getWorkspaceRepository } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_WIDTH = 1240;

export default async function HomePage(): Promise<React.ReactElement> {
  const [workspaces, runs] = await Promise.all([
    getWorkspaceRepository().list(),
    getRunRepository().list({ limit: 6 })
  ]);
  const wsByid = new Map(workspaces.map((entry) => [entry.id, entry]));
  const previews = runs.map((run) => toRunPreview(run, wsByid));

  return (
    <div>
      <section style={{ margin: "24px auto 16px", maxWidth: PAGE_WIDTH }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <span className="mh-coord" style={{ color: "var(--copper)", margin: 0 }}>
            command center
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        </div>
        <h1
          className="mh-serif"
          style={{
            fontSize: 32,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            margin: 0
          }}
        >
          Orchestrate a software task.
        </h1>
        <p
          style={{
            marginTop: 6,
            maxWidth: 600,
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--text-2)"
          }}
        >
          Decompose work into a DAG of agent tasks. Run leaves in isolated worktrees, integrate
          bottom-up, and review every change before it lands.
        </p>
      </section>

      <div className="command-center-grid" style={{ maxWidth: PAGE_WIDTH, margin: "0 auto" }}>
        <CommandCenterShell
          workspaces={workspaces}
          initialGranularity="automatica"
          initialModelId={DEFAULT_MODEL_ID}
        />
        <RecentRunsStrip runs={previews} compact />
      </div>
    </div>
  );
}
