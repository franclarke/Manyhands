# Documentation Restructure — Design Spec

**Date:** 2026-06-02  
**Author:** Claude Code + Francisco Clarke  
**Status:** Approved

---

## Objetivo

Limpiar y reestructurar toda la documentación del proyecto (CLAUDE.md, AGENTS.md, README.md, docs/) bajo dos principios:

1. **Documentación de tesis**: narrativa humana, storytelling, para el tribunal.
2. **Documentación de agentes**: LLM-first, directiva, mínimo ruido.

---

## 1. Eliminaciones en docs/

Estos archivos se eliminan porque describen un estado que ya no existe (era mock-only, pre-execution-core, pre-Gemini) y su contenido útil está capturado en los ADRs o en docs más actualizados.

| Archivo | Razón |
|---------|-------|
| `docs/PROGRESS-REPORT-2025-05-28.md` | Snapshot histórico de mayo 2025, superseded por CLAUDE.md |
| `docs/manyhands-knowledge-base.md` | Archivo vacío/redirect sin contenido real |
| `docs/research/README.md` | Placeholder vacío — eliminar también el directorio `docs/research/` |
| `docs/development/mock-planning-flow.md` | Era mock-only, superseded |
| `docs/development/mock-worktree-runner.md` | Era mock-only, superseded |
| `docs/development/mock-execution-flow.md` | Era mock-only, superseded |
| `docs/development/benchmark-runner-mock.md` | Era mock-only |
| `docs/development/benchmark-report.md` | Era mock-only |
| `docs/development/evaluation-report.md` | Era mock-only |
| `docs/development/evaluator-v0.md` | Era mock-only |
| `docs/development/granularity-comparison.md` | Era mock-only |
| `docs/development/benchmark-dataset-v0.md` | Superseded por ADR-0010 y fixtures reales |
| `docs/development/benchmark-configurations.md` | Superseded por ADR-0026 |
| `docs/development/conflict-benchmark-v0.md` | Superseded por ADRs |
| `docs/development/controlled-conflict-scenarios.md` | Superseded por ADR-0011 |
| `docs/development/human-gated-mock.md` | Era mock-only |
| `docs/development/run-snapshots.md` | Superseded por schema y run-store package |
| `docs/development/persistent-trace-store.md` | Superseded por trace-store package |
| `docs/development/run-export-import.md` | Superseded por run-store package |
| `docs/development/decomposer.md` | Superseded por design/decomposer-composer-redesign.md |
| `docs/development/scope-validation.md` | Superseded por execution-core ScopeChecker |
| `docs/development/repository-index.md` | Deferred package, no relevante ahora |
| `docs/development/static-conflict-signals.md` | Deferred package |
| `docs/development/enhanced-conflict-risk.md` | Deferred package |
| `docs/development/roadmap.md` | Fases 9-30 ya completadas o superadas, genera confusión |
| `docs/development/web-app-roadmap.md` | Superseded por estado actual en CLAUDE.md |
| `docs/development/frontend-implementation-handoff.md` | Handoff temporal, ya no aplica |

---

## 2. Documentos que se conservan (algunos actualizados)

| Archivo | Acción |
|---------|--------|
| `docs/adr/0001–0028` | **KEEP ALL** — registro histórico inmutable. Solo agregar ADR-0029 (supersede 0019 Codex→Gemini). |
| `docs/design/decomposer-composer-redesign.md` | **KEEP AS-IS** — excelente, actualizado, es el doc de diseño central de los artifacts de tesis |
| `docs/development/architecture.md` | **REWRITE** — el actual describe estado pre-execution-core con "Codex" y cosas "missing" que ya existen |
| `docs/development/thesis-plan.md` | **UPDATE** — actualizar el estado de cada Stage (1=done, 2=done, 3=done, 4=in progress, 5=future) |
| `docs/development/ui-vision.md` | **KEEP** — dirección visual todavía vigente |
| `docs/development/product-vision.md` | **UPDATE** — eliminar frases como "near-term Build Mode will still use mock execution" (ya no aplica) |

---

## 3. Documentos nuevos

### 3.1 `docs/thesis/project-evolution.md`

**Audiencia:** Francisco + tribunal de tesis.  
**Tono:** Lenguaje natural con tecnicismos. Narrativa de primera persona del proyecto.  
**Propósito:** Servir como fuente para el capítulo de "diseño del sistema" y "evolución arquitectónica" de la tesis.

Estructura:
```
1. El origen: lab de benchmarks mock-only (por qué empezó así)
2. Pivote a producto visual: la web app y el DAG canvas
3. Execution Core: de simulación a worktrees reales
4. Los dos artifacts de tesis
   4a. Decomposer recursivo interface-aware (por qué recursivo, qué es sharedInterface)
   4b. Composer contract-aware (por qué semántico, cómo resuelve conflictos)
5. Migración Codex → Gemini CLI (por qué, qué cambió)
6. Estado actual: lo implementado y lo que falta (evidencia empírica)
7. Arquitectura resultante: diagram + explicación
```

### 3.2 `docs/DECISIONS.md`

**Audiencia:** Agentes LLM (CLAUDE.md y AGENTS.md apuntarán a este archivo).  
**Tono:** LLM-first — directivo, escaneable, sin narrativa.  
**Propósito:** Síntesis de los 28 ADRs + decisiones D1-D10 en un solo doc de referencia. Evitar que un agente tenga que leer 28 archivos para saber qué decisiones están cerradas.

