"use client";

import { useEffect, useMemo, useState } from "react";

import {
  clampPlaybackCursor,
  currentFixtureMilestone,
  nextFixtureMilestoneCursor,
  previousFixtureMilestoneCursor
} from "@/lib/run-model/fixture-playback";
import { buildRunModel } from "@/lib/run-model/reducer";
import type { FixtureMilestone, RunFixture, RunModel } from "@/lib/run-model/types";

export function useFixturePlayback(
  fixture: RunFixture,
  options: { autoplay?: boolean; playbackRate?: number } = {}
): {
  model: RunModel;
  index: number;
  total: number;
  playing: boolean;
  done: boolean;
  currentMilestone: FixtureMilestone | null;
  play: () => void;
  pause: () => void;
  previous: () => void;
  step: () => void;
  previousMilestone: () => void;
  nextMilestone: () => void;
  seek: (index: number) => void;
  restart: () => void;
} {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(options.autoplay ?? false);
  const total = fixture.events.length;
  const done = index >= total;
  const rate = options.playbackRate ?? 1;

  useEffect(() => {
    if (!playing || done) return;
    const timer = window.setTimeout(
      () => setIndex((current) => Math.min(total, current + 1)),
      (fixture.intervalMs ?? 1_800) / rate
    );
    return () => window.clearTimeout(timer);
  }, [done, fixture.intervalMs, playing, rate, total, index]);

  useEffect(() => {
    if (done) setPlaying(false);
  }, [done]);

  return {
    model: useMemo(() => buildRunModel(fixture.seed, fixture.events.slice(0, index)), [fixture, index]),
    index,
    total,
    playing,
    done,
    currentMilestone: currentFixtureMilestone(fixture.milestones, index),
    play: () => { if (!done) setPlaying(true); },
    pause: () => setPlaying(false),
    previous: () => {
      setPlaying(false);
      setIndex((current) => clampPlaybackCursor(current - 1, total));
    },
    step: () => { setPlaying(false); setIndex((current) => Math.min(total, current + 1)); },
    previousMilestone: () => {
      setPlaying(false);
      setIndex((current) => previousFixtureMilestoneCursor(fixture.milestones, current));
    },
    nextMilestone: () => {
      setPlaying(false);
      setIndex((current) => nextFixtureMilestoneCursor(fixture.milestones, current, total));
    },
    seek: (nextIndex) => {
      setPlaying(false);
      setIndex(clampPlaybackCursor(nextIndex, total));
    },
    restart: () => {
      setPlaying(false);
      setIndex(0);
    }
  };
}
