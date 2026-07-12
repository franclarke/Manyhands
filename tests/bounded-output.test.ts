import { describe, expect, it } from "vitest";
import { BoundedOutput } from "@manyhands/execution-core";

describe("BoundedOutput", () => {
  it("retains an actionable tail while bounding retained output", () => {
    const output = new BoundedOutput(32);
    output.append("a".repeat(64));
    output.append("TAIL");
    expect(output.bytesObserved).toBe(68);
    expect(output.truncated).toBe(true);
    expect(output.text()).toContain("TAIL");
    expect(Buffer.byteLength(output.text(), "utf8")).toBeLessThan(160);
  });
});
