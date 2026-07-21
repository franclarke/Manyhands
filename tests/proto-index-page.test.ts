import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "apps/web/src/app/runs/proto/page.tsx"),
  "utf8"
);

describe("proto index page", () => {
  it("keeps fixture navigation in the sidebar and centers only the ManyHands logo", () => {
    expect(source).toContain('import { Logo } from "@/components/logo"');
    expect(source).toContain('className="flex flex-1 items-center justify-center"');
    expect(source).toContain('<Logo type="mark"');
    expect(source).not.toContain("FIXTURE_CATALOG");
    expect(source).not.toContain("next/link");
    expect(source).not.toContain("Runs de muestra");
    expect(source).not.toContain("Recorridos reproducibles");
  });
});
