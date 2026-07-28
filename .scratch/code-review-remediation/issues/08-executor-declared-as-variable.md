# 08 — El executor es una variable declarada

**What to build:** el executor deja de ser un parametro libre de linea de comandos sin declaracion. Dos celdas del mismo barrido corrieron con executors distintos y resultados materialmente distintos sobre el mismo estimulo congelado.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] El protocolo lo declara como variable controlada del barrido.
- [x] Queda escrito que celdas con executors distintos no son comparables entre si.
- [x] El manifiesto de cada serie registra el executor con el que se congelo.

## Closure evidence

- Base commit: `da2a91c047458ca99f3c0a47bfcb808dcc986d71`.
- Implementation commits on `main`:
  - `c9aab46fe15d7744a08ec2939307d30f2a2830e9`
  - `91973d756321e4b4e5cdedd67e5734d7306686bd`
  - `fd2bb28cf1deb7f8a1c29ed448ccc47e7f7e60b4`
  - `0babbe41166478460de7709ce8b853d7120bf709`
  - `f366c2043ab7f9fd98e498ba6a95bb018b0119b0`
- Controlled variable: every new series manifest records the exact
  `executorId`, `model` and applicable `effort`; every cell repeats that
  selection in planning, execution and repair.
- Comparability preflight: generation and `run-g5.mjs` both reject a cell that
  differs from the manifest before output, baseline restoration or execution.
- Availability preflight: Codex is the only executor currently installed and
  authorized. New generation and the productive driver reject any unavailable
  selection before invoking it.
- Historical attribution: pilot and retry-2 through retry-5 record
  `codex-cli/gpt-5.5/high`; retry-6 and retry-7 retain their actual historical
  `claude-code-cli/sonnet` attribution. Those historical cells and results were
  not rewritten. Retry-7 was never executed and is now rejected by preflight;
  a successor series must be frozen on Codex.
- TDD RED/GREEN:
  - missing manifest attribution: RED (`executorSelection` was undefined),
    then GREEN (`9/9`);
  - missing homogeneity guard: RED (export absent), then GREEN (`10/10`);
  - seven manifests without attribution: RED at pilot, then GREEN (`11/11`);
  - productive heterogeneous series: RED because `run-g5` exited `0` with
    `0 of 2 cells`, then GREEN (`12/12`);
  - unavailable executor generation: RED because Claude generation succeeded,
    then GREEN with Codex-only registry (`13/13`);
  - productive homogeneous unavailable series: RED because `run-g5` exited
    `0` with `0 of 1 cells`, then GREEN (`14/14`).
- Focused gate:
  `pnpm vitest run tests/wide-graph-study.test.ts tests/wide-graph-oracle.test.ts tests/wide-graph-oracle-plan.test.ts tests/wide-graph-oracle-checkout.test.ts tests/warehouse-study-assets.test.ts`
  exited `0` with `46 passed` across five files in the isolated Node
  `22.23.1` / pnpm `7.29.3` workspace.
- Codex dry-run:
  `node docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs --target C:\Users\franc\Documents\Proyectos\warehouse-control-tower-pilot-12 --executor codex --out C:\Users\franc_rgy\.codex\tmp\manyhands-ticket08-codex-dryrun --dry-run`
  exited `0`; N=4, N=8 and N=16 each declared
  `codex-cli/gpt-5.5/high` in all three stages.
- Original finding replay:
  `run-g5.mjs` against the real retry-7 cells with `--only no-such-cell`
  exited `1` because its frozen executor is unavailable, without invoking
  Claude or creating a run output.
- Legacy compatibility: the original G5 manifest, which has no
  `executorSelection`, still completed a no-cell preflight with exit `0`.
- Diff gate: `git diff --check` exited `0`.
- P0 baseline remains PASS in the isolated clone on the pre-ticket lineage; no
  scientific cell was opened.
- Independent review:
  - Standards: final `PASS`, no P0/P1/P2/P3 findings and all twelve smells
    explicitly reevaluated.
  - Spec: final `PASS`, all three acceptance criteria, Codex-only enforcement
    and historical preservation verified independently.
- Product defects found during review:
  - P1: homogeneity was initially checked only at generation, not by the
    productive driver. Root cause fixed with a driver-level regression.
  - P1: availability was initially checked only at generation, so a homogeneous
    historical Claude freeze could reach the driver. Root cause fixed with a
    productive availability regression.
  - P2: one HANDOFF sentence still pointed H2 at retry-7. It now points only to
    the versioned Codex successor.
- Next critical-path ticket after closure: `06`.
