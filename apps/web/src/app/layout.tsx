import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { getRunRepository, listCorruptRunRecords } from "@/lib/server/runs";
import { toRunPreview } from "@/lib/server/runs/presenter";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ManyHands",
  description: "Orquestación de subagentes: descomponé una tarea en un DAG, ejecutá las hojas en paralelo e integrá los resultados."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const workspaceRepository = getWorkspaceRepository();
  const [workspaces, runs, corruptRecords] = await Promise.all([
    workspaceRepository.list(),
    getRunRepository().list({ includeArchived: false, limit: 10 }),
    // Advance corruption discovery incrementally on real navigations. Stable
    // records come from the durable metadata index and are not reparsed.
    listCorruptRunRecords({ inspectionBudget: 8 })
  ]);
  
  const wsById = new Map(workspaces.map((entry) => [entry.id, entry]));
  await Promise.all(
    [...new Set(runs.map((run) => run.workspaceId))].map(async (workspaceId) => {
      if (wsById.has(workspaceId)) return;
      const canonical = await workspaceRepository.get(workspaceId).catch(() => undefined);
      if (canonical !== undefined) wsById.set(workspaceId, canonical);
    })
  );
  const previews = runs.map((run) => toRunPreview(run, wsById));

  return (
    <html lang="es" data-theme="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint (default: dark). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("mh-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}'
          }}
        />
      </head>
      <body className={`${geist.variable} ${jetbrainsMono.variable} ${newsreader.variable}`}>
        <div className="flex h-screen w-screen bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden">
          <AppSidebar
            workspaces={workspaces}
            recentRuns={previews}
            degradedRuns={corruptRecords.map((record) => ({
              runId: record.runId,
              reason: record.reason ?? "invalid run record"
            }))}
          />
          <main className="flex-1 overflow-y-auto min-w-0 flex flex-col relative">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

