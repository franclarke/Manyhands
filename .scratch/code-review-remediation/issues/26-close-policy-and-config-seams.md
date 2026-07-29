# 26 — Cerrar seams de política, configuración y reproducibilidad

**What to build:** la configuración efectiva y las señales de política usadas en ejecución coinciden con lo documentado y quedan persistidas; no existen módulos contractuales aislados que permitan sobreafirmar corrección.

**Blocked by:** 25.

**Status:** closed

## Closure evidence - 2026-07-29

- [x] `maxLeafPlannedPaths` is validated by the effective utility policy, reaches leaf feasibility, and is persisted in the strategy event/reducer while legacy journals remain readable.
- [x] `validationDuplication` is derived from real repeated acceptance-intent assignments; no formula or threshold was changed in this ticket.
- [x] Module connectivity and explicit transition boundaries are recorded in `docs/tesis/ticket-26-policy-config-inventory.md`.
- [x] RED→GREEN regression: `tests/run-granularity-strategy-selected.test.ts` now round-trips the effective planned-path ceiling.
- [x] Existing granularity policy condition and utility tests remain the gate for A/B/C and duplication behavior.

- [ ] `maxLeafPlannedPaths` y demás knobs efectivos llegan al planner y al manifest.
- [ ] `validationDuplication` se deriva de duplicación real sin cambiar fórmula/umbral antes de medir.
- [ ] Un inventario prueba qué módulos target están conectados o declara transición explícita.
- [ ] Gate completo, mutación autenticada y reviews Standards/Spec pasan.
- [ ] HANDOFF desbloquea ticket 11 sólo después de este cierre.
