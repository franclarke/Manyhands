# Original User Request

## 2026-07-22T16:54:54Z

# NORMALIZACIÓN DEL PLAN E INICIO CONTROLADO DE IMPLEMENTACIÓN — MANYHANDS

Actúa como **Principal Engineer, Release Manager y Orquestador Técnico de ManyHands**.

Working directory: c:\Users\franc\Documents\Proyectos\Manyhands
Integrity mode: development

---

# FASE A — CONSTRUIR UNA FUENTE ÚNICA DE VERDAD Y CONSISTENCY GATE
1. Reconciliar todos los artefactos de `docs/audits/production-readiness/planning/` convirtiendo `remediation-backlog.json` en la ÚNICA fuente canónica de verdad.
2. Corregir colisiones de IDs (`MH-REM-*`), diferencias en olas, tareas duplicadas, y estados de ADRs (`APPROVED`, `PROPOSED`, `REJECTED`, `DEFERRED`, `SUPERSEDED`).
3. Generar `remediation-id-migration.json` mapeando referencias antiguas a IDs canónicos únicos.
4. Recalcular el DAG de dependencias, las Olas (Ola 0 a Ola 8) y los Release Gates.
5. Crear y ejecutar el script `scripts/validate-remediation-plan.ts` que valide:
   - Unique IDs: PASS
   - References: PASS
   - Dependency DAG: PASS
   - Findings mapping: PASS
   - Wave mapping: PASS
   - Gate mapping: PASS
   - ADR status: PASS
   Resultado requerido: `PLANNING CONSISTENCY GATE: PASS`.

---

# FASE B — IMPLEMENTACIÓN DE LA OLA 0 (SÓLO SI CONSISTENCY GATE = PASS)
1. **MH-REM-001 (GroundingAgent Dirty Workspace Check)**: En `packages/execution-core/src/run/grounding-agent.ts`, comprobar `git status --porcelain` antes de escribir. Abortar si hay cambios no commiteados. Agregar tests en `grounding-agent-dirty-workspace.test.ts`.
2. **MH-REM-002 (Lock Ownership Fencing)**: En `packages/run-store/src/jsonl-event-store.ts`, agregar token único por adquisición (`pid`, `acquiredAt`, `token`). Liberar lock únicamente si el token coincide. Agregar tests en `run-store-lock-ownership-fencing.test.ts`.
3. **MH-REM-003 (Baseline UI Tests)**: Diagnosticar y corregir los 2 tests fallidos de la suite baseline con cambios mínimos y focalizados.

---

# VERIFICACIÓN FINAL
Ejecutar `pnpm test`, `pnpm typecheck` y `pnpm build` para asegurar 0 regresiones.

---

## Acceptance Criteria
- [ ] Script `scripts/validate-remediation-plan.ts` pasa con `PLANNING CONSISTENCY GATE: PASS`.
- [ ] `remediation-backlog.json` y `remediation-id-migration.json` guardados y 100% consistentes.
- [ ] Tarea MH-REM-001 implementada y testeada en verde.
- [ ] Tarea MH-REM-002 implementada y testeada en verde.
- [ ] Baseline de pruebas reparado y verde (`pnpm test` pasa sin fallos).
