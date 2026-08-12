# @manyhands/trace-store

Persistencia de trazas diagnósticas: prompts referenciados, logs, timings,
eventos de provider y procesos.

Las trazas no deciden lifecycle, readiness, adoption ni success. El event journal
de `run-store` conserva hechos de dominio. Todo dato sensible se redacta antes de
persistir.

Fuente normativa: [observabilidad y autoridad](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#917-observability-and-cost-accounting).
