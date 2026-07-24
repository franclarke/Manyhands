# Aporte central y preguntas de investigación (Gate G1)

> **Gate:** G1 — Congelar alcance · **Commit:** `5355d4b` · **Fecha:** 2026-07-23 (UTC)
> Este documento fija una **única formulación prudente** del aporte y define
> preguntas de investigación **operables** con las métricas que ManyHands puede
> recolectar realmente. No inventa resultados, valores ni significancia.

Distinción usada: **[hecho]** observado · **[inferencia]** del auditor · **[decisión]** propuesta · **[pendiente-Francisco]** requiere aprobación.

---

## 1. Formulación única del aporte central

**Problema.** Delegar un objetivo de software de mediana escala a un único
agente LLM sobre un repositorio real produce saturación de contexto y *scope
creep*; la mitigación intuitiva —dividir el objetivo— reintroduce el problema en
forma de **paradoja de granularidad**: la sub-división (hoja demasiado compleja)
reproduce la saturación, y la sobre-división (hojas triviales) dispara latencia,
costo de tokens y fricción de contratos e integración. **[hecho: `docs/tesis/main.tex` §1.2]**

**Aporte propuesto (formulación canónica).** ManyHands es una **plataforma local
y single-user de orquestación de agentes de código** cuyo aporte central es una
**política de descomposición adaptativa de granularidad** que:

1. estima una **complejidad intrínseca por tarea** (`C_task`) a partir de señales
   de repositorio (radio de alcance, impacto de interfaz, superficie de
   validación, masa de contexto);
2. decide, mediante un umbral y críticos de coalescencia/re-división, si una
   tarea se ejecuta como **hoja cohesiva** o se **descompone** en un número
   acotado de sub-unidades;
3. entrega esa propuesta a un **Graph Compiler determinista** que produce el
   `WorkUnit`/`GraphRevision` canónico con relaciones tipadas, contratos y
   obligaciones de validación;
4. ejecuta cada unidad en aislamiento (worktrees fenced), valida sobre el commit
   exacto (Matriz de Evidencias) e integra bottom-up hasta entregar un árbol
   verificado.

**Frontera de responsabilidades (canónica).** **[hecho: `docs/DECISIONS.md` A4; `planning-host.ts`]**

```
Architect Pass (semántico, LLM)   → propone descomposición y estima C_task
   ↓                                 [decisión de granularidad vive AQUÍ]
Política adaptativa (determinista) → umbral + críticos coalescencia/re-split
   ↓
Graph Compiler (determinista)     → compila WorkUnit/GraphRevision canónico,
                                     relaciones, scopes, contratos, validación
   ↓
Críticos de plan + aprobación     → completitud, atomicidad, DAG, riesgo
```

El **Graph Compiler no decide granularidad**: materializa la decisión ya tomada
por el Architect Pass + política adaptativa en el grafo ejecutable. La única
representación canónica de nodos y relaciones es la del Graph Compiler; no debe
existir un `GraphRevisionV3` paralelo. **[hecho/decisión: `docs/DECISIONS.md` A5; roadmap §9]**

**Alcance de la evaluación (prudente).** La evaluación es **exploratoria**, no un
benchmark universal: un conjunto acotado de tareas, en repositorios controlados,
con un proveedor LLM y una configuración fija. Busca *señales de trade-off*, no
significancia estadística ni generalización. **[decisión — coherente con roadmap §11]**

**Estado de implementación del aporte (honesto).** A `5355d4b`, la política
adaptativa (`C_task`, Architect Pass, críticos, Graph Compiler V3) existe como
**módulo con test unitario de comportamiento**, pero **no participa del pipeline
productivo**, que hoy usa el `Recursive Decomposer` + `Graph Compiler` (V2). Por
tanto el aporte está **diseñado e implementado a nivel de componente, pero aún
no integrado end-to-end**. Cerrar esa brecha es la Etapa 3 (gate G3). **[hecho — ver `claim-evidence-matrix.md` CLAIM-001/002]**

---

## 2. Preguntas de investigación

Las RQ se alinean con el roadmap §11 y se limitan a lo que ManyHands puede
medir. Cada una declara: condiciones, métricas, evidencia de origen y
precondición de implementación.

### RQ1 — Entrega verificada según granularidad

> ¿Cómo varía la **tasa de entrega verificada** de un objetivo entre (A) hoja
> única forzada, (B) sobre-división fija forzada y (C) política adaptativa de
> ManyHands, manteniendo constantes repositorio, objetivo, modelo y presupuesto?

