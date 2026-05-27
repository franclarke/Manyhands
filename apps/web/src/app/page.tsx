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
      <section style={{ marginBottom: 26 }}>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--coral)",
            margin: 0,
            marginBottom: 14
          }}
        >
          Command center
        </p>
        <h1
          className="mh-serif"
          style={{
            fontSize: 40,
            lineHeight: 1.1,
            color: "var(--text)",
            margin: 0,
            maxWidth: 820
          }}
        >
          Describí qué querés construir.
        </h1>
        <p
          style={{
            marginTop: 14,
            maxWidth: 720,
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--text-2)"
          }}
        >
          ManyHands descompone la tarea en un DAG de subtareas delegables, ejecuta subagentes acotados por nodo
          y consolida los cambios de forma auditable. Elegí workspace, scenario y granularidad antes de arrancar.
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
