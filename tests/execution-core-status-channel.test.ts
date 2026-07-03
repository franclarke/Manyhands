import { describe, expect, it } from "vitest";
import {
  AGENT_STATUS_PROTOCOL_INSTRUCTIONS,
  createAgentStatusScanner,
  type AgentStatusUpdate
} from "@manyhands/execution-core";

function collect(): { updates: AgentStatusUpdate[]; onStatus: (update: AgentStatusUpdate) => void } {
  const updates: AgentStatusUpdate[] = [];
  return { updates, onStatus: (update) => updates.push(update) };
}

describe("createAgentStatusScanner (send-to-user channel)", () => {
  it("detects a status line embedded in regular output", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan('compiling...\nMH_STATUS {"message":"implementing parser","phase":"implement"}\nmore\n');

    expect(updates).toEqual([{ message: "implementing parser", phase: "implement" }]);
  });

  it("reassembles lines split across chunks", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan('MH_STATUS {"message":"half ');
    scan('done","pct":50}\n');

    expect(updates).toEqual([{ message: "half done", pct: 50 }]);
  });

  it("tolerates an optional colon after the prefix and surrounding whitespace", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan('  MH_STATUS: {"message":"ok"}\n');

    expect(updates).toEqual([{ message: "ok" }]);
  });

  it("ignores malformed payloads without throwing", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan("MH_STATUS {not json}\n");
    scan("MH_STATUS\n");
    scan('MH_STATUS {"phase":"missing message"}\n');

    expect(updates).toEqual([]);
  });

  it("drops non-finite or out-of-range pct but keeps the message", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan('MH_STATUS {"message":"weird pct","pct":250}\n');

    expect(updates).toEqual([{ message: "weird pct" }]);
  });

  it("emits multiple updates from a single chunk and flushes trailing lines", () => {
    const { updates, onStatus } = collect();
    const scan = createAgentStatusScanner(onStatus);

    scan('MH_STATUS {"message":"one"}\nMH_STATUS {"message":"two"}\nMH_STATUS {"message":"three"}');
    expect(updates.map((u) => u.message)).toEqual(["one", "two"]);

    scan.flush();
    expect(updates.map((u) => u.message)).toEqual(["one", "two", "three"]);
  });
});

describe("AGENT_STATUS_PROTOCOL_INSTRUCTIONS", () => {
  it("teaches the MH_STATUS protocol with a concrete example", () => {
    expect(AGENT_STATUS_PROTOCOL_INSTRUCTIONS).toContain("MH_STATUS");
    expect(AGENT_STATUS_PROTOCOL_INSTRUCTIONS).toContain('"message"');
  });
});