- **Condiciones:** A (prohibir descomponer) · B (regla fija fina documentada) ·
  C (política adaptativa productiva). **[roadmap §11]**
- **Métrica primaria:** entrega verificada (`FinalArtifactManifest` válido con
  `EvidenceMatrix.outcome = verified` y `finalSha ≠ baseSha`).
- **Evidencia de origen:** journal de eventos, matriz de evidencias, SHAs.
- **Precondición:** requiere G3 (política productiva) y G4 (run canónico). Las
  condiciones A/B requieren *modos de granularidad forzada* controlables —
  existe base (`DecompositionMode` con `coarse`/`fine`/`auto` en el decomposer),
  pero debe conectarse de forma reproducible. **[hecho parcial]**

### RQ2 — Trade-off éxito / costo / tiempo / coordinación

> ¿Qué **trade-off** existe entre éxito, duración wall-clock, tokens/costo y
> overhead de coordinación entre las tres condiciones?

- **Métricas primarias:** duración wall-clock; tokens y costo por corrida;
  número de attempts y retries; decisiones humanas requeridas.
- **Métricas estructurales:** profundidad del grafo, cantidad de hojas,
  branching factor, unidades coalesced, tamaño de contexto.
- **Métrica secundaria:** `GEI` (Granularity Efficiency Index) **acompañado
  siempre de sus componentes**; se versiona su fórmula, unidades y el tratamiento
  del denominador cero. No es la única base de comparación. **[decisión — roadmap §11]**
- **Evidencia de origen:** telemetría de attempts, colector `ThesisMetricsCollector`
  (`packages/decomposer/src/granularity/thesis-metrics.ts`), journals.
- **Precondición:** G3 debe persistir por nodo `C_task`, dimensiones, pesos,
  versión de fórmula, decisión leaf/composite y branching. Hoy no se persiste. **[hecho — CLAIM-002]**

### RQ3 — Modos de falla por configuración

> ¿Qué **tipos de falla, retry, resultado `stale` o conflicto** aparecen en cada
> configuración?

- **Métricas:** clasificación de fallos (transitorio, entorno, código/test,
  contrato, dependencia no declarada, scope, integración); resultados `stale`;
  conflictos evitados vs. materializados; iteraciones de reparación.
- **Evidencia de origen:** `failure-classified`, `decision.*`, política de
  recuperación (`packages/run-coordinator/src/recovery-policy.ts`,
  `docs/DECISIONS.md` A11), aplazamiento por `ConflictConstraint` (CLAIM-021).
- **Precondición:** G4 (runs reales que produzcan la casuística).

---

## 3. Diseño experimental mínimo (referencia para Etapa 5)

No se ejecuta en G1; se fija aquí para que las RQ sean operables.

- **Tamaño: 2 tareas × 3 condiciones × 2 repeticiones = 12 runs**, con una regla
  de escalamiento pre-declarada (una tercera repetición solo en las celdas cuyas
  dos repeticiones discrepen en la métrica primaria) que lo acota a un máximo de
  **18**. Este diseño reemplaza al de 27–45 runs del roadmap §11, que resulta
  desproporcionado para el alcance y el presupuesto de esta tesis. **[decisión
  de Francisco, 2026-07-24]**
- **Selección de tareas:** las dos tareas deben caer en **lados opuestos del
  umbral** de decisión —una multi-capa por encima, una acotada por debajo—, de
  modo que la política quede expuesta a los dos lados de la paradoja
  (sub-división y sobre-división) y el diseño no favorezca la hipótesis por
  construcción.
- **Constantes:** repositorio y base commit, objetivo y criterios, modelo/esfuerzo/executor,
  presupuesto/timeouts, versión de ManyHands (un único commit para todos los
  runs), comandos de validación, hardware.
- **Control de sesgo temporal del proveedor:** orden pre-registrado en dos
  bloques con las condiciones invertidas en el segundo.
- **Análisis:** datos crudos completos y **valores de cada run individual**
  (con $n=2$ un promedio oculta más de lo que muestra); fallos y modos de falla;
  amenazas a la validez. **Sin pruebas de significancia**: el tamaño no las
  admite y no se reportan p-valores ni intervalos de confianza.

El protocolo completo ---tareas, orden, métricas, criterios de interpretación,
hipótesis y falsador pre-registrados--- está en
[`evidence/experiment/protocol.md`](evidence/experiment/protocol.md).

---

## 4. Decisiones de alcance — **APROBADAS por Francisco (2026-07-23)**

Estas decisiones cierran G1. D-1..D-4 fueron aprobadas; D-5 queda a confirmar al
inicio de la Etapa 4 (no bloquea G1). Ninguna se implementa en G1: fijan el
alcance congelado que habilita la Etapa 2.

