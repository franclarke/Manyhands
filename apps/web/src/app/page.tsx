import { CommandCenterShell } from "./(command-center)/_components/command-center-shell.client";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { Flame } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<React.ReactElement> {
  const workspaces = await getWorkspaceRepository().list();

  return (
    <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full px-6 py-12 md:py-20 bg-[var(--color-bg)]">
      {/* Branding Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-11 h-11 rounded-lg bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-accent-contrast)] mb-4">
          <Flame className="w-5.5 h-5.5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] font-sans">
          ¿En qué proyecto trabajamos hoy?
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-md leading-relaxed">
          Ingresá una tarea técnica de software. ManyHands la descompondrá en un grafo vivo de subtareas para ejecutar en paralelo.
        </p>
      </div>

      <CommandCenterShell
        workspaces={workspaces}
        initialGranularity="automatica"
        initialModelId={DEFAULT_MODEL_ID}
      />
    </div>
  );
}

