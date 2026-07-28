# 06 — El protocolo longitudinal dice lo que el driver hace

**What to build:** el protocolo pre-registrado declara el executor que realmente se usa y la consecuencia de esa eleccion, en vez de contradecir a su propio driver.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Declara el executor real y su consecuencia: tokens como piso y costo no medible.
- [x] La reversion queda declarada en el protocolo, no solo en un comentario del codigo.
- [x] Una prueba falla si la seleccion del protocolo y la del driver divergen.

## Closure evidence

- Base commit: `f92c848a6945b7b410491091f0130d0b74ad280b`.
- Implementation commits on `main`:
  - `2ecad62e96e3d670ed9dd5d59906508121e15b46`
  - `16a8104d47ff8aceec6bbef992c5aac3125ab7a2`
- Protocol contract:
  - declares `codex-cli/gpt-5.5/high` for planning, execution and repair;
  - contains a machine-readable JSON selection compared automatically with
    the driver's `STUDY_SELECTION`;
  - records the pre-freeze executor reversion, the capacity cause and the
    current Codex-only availability;
  - states that tokens are a floor, cost is not measurable and missing values
    are not imputed.
- TDD RED:
  `pnpm vitest run tests/warehouse-longitudinal-driver.test.ts` exited `1`
  with exactly three new contract failures (machine-readable declaration
  missing, telemetry consequence absent from the protocol and reversion absent);
  the fourteen prior tests passed.
- TDD GREEN:
  the same command exited `0` with `17 passed`.
- Second RED:
  the dry-run plan selection assertion failed while the other sixteen tests
  passed because the plan did not serialize planning/execution/repair.
- Second GREEN:
  `buildLongitudinalPlan` now emits all three stage selections and the focused
  test returned `17 passed`.
- Focused gate:
  `pnpm vitest run tests/warehouse-longitudinal-driver.test.ts tests/warehouse-study-assets.test.ts`
  exited `0` with `38 passed`.
- Build gate: `pnpm build` exited `0` and rebuilt all packages, including the
  decomposer policy marker needed by preflight.
- Pilot dry-run:
  `run-warehouse-longitudinal.mjs --mode pilot --target C:\Users\franc\Documents\Proyectos\warehouse-control-tower-seed --manyhands-commit 851e5f80db69ea6631dc3f103e4fc46125283afe --dry-run`
  exited `0` in the isolated clone; that commit is content-equivalent to
  `16a8104d47ff8aceec6bbef992c5aac3125ab7a2` on `main`. W1–W8 used the
  registered seed/verified-chain bases and each serialized
  `codex-cli/gpt-5.5/high` in planning, execution and repair.
- Environment note: the seed repository has foreign Windows ownership. The
  dry-run used a process-local `safe.directory` environment entry; no global
  Git configuration was changed.
- Diff gate: `git diff --check` exited `0`.
- Independent review:
  - Standards: `PASS`, no P0/P1/P2/P3 findings, focused ESLint PASS and all
    twelve smells explicitly evaluated.
  - Spec: `PASS`, all acceptance criteria plus dry-run manifest attribution
    verified; no scope creep.
- No scientific cell was opened and no Claude executor was invoked.
- Next: run the requested `grilling` checkpoint, then select the next
  behavioral ticket; the current route recommends `07`.