### D-1 — Nomenclatura: converger a **una sola generación definitiva sin sufijos** ✅ APROBADA

- **Problema:** tesis/core-pillars dicen "V3"; el código y `schemaVersion` son "V2" (CLAIM-090).
- **Decisión de Francisco (textual):** *"V3 es el diseño definitivo que quiero
  incorporar al sistema, pero debería eliminarse este 'V3' ya que van a ser los
  paquetes definitivos que se van a entregar. Por su parte, el actual V2 si la
  tesis no lo requiere, debería eliminarse."*
- **Interpretación operativa:** el diseño adaptativo hoy rotulado "V3" es la
  **generación definitiva** a entregar; se **elimina el rótulo "V3"** (los
  paquetes definitivos no llevan sufijo de versión) y se **retira el código/rótulo
  "V2" que la tesis no requiera**. Resultado: una única nomenclatura sin sufijos
  `V2`/`V3`; los símbolos `*V2` (`selectReadyWaveV2`, `V2NodeExecutor`,
  `ExactCandidateValidatorV2`, etc.) pierden el sufijo en el refactor; la tesis
  describe **un** sistema definitivo, no "V2 vs V3".
- **Consecuencia / dónde se aplica:** el rename de símbolos y el retiro del V2
  legacy no requerido es trabajo de **Etapa 2/3** (no G1). En la tesis, eliminar
  "Decomposer V3", "GraphRevision V3", "ManyHands V3" y hablar de la política de
  descomposición adaptativa y de los componentes por su nombre sin versión
  (Etapa 6). `schemaVersion` interno de eventos puede permanecer como número, pero
  sin exponerse como marca de producto.

### D-2 — Integrar el aporte adaptativo en la ruta productiva ✅ APROBADA (Etapa 3)

- **Problema:** `C_task`/Architect Pass/Graph Compiler adaptativo no están en la ruta productiva (CLAIM-001/002).
- **Decisión:** integrarlos en el planning productivo (Etapa 3); el aporte central
  se vuelve demostrable end-to-end y la tesis puede afirmarlo como implementado y
  evaluado.
- **Consecuencia:** es el mayor esfuerzo de ingeniería restante; gate G3.

### D-3 — Remover SQLite WAL por completo; quedarse con JSONL ✅ APROBADA

- **Problema:** SQLite WAL no existe en código (CLAIM-051); la persistencia es JSONL.
- **Decisión de Francisco:** *"Removerlo por completo, nos quedamos con JSONL si
  no tiene demasiado beneficio hacer todo el cambio."*
- **Consecuencia:** persistencia canónica = JSONL append-only + escritura atómica
  (`fsync` opcional) + snapshots. Editar Resumen, Obj. Específico 5, §3 y la figura
  de arquitectura para eliminar SQLite WAL (Etapa 6). No hay implementación de
  SQLite pendiente.

### D-4 — Rotular/remover resultados y casos ahora; regenerar en el experimento ✅ APROBADA

- **Problema:** la Tabla `GEI` (90 %, etc.) y los 4 casos se presentan como
  medidos, sin dataset reconstruible (CLAIM-005/006).
- **Decisión:** rotular como ilustrativos/pendientes o removerlos ahora, y
  **regenerarlos** con el experimento real de la Etapa 5.
- **Consecuencia:** la tesis no publica números sin procedencia; gate G5.

### D-5 — Escenario del run canónico (Etapa 4) ⏳ A CONFIRMAR al iniciar Etapa 4

- **Problema:** hay que elegir repositorio/objetivo del run definitivo.
- **Recomendación (no bloquea G1):** feature vertical sobre un pequeño monorepo/app
  TS existente (dominio + API + UI + tests), con al menos un seam y validación de
  integración; base Git limpia y verde. **[roadmap §10]**
  - *Consecuencia:* ejercita el aporte sin mezclar scaffolding greenfield. Evitar
    greenfield vacío (obliga a evaluar stack y scaffolding a la vez).

---

## 5. Referencias

- Plan rector: [`../THESIS_COMPLETION_ROADMAP.md`](../THESIS_COMPLETION_ROADMAP.md)
- Matriz claim–evidencia: [`claim-evidence-matrix.md`](claim-evidence-matrix.md)
- Capacidades diferidas y nomenclatura: [`deferred-capabilities.md`](deferred-capabilities.md)
- Baseline: [`evidence/baselines/stage-1-baseline.md`](evidence/baselines/stage-1-baseline.md)
