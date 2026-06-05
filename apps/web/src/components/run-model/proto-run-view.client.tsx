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
import { useCallback, useMemo, useState } from "react";
import { GOLDEN_FIXTURES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { buildDecisionChannelView, findDecisionResolutionEvent } from "@/lib/run-model/decision-channel-view";
import { useFixturePlayback } from "./use-fixture-playback";
import { RunFrame } from "./run-frame";
import { DecisionChannel } from "./decision-channel";
import { WorkspaceSurface } from "./workspace-surface";
import { ProtoDebugPanel } from "./proto-debug-panel";

export function ProtoRunView({ fixtureName }: { fixtureName: GoldenFixtureName }): React.ReactElement {
  const fixture = GOLDEN_FIXTURES[fixtureName];
  const playback = useFixturePlayback(fixture);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        maxWidth: 1200,
        margin: "0 auto",
        minHeight: "100vh"
      }}
    >
      <RunFrame frame={view.frame} />

      <DecisionChannel view={channel} resolvableIds={resolvableIds} onResolve={onResolve} />

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

      <WorkspaceSurface view={view} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />

      <ProtoDebugPanel debug={view.debug} />
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
