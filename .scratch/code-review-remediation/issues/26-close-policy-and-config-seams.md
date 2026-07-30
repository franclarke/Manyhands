# 26 - Cerrar seams de policy, configuracion y reproducibilidad

**What to build:** la configuracion efectiva y las senales de policy usadas en ejecucion coinciden con lo documentado y quedan persistidas; no existen modulos contractuales aislados que permitan sobreafirmar correccion.

**Blocked by:** 25.

**Status:** closed

## Reopened after independent review - 2026-07-29

The first closure attempt was reopened after independent review found that the
productive planning host omitted `maxLeafPlannedPaths`, the lock heartbeat
silenced ownership loss, and the acceptance checklist was stale. The effective
policy must also reach the final manifest when the complete policy is available.

- [x] `maxLeafPlannedPaths` is validated by the effective utility policy and reaches leaf feasibility.
- [x] `maxLeafPlannedPaths` and the effective policy reach the planning event, execution input, and optional final manifest field.
- [x] `validationDuplication` is derived from real repeated acceptance-intent assignments without changing its formula or threshold.
- [x] Module connectivity and the explicit legacy transition are recorded in `docs/tesis/ticket-26-policy-config-inventory.md`.
- [x] RED to GREEN regression: `tests/run-granularity-strategy-selected.test.ts` round-trips the planned-path ceiling.
- [x] `planning-host.ts` persists `maxLeafPlannedPaths` in the effective strategy event.
- [x] Durable lock writes re-check ownership at the write boundary; heartbeat renewal errors are retained and surfaced instead of silently discarded.
- [x] Focused suite: 13/13 PASS; package/web typechecks and package builds PASS.
- [x] Final focused gate and Standards/Spec re-review pass on the current fixed point.
- [x] HANDOFF unlocks ticket 11 after this closure.
