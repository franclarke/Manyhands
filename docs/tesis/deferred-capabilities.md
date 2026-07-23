# Capacidades diferidas y nomenclatura canónica (Gate G1)

> **Gate:** G1 — Congelar alcance · **Commit:** `5355d4b` · **Fecha:** 2026-07-23 (UTC)
> Clasifica explícitamente cada capacidad sensible como **implementada** o
> **diferida**, e identifica los claims de la tesis que deben matizarse o moverse
> a Trabajo Futuro. Resuelve la terminología canónica exigida por el roadmap §7.

Distinción: **[hecho]** observado · **[inferencia]** del auditor · **[decisión]** propuesta · **[pendiente-Francisco]**.

---

## 1. Inventario de capacidades sensibles

| Capacidad | Estado | Evidencia / ausencia | Claims afectados | Acción |
|---|---|---|---|---|
| **SQLite WAL** (índice secundario durable) | **Diferida** (no implementada) | `run-store` no exporta módulo SQLite; `better-sqlite3` no es dependencia productiva; persistencia real = JSONL + snapshots. **[hecho]** | CLAIM-051 · Resumen, Obj. Esp. 5, §3, Fig. arquitectura | `remove`/Trabajo Futuro |
| **Compactación por generaciones** | **Parcial → a diferir salvo integración** | `run-store/src/compactor.ts` existe; integración productiva y test no confirmados. **[hecho]** | CLAIM-052 · Resumen, Obj. Esp. 5 | `downgrade`/`defer` |
| **Durable traces / rotación de traces** | **Diferida** | `trace-store` es diagnóstico en memoria (`InMemoryTraceStore` usado en `execution-pipeline.ts`); rotación sofisticada no requerida por el recorrido. **[hecho]** | Menciones de trazas durables | `defer` |
| **Escritura durable `fsync`** | **Implementada (opcional)** | `jsonl-event-store.ts`/`durable-file.ts`: `fsync` tras flag `durableWritesEnabled()`; rename atómico incondicional. **[hecho]** | CLAIM-050 · §3 (Persistencia) | `clarify` (documentar flag y default) |
| **Hardening exhaustivo de MCP / prompt injection** | **Diferida** | No auditado; fuera del alcance de tesis (roadmap §4.2). | Afirmaciones de seguridad fuerte | `defer` |
| **Aislamiento por contenedores / VM** | **Diferida** | Aislamiento actual = worktrees + scope + env allowlist + supervisión de procesos. **[hecho]** El propio Trabajo Futuro de la tesis ya lo lista. | §6 Trabajo Futuro (ya correcto) | `defer` (mantener en Trabajo Futuro) |
| **Selección adaptativa de modelos** | **Diferida** | No implementada; ya está en §6 Trabajo Futuro de la tesis. **[hecho]** | §6 (correcto) | `defer` |
| **Multiusuario / RBAC / OAuth / SSO** | **Diferida** | Sistema single-user local (CLAIM-080). **[hecho]** | Ninguno en presente (coherente) | `defer` |
| **Cloud deployment / HA / Kubernetes** | **Diferida** | No implementado; sistema self-hosted local. **[hecho]** | Ninguno en presente | `defer` |
| **Escalabilidad masiva (miles de nodos)** | **Diferida** | No evaluada; `maxParallel` es configuración efectiva, no constante. **[hecho: `docs/DECISIONS.md` A10]** | Afirmaciones de escalabilidad | `defer` |
| **Certificación externa de accesibilidad (WCAG 2.2 AA)** | **Diferida** | Atención real a a11y (`aria-*`, `prefers-reduced-motion`, `accessible-dialog.tsx`), sin auditoría/certificación. **[hecho]** | CLAIM-073 · palabras clave/UI | `downgrade` |
| **Inferencia local (privacidad absoluta)** | **Diferida / no aplica** | El control plane es local; la inferencia usa proveedores remotos (Claude/Codex). **[hecho]** | CLAIM-081 · §1.3, Resumen | `clarify` |

**Resumen:** de las capacidades sensibles, **una** se declara implementada con
matiz (`fsync` opcional); el resto se difiere o se matiza. Ninguna capacidad
diferida debe aparecer en presente afirmando que está operativa.

---

## 2. Capacidades **implementadas** que sí sostienen la tesis

Para contraste (detalle y evidencia en `claim-evidence-matrix.md`), estas
capacidades **sí** tienen ruta productiva y tests, y pueden afirmarse (a
demostrar end-to-end en G4):

- Grafo inmutable `GraphRevision` + reducer CAS + relaciones tipadas canónicas
  (CLAIM-010/011).
- Scheduler continuo por readiness + aplazamiento simétrico por conflicto +
  `recordQueue` atómico (CLAIM-020/021/022).
- Sandboxing: worktree pool con leases/fencing, `ScopeChecker` OS-aware,
  supervisión de procesos verificada, allowlist de entorno, `safeGitArgs`
  (CLAIM-030–034).
- Matriz de Evidencias sobre commit exacto + `ValidationContract` (CLAIM-040/041).
- Persistencia JSONL append-only con escritura atómica + recuperación durable
  (CLAIM-050/053).
