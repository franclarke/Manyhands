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
      <section style={{ margin: "40px auto 30px", maxWidth: PAGE_WIDTH }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <span className="mh-coord" style={{ color: "var(--copper)", margin: 0 }}>
            command center
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        </div>
        <h1
          className="mh-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.022em",
            color: "var(--text)",
            margin: 0
          }}
        >
          Orchestrate a software task.
        </h1>
        <p
          style={{
            marginTop: 14,
            maxWidth: 600,
            fontSize: 15,
            lineHeight: 1.6,
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

      <CommandFooter />
    </div>
  );
}

function CommandFooter(): React.ReactElement {
  return (
    <footer
      style={{
        maxWidth: PAGE_WIDTH,
        margin: "56px auto 8px",
        paddingTop: 14,
        borderTop: "1px solid var(--rule-soft)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.02em",
        color: "var(--text-2)"
      }}
    >
      <span>ManyHands · research preview</span>
      <span>Agents run locally via Gemini CLI</span>
      <span style={{ flex: 1 }} />
      <span>
        <span style={{ color: "var(--text-2)" }}>⌘↵</span> generate
      </span>
    </footer>
  );
}
