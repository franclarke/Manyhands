"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GOLDEN_FIXTURES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { EVIDENCE_FOCUS_TARGET, buildFocusView, formatFocusTarget, parseFocusTarget, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { buildTimelineView } from "@/lib/run-model/timeline-view";
import { MinimalRunGraphCanvas } from "./minimal-run-graph";
import { FocusPanel } from "./focus-panel";
import { Timeline } from "./timeline";
import { useFixturePlayback } from "./use-fixture-playback";

export function ProtoRunView({
  fixtureName,
  initialFocus
}: {
  fixtureName: GoldenFixtureName;
  initialFocus?: string;
}): React.ReactElement {
  const fixture = GOLDEN_FIXTURES[fixtureName];
  const playback = useFixturePlayback(fixture);
  const [focus, setFocus] = useState<FocusTarget | null>(() => parseFocusTarget(initialFocus));
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (focus === null) url.searchParams.delete("focus");
    else url.searchParams.set("focus", formatFocusTarget(focus));
    window.history.replaceState(window.history.state, "", url.toString());
  }, [focus]);

  const view = useMemo(() => selectMinimalWorkspaceView(playback.model), [playback.model]);
  const focusView = useMemo(() => (focus !== null ? buildFocusView(playback.model, focus) : null), [playback.model, focus]);
  const timeline = useMemo(() => buildTimelineView(fixture.events.slice(0, playback.index)), [fixture, playback.index]);
  const resolveDecision = playback.resolveDecision;
  const onResolve = useCallback((id: string) => void resolveDecision(id), [resolveDecision]);

  return (
    <div className={focusView !== null ? "mh-run-page mh-run-page-with-focus" : "mh-run-page"}>
      <div className="mh-run-main">
        <header className="mh-run-hero">
          <div>
            <span className="mh-run-stage">Fixture · {stageLabel(view.stage)}</span>
            <h1>{view.title}</h1>
            <p>{view.statusLine}</p>
          </div>
          <div className="mh-run-hero-side">
            <span className={playback.playing ? "mh-live mh-live-on" : "mh-live"}>
              {playback.playing ? "reproduciendo" : playback.done ? "fin" : "en pausa"}
            </span>
            <span>{fixtureName} · evento {playback.index}/{playback.total}</span>
          </div>
        </header>

        {view.primaryAttention !== null ? (
          <section className={view.primaryAttention.blocking ? "mh-decision-banner mh-decision-banner-blocking" : "mh-decision-banner"}>
            <div>
              <span>{view.primaryAttention.blocking ? "Necesita tu decisión" : "Para revisar"}</span>
              <strong>{view.primaryAttention.label}</strong>
              <p>{view.primaryAttention.summary}</p>
            </div>
            <div className="mh-decision-actions">
              <button type="button" className="mh-secondary-action" onClick={() => setFocus({ kind: "decision", id: view.primaryAttention!.id })}>
                Inspeccionar
              </button>
              <button type="button" className="mh-primary-action" onClick={() => onResolve(view.primaryAttention!.id)}>
                {view.primaryAttention.primaryActionLabel}
              </button>
            </div>
          </section>
        ) : null}

        <PlaybackControls
          playing={playback.playing}
          done={playback.done}
          onPlay={playback.play}
          onPause={playback.pause}
          onStep={playback.step}
          onRestart={playback.restart}
        />

        {view.reviewEvidence !== null && view.stage === "review" ? (
          <section className="mh-review-strip">
            <div>
              <span>Evidencia</span>
              <strong>Tests {view.reviewEvidence.tests.pass}/{view.reviewEvidence.tests.total}</strong>
              <p>Integrado en {view.reviewEvidence.integrationCommit}. El grafo queda disponible como contexto.</p>
            </div>
            <button type="button" className="mh-secondary-action" onClick={() => setFocus(EVIDENCE_FOCUS_TARGET)}>
              Abrir evidencia
            </button>
          </section>
        ) : null}

        <MinimalRunGraphCanvas graph={view.graph} stage={view.stage} selectedTarget={focus} onFocus={setFocus} />

        <section className={activityOpen ? "mh-activity mh-activity-open" : "mh-activity"}>
          <button type="button" onClick={() => setActivityOpen((open) => !open)} className="mh-activity-toggle">
            <span>Actividad</span>
            <small>{playback.index} eventos aplicados</small>
          </button>
          {activityOpen ? (
            <div className="mh-activity-body">
              <Timeline view={timeline} focusedNodeId={focus?.kind === "node" ? focus.id : null} />
            </div>
          ) : null}
        </section>
      </div>

      {focusView !== null ? (
        <aside className="mh-run-focus" aria-label="Run detail inspector">
          <FocusPanel view={focusView} onClose={() => setFocus(null)} onFocus={setFocus} />
        </aside>
      ) : null}
    </div>
  );
}

function PlaybackControls({
  playing,
  done,
  onPlay,
  onPause,
  onStep,
  onRestart
}: {
  playing: boolean;
  done: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onRestart: () => void;
}): React.ReactElement {
  return (
    <nav className="mh-playback" aria-label="Fixture playback controls">
      <button type="button" className="mh-primary-action" onClick={playing ? onPause : onPlay} disabled={done && !playing}>
        {playing ? "Pausar" : "Reproducir"}
      </button>
      <button type="button" className="mh-secondary-action" onClick={onStep} disabled={done}>
        Paso
      </button>
      <button type="button" className="mh-secondary-action" onClick={onRestart}>
        Reiniciar
      </button>
    </nav>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "intent":
      return "Intención";
    case "proposal":
      return "Plan";
    case "review":
      return "Revisión";
    case "running":
    default:
      return "Ejecución";
  }
}
