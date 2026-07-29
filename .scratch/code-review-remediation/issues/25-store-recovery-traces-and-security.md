# 25 — Completar recovery, trazas, grounding y frontera de seguridad

**What to build:** snapshots/recovery/compaction y trazas durables están en la ruta productiva; grounding y scope rechazan imports pobres, secretos y escapes de symlink.

**Blocked by:** 24.

**Status:** closed

- [ ] Host carga/reconstruye desde snapshot+journal y compacta con lock renovable.
- [ ] Trazas JSONL sobreviven restart con checksum y redacción.
- [ ] Grounding grande degrada explícitamente y no inventa cobertura.
- [ ] Forbidden paths, secretos y symlinks tienen regresiones productivas.
- [ ] CLAIM-053 se reevalúa conservadoramente con evidencia de los tickets 21, 23, 24 y 25.
- [ ] Gates y reviews Standards/Spec pasan.

## Closure evidence - 2026-07-29

- [x] `tests/store-recovery-traces-security.test.ts`: 4/4; compacted generation + active journal + torn-tail recovery, renewable lock, trace restart/redaction, and bounded grounding partial disposition.
- [x] Existing productive regressions cover forbidden-path deny-wins, path traversal, symlink escape, and executor environment secret allowlisting.
- [x] `@manyhands/run-store` typecheck/build PASS; `@manyhands/trace-store` typecheck/build PASS; `@manyhands/repository-index` typecheck/build PASS.
- [x] `git diff --check` reports no whitespace errors.
- [x] CLAIM-053 remains conservative: ticket 25 closes durable store/trace/grounding/security evidence, while historical Warehouse coverage is not reinterpreted as complete.
