import { describe, expect, it } from "vitest";
import {
  EffectInputSpecSchema,
  buildEffectInput,
  validateEffectInputIdentity,
  type DigestHasher
} from "@manyhands/contracts";

describe("effect input contract", () => {
  it("binds the digest to the canonical v1 spec without embedding identity in the spec", () => {
    let hashedBytes = "";
    const inspectHasher: DigestHasher = (value) => {
      hashedBytes = value;
      return "sha256:known-input";
    };

    const effectInput = buildEffectInput({
      payload: {
        z: [true, null, { beta: 2, alpha: "one" }],
        a: 1
      },
      kind: "model_call",
      schemaVersion: 1
    }, inspectHasher);

    expect(hashedBytes).toBe(
      '{"kind":"model_call","payload":{"a":1,"z":[true,null,{"alpha":"one","beta":2}]},"schemaVersion":1}'
    );
    expect(effectInput).toEqual({
      inputDigest: "sha256:known-input",
      spec: {
        schemaVersion: 1,
        kind: "model_call",
        payload: {
          z: [true, null, { beta: 2, alpha: "one" }],
          a: 1
        }
      }
    });
    expect(effectInput.spec).not.toHaveProperty("inputDigest");
  });

  it("produces one identity for semantically identical object key orders", () => {
    const hasher: DigestHasher = (value) => `digest:${value}`;

    const first = buildEffectInput({
      schemaVersion: 1,
      kind: "delivery",
      payload: { target: "origin", flags: { force: false, atomic: true } }
    }, hasher);
    const reordered = buildEffectInput({
      payload: { flags: { atomic: true, force: false }, target: "origin" },
      kind: "delivery",
      schemaVersion: 1
    }, hasher);

    expect(reordered.inputDigest).toBe(first.inputDigest);
    expect(validateEffectInputIdentity(reordered, hasher)).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["unknown top-level field", { schemaVersion: 1, kind: "cleanup", payload: {}, extra: true }],
    ["array payload", { schemaVersion: 1, kind: "cleanup", payload: [] }],
    ["undefined value", { schemaVersion: 1, kind: "cleanup", payload: { value: undefined } }],
    ["non-finite number", { schemaVersion: 1, kind: "cleanup", payload: { value: Number.POSITIVE_INFINITY } }],
    ["function value", { schemaVersion: 1, kind: "cleanup", payload: { value: () => undefined } }],
    ["unsupported version", { schemaVersion: 2, kind: "cleanup", payload: {} }]
  ])("rejects %s instead of hashing lossy JSON", (_label, input) => {
    expect(EffectInputSpecSchema.safeParse(input).success).toBe(false);
    expect(() => buildEffectInput(input, () => "sha256:unused")).toThrow();
  });

  it("detects a digest that does not identify the exact spec", () => {
    const hasher: DigestHasher = (value) => `digest:${value}`;
    const effectInput = buildEffectInput({
      schemaVersion: 1,
      kind: "validation",
      payload: { command: "test" }
    }, hasher);

    const validation = validateEffectInputIdentity({
      ...effectInput,
      spec: { ...effectInput.spec, payload: { command: "build" } }
    }, hasher);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual([
      expect.objectContaining({ code: "input_digest_mismatch" })
    ]);
  });

  it("rejects non-JSON own properties instead of silently omitting them", () => {
    const hiddenPayload = { visible: true };
    Object.defineProperty(hiddenPayload, "hidden", { value: "not-json-visible" });
    const symbolPayload = { visible: true, [Symbol("hidden")]: "not-json-visible" };

    for (const payload of [hiddenPayload, symbolPayload]) {
      expect(EffectInputSpecSchema.safeParse({
        schemaVersion: 1,
        kind: "cleanup",
        payload
      }).success).toBe(false);
    }
  });
});
