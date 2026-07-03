import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/server/workspaces/slug";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics", () => {
    expect(slugify("ManyHands")).toBe("manyhands");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(slugify("Aprobado")).toBe("aprobado");
    expect(slugify("Café & Té")).toBe("cafe-te");
  });

  it("trims dashes and collapses repeats", () => {
    expect(slugify("---x---y---")).toBe("x-y");
  });

  it("falls back to 'workspace' when input is empty after normalization", () => {
    expect(slugify("///")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
  });

  it("truncates to 48 chars without trailing dash", () => {
    const slug = slugify("a".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe("uniqueSlug", () => {
  it("returns base when not taken", () => {
    expect(uniqueSlug("aprobado", new Set())).toBe("aprobado");
  });

  it("appends -2 on first collision", () => {
    expect(uniqueSlug("aprobado", new Set(["aprobado"]))).toBe("aprobado-2");
  });

  it("appends -3 on second collision", () => {
    expect(uniqueSlug("aprobado", new Set(["aprobado", "aprobado-2"]))).toBe("aprobado-3");
  });
});