Estructura (por dominio):
```
## Executor
## Git y fuente de verdad
## Scope y aislamiento
## Integración (cherry-pick)
## Decomposer
## Scheduling
## Modelo de datos
## Lo que está DEFER/DEPRECATED
```

Cada entrada: **Decisión** (1 línea), **Por qué** (2-3 líneas), **No hacer** (lista corta).

### 3.3 `docs/adr/0029-gemini-cli-executor.md`

**Propósito:** Supersede ADR-0019 (Codex CLI) formalmente.  
**Contenido:** La migración a Gemini CLI headless (`gemini -p`, stdin), `--approval-mode yolo` para ejecución y `--approval-mode plan` para el decomposer, `MANYHANDS_GEMINI_BIN`, y las diferencias respecto al diseño Codex.

---

## 4. CLAUDE.md reformado

**Target:** ~120 líneas (actualmente ~290).  
**Principio:** Solo lo que NO se puede derivar leyendo el código.

### Eliminar de CLAUDE.md:
- Tablas de 14 Zod schemas (están en `packages/execution-core/src/types.ts`)
- Jerarquía de errores (está en `packages/execution-core/src/errors.ts`)
- Lista de 16 trace events (está en `packages/trace-store/src/index.ts`)
- Campos `AgentTaskContract` V2 (están en `packages/contracts/src/index.ts`)
- Definición inline de `GranularityVector` interface (está en el código)
- Sección "Próxima Sesión: Evidencia empírica" (es task management, no project docs)
- Detalle exhaustivo de "Fases completadas" (narrativa histórica, no guía operacional)
- Detalle de Benchmark Fixtures (lo que hace cada endpoint, etc.)

### Conservar en CLAUDE.md:
- Identidad del proyecto (3-4 líneas)
- Banderas ⚠️ de estado real (stale migration, sin evidencia, calculator artifact)
- Decisiones cerradas D1-D10 (tabla — estas SÍ deben estar aquí, no derivables del código)
- Tabla de packages con estado (KEEP/DEFER/DEPRECATED)
- Archivos clave con descripciones (navegación)
- Reglas para Claude (1-10)
- Comandos de verificación rápida

### Agregar a CLAUDE.md:
- Puntero a `docs/DECISIONS.md` para contexto histórico de decisiones
- Puntero a `docs/thesis/project-evolution.md` para narrativa del proyecto
- Puntero a `docs/design/decomposer-composer-redesign.md` para los artifacts de tesis
- Actualizar banderas ⚠️ con estado real de junio 2026

---

## 5. AGENTS.md diferenciado

**Audiencia:** Codex, Cursor, y cualquier herramienta de AI coding que trabaje en el repo de ManyHands.  
**Target:** ~90 líneas.  
**Principio:** Completamente diferente a CLAUDE.md. Un agente de Codex llega en modo one-shot: necesita orientarse rápido, saber qué no romper, y entender los límites del sistema.

### Estructura de AGENTS.md:
```
## Qué es este repositorio
## Invariantes del sistema (lo que nunca se cambia sin discutir)
## Límites de packages (no cruzar dependencias hacia arriba)
## Reglas operacionales
## Comandos de verificación (tests, typecheck, build)
## Archivos clave por dominio
## Documentación de referencia
```

### Diferencias vs CLAUDE.md:
- Sin instrucciones de idioma (AGENTS.md lo puede leer cualquier herramienta)
- Sin preferencias personales de Francisco
- Sin contenido temporal ("próxima sesión", "banderas de estado")
- Las decisiones D1-D10 se expresan como **invariantes del sistema** (tono técnico, no colaborativo)
- Sin historia del proyecto (apunta a docs/thesis/ si hace falta)
- Más corto y directo

---

## 6. README.md — actualizaciones menores

El README está mayormente bien. Cambios necesarios:
- Actualizar el conteo de tests (455 passing, no mencionar número viejo)
- Eliminar referencias a "Codex CLI" en la descripción de stack
- Actualizar "Estado actual" para reflejar que execution core está implementado
- Quitar de la lista de "Alcance y límites" las frases que implican que la ejecución real no existe

---

## 7. Nueva estructura de docs/

```
docs/
  adr/                                # KEEP — 28 ADRs + nuevo 0029
  design/
    decomposer-composer-redesign.md   # KEEP — central
  thesis/                             # NEW DIR
    project-evolution.md              # NEW
  DECISIONS.md                        # NEW
  development/
    architecture.md                   # REWRITE
    thesis-plan.md                    # UPDATE
    ui-vision.md                      # KEEP
    product-vision.md                 # UPDATE
```

Total docs/development/ pasa de ~27 archivos a 4.

---

## 8. Orden de implementación

1. Crear `docs/DECISIONS.md` (base para los demás)
2. Crear `docs/thesis/project-evolution.md`
3. Crear `docs/adr/0029-gemini-cli-executor.md`
4. Reescribir `docs/development/architecture.md`
5. Actualizar `docs/development/thesis-plan.md`
6. Actualizar `docs/development/product-vision.md`
7. Reformar `CLAUDE.md`
8. Crear `AGENTS.md` diferenciado
9. Actualizar `README.md`
10. Eliminar los ~26 docs stale
