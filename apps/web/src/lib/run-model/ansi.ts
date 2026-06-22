/**
 * Pure ANSI/SGR parser for the node evidence terminal (UI/UX loop, dirección B).
 *
 * Agent logs (`log://runs/{id}/node/{nodeId}`) are raw `node:test` output carrying
 * SGR escape codes. This module turns them into tone-tagged segments the terminal
 * component paints with **design tokens** — green→pass (sage), red→fail (rust),
 * yellow→warn (amber), and blue/cyan→`info` which the component maps to a NEUTRAL
 * token (the design system bans literal cyan/celeste in every role). It is pure
 * and node-testable: no React, no DOM, no mutation of inputs.
 */

export type AnsiTone = "default" | "pass" | "fail" | "warn" | "info" | "muted";

export interface AnsiSegment {
  text: string;
  tone: AnsiTone;
  bold: boolean;
}

/** A physical line is an ordered list of styled segments ([] for a blank line). */
export type AnsiLine = AnsiSegment[];

/** ESC [ <params> <intermediates> <final> — the CSI family (colors, cursor, erase). */
const CSI = /\[[0-?]*[ -/]*[@-~]/g;

/** Strip every CSI escape sequence, leaving clean readable text. */
export function stripAnsi(input: string): string {
  return input.replace(CSI, "");
}

interface SgrState {
  tone: AnsiTone;
  bold: boolean;
}

const FG_TONE: Record<number, AnsiTone> = {
  31: "fail",
  91: "fail",
  32: "pass",
  92: "pass",
  33: "warn",
  93: "warn",
  34: "info",
  94: "info",
  36: "info",
  96: "info",
  90: "muted"
};

/** Apply one SGR escape's params (the text between `[` and `m`) to the state. */
function applySgr(params: string, state: SgrState): void {
  const codes = params.length === 0 ? [0] : params.split(";").map((p) => Number.parseInt(p, 10));
  for (const code of codes) {
    if (Number.isNaN(code)) continue;
    if (code === 0) {
      state.tone = "default";
      state.bold = false;
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 22) {
      state.bold = false;
    } else if (code === 39) {
      state.tone = "default";
    } else if (FG_TONE[code] !== undefined) {
      state.tone = FG_TONE[code]!;
    }
  }
}

/**
 * Parse raw terminal output into styled lines. State (color/bold) carries across
 * newlines, exactly like a real terminal. Returns `[]` for empty input.
 */
export function parseAnsiLog(input: string): AnsiLine[] {
  if (input === "") return [];

  const lines: AnsiLine[] = [];
  let current: AnsiLine = [];
  const state: SgrState = { tone: "default", bold: false };

  const pushText = (text: string): void => {
    if (text === "") return;
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        lines.push(current);
        current = [];
      }
      const part = parts[i]!;
      if (part.length === 0) continue;
      const last = current[current.length - 1];
      if (last !== undefined && last.tone === state.tone && last.bold === state.bold) {
        last.text += part;
      } else {
        current.push({ text: part, tone: state.tone, bold: state.bold });
      }
    }
  };

  let i = 0;
  while (i < input.length) {
    const esc = input.indexOf("", i);
    if (esc === -1) {
      pushText(input.slice(i));
      break;
    }
    if (esc > i) pushText(input.slice(i, esc));

    CSI.lastIndex = esc;
    const match = CSI.exec(input);
    if (match !== null && match.index === esc) {
      const seq = match[0];
      if (seq.endsWith("m")) applySgr(seq.slice(2, -1), state);
      i = esc + seq.length;
    } else {
      // Lone ESC or a sequence we don't model: drop the ESC byte, keep going.
      i = esc + 1;
    }
  }
  lines.push(current);
  return lines;
}
