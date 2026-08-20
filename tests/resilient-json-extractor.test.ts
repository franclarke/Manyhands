import { describe, expect, it } from "vitest";
import {
  extractBalancedJsonObject,
  repairCommonJsonSyntax,
  robustlyParseJson,
  stripThinkingBlocks
} from "@manyhands/decomposer";

describe("Resilient JSON Extractor for Planning LLM outputs", () => {
  it("parses pure JSON directly", () => {
    const raw = '{"kind": "candidate", "units": {"root": {"id": "root"}}}';
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { kind: string }).kind).toBe("candidate");
    }
  });

  it("strips thinking tags (<thinking>...</thinking>) before parsing", () => {
    const raw = `
<thinking>
We need to decompose the goal into 3 units.
First is domain, second is storage, third is CLI.
Let's structure the JSON response carefully.
</thinking>
{
  "kind": "candidate",
  "units": {
    "root": { "id": "root" }
  }
}`;
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { kind: string }).kind).toBe("candidate");
    }
  });

  it("extracts JSON wrapped in markdown code fences with preamble and postamble", () => {
    const raw = `
Here is the requested decomposition for the project:

\`\`\`json
{
  "kind": "candidate",
  "units": {
    "root": { "id": "root", "title": "Root composite" }
  }
}
\`\`\`

Let me know if you would like me to adjust any of the validation obligations.
`;
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { kind: string }).kind).toBe("candidate");
    }
  });

  it("repairs trailing commas in objects and arrays commonly emitted by LLMs", () => {
    const raw = `
{
  "kind": "candidate",
  "units": {
    "root": {
      "id": "root",
      "items": [
        "item1",
        "item2",
      ],
    },
  },
}
`;
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const val = result.value as { units: { root: { items: string[] } } };
      expect(val.units.root.items).toHaveLength(2);
    }
  });

  it("scans and extracts balanced JSON when LLM emits conversational text without fences", () => {
    const raw = `
Sure! I have prepared the plan.
{
  "kind": "needs_input",
  "decisions": [
    { "id": "d1", "question": "Which database engine?" }
  ]
}
Hope this helps!
`;
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { kind: string }).kind).toBe("needs_input");
    }
  });

  it("returns ok: false with raw output when no JSON can be extracted", () => {
    const raw = "I am unable to decompose this goal because the repository is empty.";
    const result = robustlyParseJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.raw).toBe(raw);
    }
  });

  it("directly strips thinking tags and extracts balanced object", () => {
    const raw = "<thinking>internal</thinking>{\"a\": 1}";
    expect(stripThinkingBlocks(raw)).toBe('{"a": 1}');
    expect(extractBalancedJsonObject(raw)).toBe('{"a": 1}');
  });

  it("directly repairs trailing commas", () => {
    expect(repairCommonJsonSyntax('{"a": 1, }')).toBe('{"a": 1}');
    expect(repairCommonJsonSyntax('[1, 2, ]')).toBe('[1, 2]');
  });
});