- Indexación nativa por ripgrep + `RepositorySnapshot` por commit (CLAIM-060/062).
- Cola de decisiones no bloqueante (CLAIM-071).

**Parciales clave (requieren G3/G4):** integración bottom-up (CLAIM-042), delivery
(CLAIM-043), run canónico (CLAIM-044), y sobre todo la **integración productiva del
aporte adaptativo** (CLAIM-001/002).

---

## 3. Nomenclatura canónica

El roadmap §7.3 exige resolver inconsistencias terminológicas. **[decisión
aprobada por Francisco, 2026-07-23 — D-1]:** converger a **una sola generación
definitiva sin sufijos de versión**: se elimina el rótulo "V3" (los paquetes
definitivos se entregan sin sufijo) y se retira el código/rótulo "V2" que la
tesis no requiera. El rename de símbolos `*V2` y el retiro del legacy ocurren en
Etapas 2/3; la corrección del texto de la tesis en Etapa 6.

| Concepto | Término canónico propuesto | Términos a evitar / corregir |
|---|---|---|
| Versión de esquema de eventos/persistencia | `schemaVersion` numérico interno (no marca de producto) | Exponer "V2"/"V3" como nombre de producto o de arquitectura. |
| Generación de producto / arquitectura target | "ManyHands" (generación definitiva, sin sufijo) | "ManyHands V3", "Decomposer V3", "GraphRevision V3", y símbolos `*V2` tras el refactor (ver D-1). |
| Motor de planificación semántica | **Planner / Architect Pass** | Mezclar "Planner" con "Graph Compiler". |
| Compilación del plan a grafo ejecutable | **Graph Compiler** | Atribuirle la *decisión* de granularidad (la toma el Architect Pass + política). |
| Política de granularidad | **política de descomposición adaptativa** | "Decomposer V3" como esquema versionado. |
| Historia canónica del run | **evento de dominio** (event log append-only) | Confundir con snapshot, trace o métrica. |
| Proyección para carga/recuperación | **snapshot** | Tratarlo como "segunda verdad". |
| Telemetría de modelos/procesos | **trace / diagnóstico** | Usarlo para gobernar lifecycle. |
| Datos del experimento de granularidad | **métrica experimental** (`thesis-metrics`, `GEI`) | Confundir métrica experimental con evento de dominio; no debe gobernar lifecycle (roadmap §9). |
| Estados de resultado de nodo | **candidate · verified · stale · failed · delivered** | Colapsar estados o usar sinónimos ad-hoc. |
| Modelo de despliegue | **control plane local** (con inferencia remota) | "inferencia local" / "privacidad absoluta" (ver CLAIM-081). |

**Regla operativa:** en la tesis, cada primera aparición de un término canónico
debe coincidir con el nombre del símbolo productivo cuando exista (p. ej.
`selectReadyWaveV2`, `ExactCandidateValidatorV2`, `WorktreePool`,
`GraphRevision`). Evitar rótulos que no correspondan a un símbolo o `schemaVersion`
real.

---

## 4. Impacto consolidado sobre la tesis

Secciones de `docs/tesis/main.tex` que deben editarse por capacidades diferidas o
matizadas (detalle y decisión en `claim-evidence-matrix.md`):

1. **Resumen:** quitar "SQLite WAL" y "compactación por generaciones" del párrafo
   de persistencia; matizar "demostrando las ventajas" (resultados aún no
   reconstruibles); precisar "control plane local".
2. **Objetivo Específico 5:** remover SQLite WAL y compactación (o Trabajo
   Futuro); mantener event store append-only con escritura atómica.
3. **§1.3 (Privacidad):** distinguir control plane local de inferencia remota.
4. **§3 (Persistencia) y Fig. `fig:arquitectura-general`:** quitar el bloque
   "SQLite WAL" de la figura; describir JSONL + snapshots.
5. **§4.1 Fig. `fig:monorepo-map`:** completar con paquetes reales omitidos
   (`run-coordinator`, `repository-index`, `conflict-risk`, `trace-store`,
   `orchestrator-graph`).
6. **§5.2–5.4 (casos y resultados):** rotular como ilustrativos o regenerar
   (D-4).
7. **Título / Obj. Esp. 1–2 / §3 Pilar 1 / §5.3:** resolver "V3" (D-1).
8. **Palabras clave / UI:** "WCAG 2.2 AA" → "diseñado según pautas WCAG 2.2 AA,
   sin auditoría de conformidad externa".
9. **§6 Trabajo Futuro:** ya lista correctamente selección adaptativa de modelos,
   contenedores/VM y multiusuario; **agregar** SQLite WAL, compactación durable y
   certificación de accesibilidad si se difieren.

---

## 5. Referencias

- Plan rector: [`../THESIS_COMPLETION_ROADMAP.md`](../THESIS_COMPLETION_ROADMAP.md)
- Matriz claim–evidencia: [`claim-evidence-matrix.md`](claim-evidence-matrix.md)
- Preguntas de investigación y decisiones D-1..D-5: [`research-questions.md`](research-questions.md)
- Baseline: [`evidence/baselines/stage-1-baseline.md`](evidence/baselines/stage-1-baseline.md)
