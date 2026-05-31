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
      <section style={{ margin: "48px auto 26px", maxWidth: 980 }}>
        <p className="mh-coord" style={{ margin: 0, marginBottom: 14, color: "var(--copper)" }}>
          command center
        </p>
        <h1
          className="mh-serif"
          style={{
            fontSize: 50,
            lineHeight: 1.06,
            color: "var(--text)",
            margin: 0
          }}
        >
          Orchestrate software work with agent task graphs.
        </h1>
        <p
          style={{
            marginTop: 14,
            maxWidth: 760,
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--text-2)"
          }}
        >
          Describe a feature, bugfix, or refactor. ManyHands plans the work, splits it into
          executable nodes, and lets you run agents with human review.
        </p>
      </section>

      <CommandCenterShell
        workspaces={workspaces}
        initialGranularity="automatica"
        initialModelId={DEFAULT_MODEL_ID}
      />

      <RecentRunsStrip runs={previews} />
    </div>
  );
}
