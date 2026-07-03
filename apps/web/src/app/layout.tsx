import type { Metadata } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { getRunRepository } from "@/lib/server/runs";
import { toRunPreview } from "@/lib/server/runs/presenter";

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
  const [workspaces, runs] = await Promise.all([
    getWorkspaceRepository().list(),
    getRunRepository().list({ limit: 10 })
  ]);
  
  const wsById = new Map(workspaces.map((entry) => [entry.id, entry]));
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
      <body>
        <div className="flex h-screen w-screen bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden">
          <AppSidebar workspaces={workspaces} recentRuns={previews} />
          <main className="flex-1 overflow-y-auto min-w-0 flex flex-col relative">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

