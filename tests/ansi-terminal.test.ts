/**
 * ANSI terminal parser for the node evidence view (UI/UX loop, dirección B).
 *
 * Agent logs (`log://runs/{id}/node/{nodeId}`) carry raw SGR escape codes from
 * `node:test` (e.g. `[32m✔ pass [90m(1ms)[39m`). The focus panel
 * used to dump them into a `<pre>`, so they rendered as garbage. This pure parser
 * turns them into tone-tagged segments the terminal component paints with design
 * tokens — never literal cyan/blue (banned by the design system).
 */
import { describe, expect, it } from "vitest";
import { parseAnsiLog, stripAnsi, type AnsiTone } from "@/lib/run-model/ansi";

const ESC = "";

describe("stripAnsi", () => {
  it("removes SGR color codes leaving clean text", () => {
    expect(stripAnsi(`${ESC}[32m✔ is a function ${ESC}[90m(1.06ms)${ESC}[39m${ESC}[39m`)).toBe(
      "✔ is a function (1.06ms)"
    );
  });

  it("removes non-SGR escape sequences (cursor/erase) too", () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gloading${ESC}[?25h`)).toBe("loading");
  });

  it("is a no-op on plain text", () => {
    expect(stripAnsi("plain text 123")).toBe("plain text 123");
  });
});

describe("parseAnsiLog", () => {
  it("returns no lines for empty input", () => {
    expect(parseAnsiLog("")).toEqual([]);
  });

  it("splits into one line array per physical line, preserving blanks", () => {
    const lines = parseAnsiLog("a\n\nb");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual([]); // the blank line keeps vertical rhythm
    expect(lines[0]?.[0]?.text).toBe("a");
    expect(lines[2]?.[0]?.text).toBe("b");
  });

  it("tags a green check as 'pass' and a gray timing as 'muted'", () => {
    const [line] = parseAnsiLog(`${ESC}[32m✔ is a function ${ESC}[90m(1.06ms)${ESC}[39m${ESC}[39m`);
    expect(line).toBeDefined();
    const pass = line!.find((s) => s.text.includes("✔"));
    const timing = line!.find((s) => s.text.includes("1.06ms"));
    expect(pass?.tone).toBe("pass");
    expect(timing?.tone).toBe("muted");
  });

  it("maps red to 'fail' and yellow to 'warn'", () => {
    const [redLine] = parseAnsiLog(`${ESC}[31m✖ failed${ESC}[39m`);
    const [yellowLine] = parseAnsiLog(`${ESC}[33m! careful${ESC}[39m`);
    expect(redLine?.[0]?.tone).toBe("fail");
    expect(yellowLine?.[0]?.tone).toBe("warn");
  });

  it("maps blue/cyan to 'info' (never a literal cyan tone — design ban)", () => {
    const [blue] = parseAnsiLog(`${ESC}[34mℹ tests 15${ESC}[39m`);
    const [cyan] = parseAnsiLog(`${ESC}[36mℹ note${ESC}[39m`);
    expect(blue?.[0]?.tone).toBe("info");
    expect(cyan?.[0]?.tone).toBe("info");
    // The tone vocabulary itself must not leak a blue/cyan name.
    const tones: AnsiTone[] = ["default", "pass", "fail", "warn", "info", "muted"];
    expect(tones).not.toContain("cyan" as unknown as AnsiTone);
  });

  it("resets tone and bold on code 0, and tracks bold (code 1)", () => {
    const [line] = parseAnsiLog(`${ESC}[1m${ESC}[31mloud${ESC}[0mquiet`);
    expect(line).toBeDefined();
    const loud = line!.find((s) => s.text === "loud");
    const quiet = line!.find((s) => s.text === "quiet");
    expect(loud?.bold).toBe(true);
    expect(loud?.tone).toBe("fail");
    expect(quiet?.bold).toBe(false);
    expect(quiet?.tone).toBe("default");
  });

  it("handles compound params (e.g. 1;32) in a single escape", () => {
    const [line] = parseAnsiLog(`${ESC}[1;32mbold green${ESC}[0m`);
    expect(line?.[0]?.bold).toBe(true);
    expect(line?.[0]?.tone).toBe("pass");
  });

  it("treats plain text as a single default segment", () => {
    const [line] = parseAnsiLog("status: success");
    expect(line).toEqual([{ text: "status: success", tone: "default", bold: false }]);
  });

  it("does not emit a segment for the escape codes themselves", () => {
    const lines = parseAnsiLog(`${ESC}[32m✔${ESC}[39m`);
    const joined = lines.flat().map((s) => s.text).join("");
    expect(joined).toBe("✔");
    expect(joined).not.toContain("[32m");
    expect(joined).not.toContain(ESC);
  });
});
