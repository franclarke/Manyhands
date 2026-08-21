/** A named heartbeat is observable by EventSource clients; SSE comments are not. */
export function serializeHeartbeat(lastSequence: number, at: string): string {
  return `event: heartbeat\ndata: ${JSON.stringify({ at, lastSeq: lastSequence })}\n\n`;
}
