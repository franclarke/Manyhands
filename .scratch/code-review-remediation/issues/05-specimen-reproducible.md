# 05 — El specimen se re-deriva desde el seed

**What to build:** los dieciseis valores esperados del catalogo se pueden reproducir desde el blob real del escenario, en vez de descansar en la palabra de quien los escribio.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] El script de derivacion queda commiteado y corre contra el blob del commit W1 verificado.
- [x] Su salida coincide con el catalogo congelado, verificado automaticamente.
- [x] Los siete valores que hoy no cubre ningun invariante quedan cubiertos.

## Closure evidence

- Base commit: `5623e6014858b038764320d3c9746d00c07ac3e3`.
- Implementation commit: `8ff4715030e9937f21f11112362d033010cf08b3`.
- Changed files:
  - `docs/tesis/evidence/scripts/derive-wide-graph-specimen.mjs`
  - `tests/wide-graph-metric-catalogue.test.ts`
- Public seam: the derivation CLI reads
  `src/scenarios/thesis-seed-2026.ts` with `git show <commit>:<path>`,
  derives all sixteen metrics without the catalogue, and only imports the
  catalogue after derivation when `--check` is requested.
- RED:
  `pnpm vitest run tests/wide-graph-metric-catalogue.test.ts` exited `1`;
  the new test failed with `MODULE_NOT_FOUND` for
  `derive-wide-graph-specimen.mjs`, while the seven existing tests passed.
- GREEN:
  `pnpm vitest run tests/wide-graph-metric-catalogue.test.ts` exited `0`
  with `8 passed`.
- Focused gate:
  `pnpm vitest run tests/wide-graph-metric-catalogue.test.ts tests/warehouse-study-assets.test.ts`
  exited `0` with `29 passed`.
- Real W1 check:
  `node docs/tesis/evidence/scripts/derive-wide-graph-specimen.mjs --repository C:\Users\franc\Documents\Proyectos\warehouse-control-tower-pilot-12 --commit 71f61c9efa222103ca2fb2f67692434ab493d75c --check`
  exited `0` and emitted the sixteen catalogue values.
- Asset gate:
  `node docs/tesis/evidence/scripts/pin-warehouse-assets.mjs --check`
  exited `0` with `all Warehouse asset pins match`.
- Diff gate: `git diff --check` exited `0`.
- P0 baseline: PASS in the isolated clone on this base with Node `22.23.1`
  and pnpm `7.29.3`; `211` test files passed (`1395` tests, `2` skipped),
  package typechecks passed, web typecheck passed after generating package
  `dist`, package build passed, and web build passed.
- P0 environment diagnosis: the active checkout is not a clean validation
  environment because ACL failures deny reads under `node_modules`
  (`zod` and `next`). The isolated install also required one forced,
  frozen-lockfile install to materialize the declared Tailwind native optional
  binding. Neither failure was attributed to product code.
- Additional adverse result: the non-gate root command
  `pnpm exec tsc -p tsconfig.json --noEmit` remains red on broad pre-existing
  test typing debt. Official package and web typecheck gates are green.
- Independent review:
  - Standards: `PASS`, no P0/P1/P2/P3 findings.
  - Spec: initially `PARTIAL` with one P2 because this durable RED/GREEN record
    was absent. Functional acceptance passed; after this record was committed,
    the affected-surface re-review returned `PASS` with no new P0/P1/P2.
- Product defects found: none.
- Limit: the derivation parser intentionally targets the frozen W1 scenario
  source shape. It is an attributable specimen check, not a general TypeScript
  evaluator.
- Next critical-path ticket after closure: `08`.
