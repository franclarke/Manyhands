"use client";

import { useMemo, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  RotateCcw,
  StepBack,
  StepForward
} from "lucide-react";

import { useFixturePlayback } from "@/components/run-model/use-fixture-playback";
import { GOLDEN_FIXTURES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { RunModelView } from "../../[runId]/_components/run-model-view.client";

const ICON_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-35";

/** Fixture playback rendered through the same cockpit component as a live run. */
export function CockpitFixtureView({ fixtureName }: { fixtureName: GoldenFixtureName }): React.ReactElement {
  const fixture = GOLDEN_FIXTURES[fixtureName];
  const [playbackRate, setPlaybackRate] = useState(1);
  const playback = useFixturePlayback(fixture, { autoplay: false, playbackRate });
  const events = useMemo(() => fixture.events.slice(0, playback.index), [fixture.events, playback.index]);
  const milestoneNumber = playback.currentMilestone === null
    ? 0
    : fixture.milestones.findIndex((milestone) => milestone.id === playback.currentMilestone?.id) + 1;

  const toolbar = (
    <section
      aria-label="Controles de la demostración"
      data-layout="compact-playback"
      className="relative flex min-h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 pb-2 pt-1.5"
    >
      <div className="flex min-w-[260px] flex-1 items-baseline gap-2 overflow-hidden">
        <span className="mh-mono shrink-0 text-eyebrow uppercase tracking-[0.12em] text-[var(--color-accent)]">
          Hito {milestoneNumber}/{fixture.milestones.length}
        </span>
        <strong className="truncate text-xs font-semibold text-[var(--color-text)]">
          {playback.currentMilestone?.title ?? "Antes de comenzar"}
        </strong>
        <span className="hidden min-w-0 truncate text-micro text-[var(--color-text-subtle)] 2xl:inline">
          {playback.currentMilestone?.description ?? "Avanzá al primer evento para presentar el objetivo."}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Navegación de la demostración">
        <button
          type="button"
          onClick={playback.previousMilestone}
          disabled={playback.index === 0}
          className={ICON_BUTTON}
          aria-label="Ir al hito anterior"
          title="Hito anterior"
        >
          <ChevronsLeft aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={playback.previous}
          disabled={playback.index === 0}
          className={ICON_BUTTON}
          aria-label="Retroceder un evento"
          title="Evento anterior"
        >
          <StepBack aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={playback.playing ? playback.pause : playback.play}
          disabled={playback.done && !playback.playing}
          className={`${ICON_BUTTON} !w-auto gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-label font-semibold`}
          aria-label={playback.playing ? "Pausar demostración" : "Reproducir demostración"}
        >
          {playback.playing
            ? <Pause aria-hidden className="size-4" />
            : <Play aria-hidden className="size-4" />}
          {playback.playing ? "Pausar" : "Reproducir"}
        </button>
        <button
          type="button"
          onClick={playback.step}
          disabled={playback.done}
          className={ICON_BUTTON}
          aria-label="Avanzar un evento"
          title="Evento siguiente"
        >
          <StepForward aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={playback.nextMilestone}
          disabled={playback.done}
          className={ICON_BUTTON}
          aria-label="Ir al hito siguiente"
          title="Hito siguiente"
        >
          <ChevronsRight aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={playback.restart}
          disabled={playback.index === 0}
          className={ICON_BUTTON}
          aria-label="Reiniciar demostración"
          title="Reiniciar"
        >
          <RotateCcw aria-hidden className="size-3.5" />
        </button>
      </div>

      <label className="flex shrink-0 items-center gap-1.5 text-meta text-[var(--color-text-muted)]">
        <span className="hidden 2xl:inline">Velocidad</span>
        <select
          value={playbackRate}
          onChange={(event) => setPlaybackRate(Number(event.target.value))}
          className="h-8 rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-meta outline-none focus:border-[var(--color-accent)]"
          aria-label="Velocidad de reproducción"
        >
          <option value={0.5}>0,5×</option>
          <option value={0.75}>0,75×</option>
          <option value={1}>1×</option>
          <option value={1.5}>1,5×</option>
          <option value={2}>2×</option>
        </select>
      </label>

      <span className="mh-mono min-w-12 shrink-0 text-right text-eyebrow tabular-nums text-[var(--color-text-subtle)]">
        {playback.index}/{playback.total}
      </span>

      <label className="absolute inset-x-0 bottom-[-3px] h-2">
        <span className="sr-only">Posición de la demostración</span>
        <input
          type="range"
          min={0}
          max={playback.total}
          value={playback.index}
          onChange={(event) => playback.seek(Number(event.target.value))}
          aria-valuetext={`${playback.currentMilestone?.title ?? "Inicio"}, evento ${playback.index} de ${playback.total}`}
          className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
        />
      </label>
    </section>
  );

  return (
    <div className="h-dvh min-h-[640px] bg-[var(--color-bg)]">
      <RunModelView
        seed={fixture.seed}
        initialEvents={events}
        workspaceName="Demo guiada · recuperación de contraseña"
        fixture
        fixtureToolbar={toolbar}
      />
    </div>
  );
}
