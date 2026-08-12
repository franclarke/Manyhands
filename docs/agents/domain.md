# Domain documentation

ManyHands uses one target-architecture source to prevent competing vocabularies
and parallel designs.

## Before implementation

1. Read `PRODUCT.md`.
2. Read `docs/plans/2026-08-12-correctness-first-system-redesign.md` completely.
3. Inspect the productive source path and tests named by the active stage.
4. Consult `docs/tesis/` only when academic or historical evidence is relevant.
   Do not treat it as a current specification.

## Vocabulary and authority

- Use the canonical language in section 5 of the redesign plan.
- Do not rename persisted historical evidence to match newer terminology.
- Classify target gaps as `implemented`, `partial`, `missing`, `incompatible` or
  `unknown` and support the classification with current evidence.
- Do not create another architecture overview, ADR set or subsystem
  specification. Amend the canonical plan when an authorized architectural
  decision genuinely changes it.
- A compatibility adapter is valid only at a named historical read boundary and
  must have a retirement criterion.
