"use client";

/**
 * Proto run view (PR 06 → PR 08) — the orchestrator client component for the
 * fixture prototype. It is the ONLY place that wires the model together:
 *   runStore (via useFixturePlayback) → workspace/decision view-models → children.
 *
 * Architecture rules honoured:
 *  - Consumes the model exclusively through `runStore` + reducer + selectors
 *    (composed by `selectWorkspaceView` / `buildDecisionChannelView`).
 *  - Never mutates the `RunModel`; never stores derived state. The only local UI
 *    state is playback (in the hook) and the visual selection below.
 *  - Children paint from the view-models; none of them derive or read raw nodes,
 *    and none read `execution.kind` for visual state.
 *
 * Layout (PR 08): persistent frame · decision channel · phase-adaptive surface ·
 * playback controls · optional model-debug panel. The surface is the protagonist.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { GOLDEN_FIXTURES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { buildDecisionChannelView, findDecisionResolutionEvent } from "@/lib/run-model/decision-channel-view";
import { buildFocusView, formatFocusTarget, parseFocusTarget, type FocusTarget } from "@/lib/run-model/focus-view";
import { useFixturePlayback } from "./use-fixture-playback";
import { RunFrame } from "./run-frame";
import { DecisionChannel } from "./decision-channel";
import { WorkspaceSurface } from "./workspace-surface";
import { FocusPanel } from "./focus-panel";
import { ProtoDebugPanel } from "./proto-debug-panel";

export function ProtoRunView({
  fixtureName,
  initialFocus
}: {
  fixtureName: GoldenFixtureName;
  /** Deep-link seed parsed from `?focus=<kind>:<id>` by the route (may be invalid). */
  initialFocus?: string;
}): React.ReactElement {
  const fixture = GOLDEN_FIXTURES[fixtureName];
  const playback = useFixturePlayback(fixture);
  // Focus is purely LOCAL UI state — it never mutates the model and never pauses
  // playback (that lives in the player hook). Seeded once from the deep-link.
  const [focus, setFocus] = useState<FocusTarget | null>(() => parseFocusTarget(initialFocus));

  // Deep-link: reflect the current focus in the URL without a router re-render
  // (history.replaceState keeps playback running and avoids a Suspense boundary).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (focus === null) url.searchParams.delete("focus");
    else url.searchParams.set("focus", formatFocusTarget(focus));
    window.history.replaceState(window.history.state, "", url.toString());
  }, [focus]);

  const lastEvent = playback.lastEvent;
  const view = useMemo(
    () =>
      selectWorkspaceView(playback.model, {
        fixtureName,
        ...(lastEvent !== null ? { lastEvent: { type: lastEvent.type, seq: lastEvent.seq } } : {})
      }),
    [playback.model, fixtureName, lastEvent]
  );

  const channel = useMemo(() => buildDecisionChannelView(playback.model), [playback.model]);
  // Resolvability is a fixture concern (is there a `decision.resolved` ahead?),
  // computed with the pure helper — not derived inside the channel component.
  const resolvableIds = useMemo(
    () =>
      new Set(
        channel.items
          .filter((it) => findDecisionResolutionEvent(fixture.events, playback.index, it.id) !== null)
          .map((it) => it.id)
      ),
    [channel, fixture, playback.index]
  );
  const onResolve = useCallback((id: string) => void playback.resolveDecision(id), [playback.resolveDecision]);

  // Focus is recomputed on every model change, so the panel tracks the live run:
  // if the focused object disappears or is not-yet-present it degrades to a safe
  // `missing` view rather than vanishing or crashing.
  const focusView = useMemo(() => (focus !== null ? buildFocusView(playback.model, focus) : null), [playback.model, focus]);
  const focusDecision = useCallback((id: string) => setFocus({ kind: "decision", id }), []);
  const clearFocus = useCallback(() => setFocus(null), []);

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: 20,
        maxWidth: focusView !== null ? 1560 : 1200,
        margin: "0 auto",
        minHeight: "100vh",
        alignItems: "flex-start"
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <RunFrame frame={view.frame} />

        <DecisionChannel
          view={channel}
          resolvableIds={resolvableIds}
          onResolve={onResolve}
          onFocus={focusDecision}
          focusedDecisionId={focus?.kind === "decision" ? focus.id : null}
        />

        <PlaybackControls
          fixtureName={fixtureName}
          index={playback.index}
          total={playback.total}
          playing={playback.playing}
          done={playback.done}
          onPlay={playback.play}
          onPause={playback.pause}
          onStep={playback.step}
          onRestart={playback.restart}
        />

        <WorkspaceSurface view={view} selectedTarget={focus} onFocus={setFocus} />

        <ProtoDebugPanel debug={view.debug} />
      </div>

      {focusView !== null ? (
        <div style={{ width: 380, flex: "0 0 380px" }}>
          <FocusPanel view={focusView} onClose={clearFocus} onFocus={setFocus} />
        </div>
      ) : null}
    </div>
  );
}

function PlaybackControls({
  fixtureName,
  index,
  total,
  playing,
  done,
  onPlay,
  onPause,
  onStep,
  onRestart
}: {
  fixtureName: string;
  index: number;
  total: number;
  playing: boolean;
  done: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onRestart: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "var(--surface, #1a1915)",
        border: "1px solid var(--border, rgba(241,234,216,0.12))",
        borderRadius: "var(--r-md, 8px)"
      }}
    >
      <Btn label={playing ? "Pausar" : "Reproducir"} onClick={playing ? onPause : onPlay} disabled={done && !playing} primary />
      <Btn label="Paso" onClick={onStep} disabled={done} />
      <Btn label="Reiniciar" onClick={onRestart} />
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          color: "var(--text-3, #9a927f)"
        }}
      >
        {fixtureName} · evento {index}/{total}
        {done ? " · fin" : ""}
      </span>
    </div>
  );
}

function Btn({
  label,
  onClick,
  disabled = false,
  primary = false
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 32,
        padding: "0 12px",
        borderRadius: 6,
        border: `1px solid ${primary ? "var(--copper, #d08a5a)" : "var(--rule-control, rgba(241,234,216,0.2))"}`,
        background: primary ? "rgba(208,138,90,0.14)" : "rgba(241,234,216,0.035)",
        color: disabled ? "var(--text-4, #6f6857)" : primary ? "var(--copper-hi, #e0a070)" : "var(--text-2, #cfc7b4)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer"
      }}
    >
      {label}
    </button>
  );
}
