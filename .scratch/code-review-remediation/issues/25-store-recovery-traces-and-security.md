# 25 - Completar recovery, trazas, grounding y frontera de seguridad

**What to build:** snapshots/recovery/compaction y trazas durables estan en la ruta productiva; grounding y scope rechazan imports pobres, secretos y escapes de symlink.

**Blocked by:** 24.

**Status:** closed

## Reopened remediation evidence - 2026-07-29

La primera tentativa de cierre fue reabierta por una review independiente que
encontro que los primitives no estaban cableados a la ruta productiva. Esa
evidencia se conserva; no se interpreta como PASS.

- [x] Host V2 carga/reconstruye desde snapshot+journal y compacta con lock renovable; recovery tambien revalida ownership antes de reportar exito.
- [x] Trazas JSONL sobreviven restart con checksum, redaccion de secretos y reparacion de cola incompleta.
- [x] Grounding grande degrada explicitamente y diagnostica truncamiento de files, symbols/imports/exports sin inventar cobertura.
- [x] Forbidden paths, secretos y symlinks tienen regresiones productivas; los callers pasan el worktree root real.
- [x] CLAIM-053 queda reevaluado conservadoramente: el mecanismo durable esta conectado, pero la demostracion cientifica externa sigue pendiente.
- [x] Focused suite: `tests/store-recovery-traces-security.test.ts` 8/8 PASS; regresiones adyacentes 15/15 PASS.
- [x] Package typechecks/builds de run-store, trace-store, repository-index, execution-core y web PASS; `pnpm build` y `pnpm web:build` PASS en el fixed point actual.
- [x] Standards/Spec re-review final PASS sin findings P0-P3.

## Preserved previous closure attempt

- Independent review found the first closure premature: productive V2 hosts did
  not invoke recovery/compaction, execution traces were in-memory, lock renewal
  was not automatic, generic embedded token/secret values were not redacted,
  and symbol budgets could be silently truncated.
