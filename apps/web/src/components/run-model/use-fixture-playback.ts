"use client";

/**
 * Minimal fixture player (PR 06). Drives a `runStore` by applying one fixture
 * event per tick, so the prototype reproduces a golden fixture the same way the
 * SSE adapter (PR 11) will later feed the live stream. All state transitions stay
 * in the pure reducer; this hook only schedules `store.apply` and tracks playback
 * UI state (running/paused, current index). It NEVER derives view state — that is
 * `selectProtoView`'s job.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createInitialRunModel } from "@/lib/run-model/reducer";
import { createRunStore, type RunStore } from "@/lib/run-model/store";
import { advanceFixtureToDecisionResolution } from "@/lib/run-model/decision-channel-view";
import type { RunConfig, RunEvent, RunFixture, RunModel } from "@/lib/run-model/types";

/** Placeholder identity/config; the fixture's `run.created` event overwrites it. */
const SEED_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "—",
  executionSelection: { executorId: "—", model: "—" },
  repairSelection: { executorId: "—", model: "—" }
};
const DEFAULT_DELAY_MS = 650;

function seedStore(fixture: RunFixture): RunStore {
  return createRunStore(
    createInitialRunModel({ id: fixture.runId, intent: "", workspaceId: "—", config: SEED_CONFIG })
  );
}

/** Outcome of a simulated resolution: it either fast-forwarded the fixture or
 *  there was no matching `decision.resolved` ahead in this fixture. */
export type DecisionResolutionOutcome =
  | { ok: true; appliedThrough: number; resolvedAtSeq: number }
  | { ok: false; reason: "no-resolution-in-fixture" };

export interface FixturePlayback {
  model: RunModel;
  /** Number of events applied so far. */
  index: number;
  total: number;
  lastEvent: RunEvent | null;
  playing: boolean;
  done: boolean;
  play(): void;
  pause(): void;
  restart(): void;
  step(): void;
  /** Resolve a decision by fast-forwarding to its existing `decision.resolved`. */
  resolveDecision(decisionId: string): DecisionResolutionOutcome;
}

export function useFixturePlayback(
  fixture: RunFixture,
  opts?: { autoplay?: boolean; defaultDelayMs?: number }
): FixturePlayback {
  const autoplay = opts?.autoplay ?? true;
  const delayMs = opts?.defaultDelayMs ?? DEFAULT_DELAY_MS;

  const storeRef = useRef<RunStore>(seedStore(fixture));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoplay);

  // Re-seed from scratch when the fixture changes (navigating between routes).
  useEffect(() => {
    storeRef.current = seedStore(fixture);
    setVersion((v) => v + 1);
    setIndex(0);
    setPlaying(autoplay);
  }, [fixture, autoplay]);

  // Re-subscribe whenever the store instance is replaced (restart / fixture swap).
  const subscribe = useCallback((cb: () => void) => storeRef.current.subscribe(cb), [version]);
  const getSnapshot = useCallback(() => storeRef.current.getSnapshot(), [version]);
  const model = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const total = fixture.events.length;
  const done = index >= total;

  // Advance one event per tick while playing.
  useEffect(() => {
    if (!playing) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    const event = fixture.events[index]!;
    const wait = fixture.playback?.delaysMs?.[index] ?? delayMs;
    const handle = setTimeout(() => {
      timerRef.current = null;
      storeRef.current.apply(event);
      setIndex((i) => i + 1);
    }, wait);
    timerRef.current = handle;
    return () => clearTimeout(handle);
  }, [playing, index, total, fixture, delayMs]);

  const play = useCallback(() => {
    if (index < total) setPlaying(true);
  }, [index, total]);
  const pause = useCallback(() => setPlaying(false), []);
  const restart = useCallback(() => {
    storeRef.current = seedStore(fixture);
    setVersion((v) => v + 1);
    setIndex(0);
    setPlaying(true);
  }, [fixture]);
  const step = useCallback(() => {
    setPlaying(false);
    if (index < total) {
      storeRef.current.apply(fixture.events[index]!);
      setIndex((i) => i + 1);
    }
  }, [fixture, index, total]);

  // Simulated resolution: fast-forward through EXISTING fixture events up to and
  // including the decision's `decision.resolved`. Cancels the pending tick first
  // to avoid double-applying / skipping an event, then pauses at the resolution.
  const resolveDecision = useCallback(
    (decisionId: string): DecisionResolutionOutcome => {
      const plan = advanceFixtureToDecisionResolution(fixture.events, index, decisionId);
      if (plan === null) return { ok: false, reason: "no-resolution-in-fixture" };
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setPlaying(false);
      storeRef.current.applyMany(plan.apply);
      setIndex(plan.nextIndex);
      return { ok: true, appliedThrough: plan.nextIndex, resolvedAtSeq: plan.resolution.event.seq };
    },
    [fixture, index]
  );

  const lastEvent = index > 0 ? fixture.events[index - 1]! : null;

  return { model, index, total, lastEvent, playing, done, play, pause, restart, step, resolveDecision };
}
