"use client";

import { useEffect, useMemo, useState } from "react";

import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunFixture, RunModel } from "@/lib/run-model/types";

export function useFixturePlayback(
  fixture: RunFixture,
  options: { autoplay?: boolean; playbackRate?: number } = {}
): {
  model: RunModel;
  index: number;
  total: number;
  playing: boolean;
  done: boolean;
  play: () => void;
  pause: () => void;
  step: () => void;
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
    play: () => { if (!done) setPlaying(true); },
    pause: () => setPlaying(false),
    step: () => { setPlaying(false); setIndex((current) => Math.min(total, current + 1)); },
    restart: () => { setPlaying(false); setIndex(0); }
  };
}
