# 26 — Cerrar seams de política, configuración y reproducibilidad

**What to build:** la configuración efectiva y las señales de política usadas en ejecución coinciden con lo documentado y quedan persistidas; no existen módulos contractuales aislados que permitan sobreafirmar corrección.

**Blocked by:** 25.

**Status:** ready-for-agent

- [ ] `maxLeafPlannedPaths` y demás knobs efectivos llegan al planner y al manifest.
- [ ] `validationDuplication` se deriva de duplicación real sin cambiar fórmula/umbral antes de medir.
- [ ] Un inventario prueba qué módulos target están conectados o declara transición explícita.
- [ ] Gate completo, mutación autenticada y reviews Standards/Spec pasan.
- [ ] HANDOFF desbloquea ticket 11 sólo después de este cierre.
