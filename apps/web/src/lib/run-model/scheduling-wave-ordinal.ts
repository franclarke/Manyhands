/**
 * Human wave labels are contiguous positions in the ordered scheduling facts.
 * New events persist `waveOrdinal`; legacy events fall back to their position
 * in the replay, never to global event seq or the historical `waveIndex` value.
 */
export function displayWaveOrdinal(
  payload: { waveOrdinal?: unknown },
  zeroBasedReplayPosition: number
): number {
  const persisted = payload.waveOrdinal;
  if (typeof persisted === "number" && Number.isInteger(persisted) && persisted > 0) {
    return persisted;
  }
  return Math.max(1, Math.trunc(zeroBasedReplayPosition) + 1);
}
