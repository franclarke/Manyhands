# Stage 1 canonical correctness kernel

**Gate:** G1

**Status:** `pass`

**Accepted candidate:** `393603debcc202761c3aae5e4f6d233ac2701e3a`

**Accepted candidate tree:** `5acb5ed58028a23a7747f2a4fb03410496fe6bd9`

**Captured:** 2026-08-12 (`America/Buenos_Aires`)

This record closes the canonical-contract gate defined by the
[correctness-first redesign plan](../../plans/2026-08-12-correctness-first-system-redesign.md).
The accepted candidate introduces the versioned contract, proof-authority,
artifact-identity and graph-invariant kernel required by Stage 1.

## Verified evidence

- The focused Stage 1 suite passed 18 files and 122 tests.
- The complete repository suite passed 239 files and 1,523 tests, with 4
  explicit skips.
- All 12 package typechecks passed.
- The web TypeScript check passed.
- The package build and web production build passed.
- Scoped lint for new Stage 1 code passed. Two pre-existing
  `@typescript-eslint/no-explicit-any` diagnostics remain in mechanically
  renamed legacy files and are part of the existing baseline, not new kernel
  code.
- `git diff --check` passed.

One bounded independent review returned GO after confirming the correction of
exactly four concrete P1 findings: evidence-binding digest tampering, canonical
graph acceptance with a stale digest, order-sensitive graph identity, and
contradictory add/delete manifest preimages or postimages.

## Admitted claim and transition boundary

G1 proves the deterministic canonical correctness kernel and its invariant
validators on the accepted candidate. The live productive path remains on the
explicitly named legacy representation and is unchanged by this gate. Runtime
cutover occurs in later stages; therefore G1 does not claim daemon ownership,
live canonical execution, or retirement of the legacy path.

Stage 2 is authorized and `in_progress`.
