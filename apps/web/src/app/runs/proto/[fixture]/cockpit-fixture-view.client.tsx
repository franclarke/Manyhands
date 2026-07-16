"use client";

import { useMemo } from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { GOLDEN_FIXTURES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { useFixturePlayback } from "@/components/run-model/use-fixture-playback";
import { RunModelView } from "../../[runId]/_components/run-model-view.client";

/** Fixture playback rendered through the same cockpit component as a live run. */
export function CockpitFixtureView({ fixtureName }: { fixtureName: GoldenFixtureName }): React.ReactElement {
  const fixture = GOLDEN_FIXTURES[fixtureName];
  const playback = useFixturePlayback(fixture, { autoplay: false });
  const events = useMemo(() => fixture.events.slice(0, playback.index), [fixture.events, playback.index]);

  return (
    <div className="h-screen min-h-[640px] bg-[var(--color-bg)]">
      <div className="absolute right-4 top-4 z-[60] flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-1 shadow-sm">
        <button type="button" onClick={playback.play} disabled={playback.done} className="flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-meta text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]">
          <Play aria-hidden className="h-3.5 w-3.5" />Reproducir
        </button>
        <button type="button" onClick={playback.pause} className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]" aria-label="Pausar fixture" title="Pausar fixture"><Pause aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={playback.step} disabled={playback.done} className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]" aria-label="Avanzar un evento" title="Avanzar un evento"><StepForward aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={playback.restart} className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]" aria-label="Reiniciar fixture" title="Reiniciar fixture"><RotateCcw aria-hidden className="h-3.5 w-3.5" /></button>
        <span className="mh-mono px-1 text-eyebrow text-[var(--color-text-subtle)]">{playback.index}/{playback.total}</span>
      </div>
      <RunModelView
        seed={playback.model.run}
        initialEvents={events}
        workspaceName={`Fixture: ${fixtureName}`}
        fixture={{ model: playback.model, events }}
      />
    </div>
  );
}
