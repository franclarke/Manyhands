# @manyhands/run-store

Persistencia durable del event journal, snapshots rebuildables y registros
inmutables de attempts/artifacts.

El journal sigue siendo canónico. El rediseño mueve la autoridad de escritura a
un run actor dentro del daemon y simplifica fencing/RunRecord sólo después de
probar single-writer y crash recovery. `trace-store` conserva diagnóstico y no
gobierna lifecycle.

Fuente normativa: [persistencia y Stage 11](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#913-persistence-and-crash-recovery).
