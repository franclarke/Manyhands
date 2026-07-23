# PROMPT 1/4 — REMEDIACIÓN CANÓNICA DE PERSISTENCIA Y OLAS DE PRODUCTO (WAVES 2–8)

Copiar y ejecutar en el **Agente 1 (Codex en modo `/goal`)**.

---

```markdown
# AGENTE 1: INSTRUCCIÓN /GOAL — PERSISTENCIA, DURABILIDAD Y OLAS CANÓNICAS (WAVES 2–8)

Actúa como **Principal Storage Engineer y Systems Specialist** responsable de implementar y cerrar las olas de persistencia, durabilidad y recuperabilidad de ManyHands.

---

## 1. ALCANCE Y LÍMITES DE RESPONSABILIDAD (EXCLUSIVO)

Tus modificaciones están **estrictamente limitadas** a los siguientes paquetes y archivos:
- `packages/run-store/*`
- `packages/trace-store/*`
- `docs/audits/production-readiness/planning/remediation-backlog.json`

**PROHIBIDO MODIFICAR**: `apps/web/*`, `packages/decomposer/*`, `packages/repository-index/*`. (Estos archivos están siendo trabajados en paralelo por otros agentes).

---

## 2. TAREAS A IMPLEMENTAR (EPIC 3: WAVE 2 Y SIGUIENTES)

1. **MH-REM-014 — Lock Ownership Fencing**: Verificar y confirmar el cercado de leases de lock con tokens únicos de propiedad (`acquireDurableLock`).
2. **MH-REM-015 — fsync Flushes & Jittered Delay in Atomic Writes**: Implementar primitiva de reemplazo atómico de archivos con `fsync` y retry exponencial con jitter en `packages/run-store`.
3. **MH-REM-016 — JsonlAttemptStore update() State Transition**: Implementar transiciones de estado de intentos seguras y concurrent-safe.
4. **MH-REM-017 — Event Store Compaction & Snapshot Truncation**: Diseñar compactación crash-safe por generaciones (`compactor.ts`).
5. **MH-REM-018 — High-Throughput Stream Writer for Event Store**: Writer append-only $O(1)$ sin reescrituras completas de historial.
6. **MH-REM-019 — Durable JsonlTraceStore Telemetry Persistence**: Persistencia de trazas diagnósticas redactando secretos y credenciales en `packages/trace-store`.
7. **MH-REM-020 — Persistence Crash Recovery & Integrity Verifier**: Verificador e inspector de integridad ante cortes de energía (`recovery.ts`).

---

## 3. METODOLOGÍA DE VERIFICACIÓN

Tras cada tarea:
1. Actualiza `docs/audits/production-readiness/planning/remediation-backlog.json` fijando `"status": "COMPLETE"`.
2. Ejecuta:
   ```bash
   node scripts/validate-remediation-plan.mjs
   npx vitest run tests/run-store-lock-ownership-fencing.test.ts tests/atomic-write-fsync.test.ts tests/attempt-store-transitions.test.ts tests/run-store-append.test.ts tests/run-store-compaction.test.ts tests/run-store-recovery.test.ts tests/trace-store-durability.test.ts
   pnpm -r --filter "@manyhands/run-store" --filter "@manyhands/trace-store" typecheck
   pnpm --filter "@manyhands/run-store" build
   ```
```
