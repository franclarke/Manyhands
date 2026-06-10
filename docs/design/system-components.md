# Componentes del sistema — piezas conceptuales

> Estado: **baseline de diseño** (2026-06-05). Estas son **piezas de producto/arquitectura**, no componentes React. Los nombres son conceptuales; pueden cambiar al implementar. Cada pieza se define por su responsabilidad y sus límites, no por su forma visual.

Tres familias: **(A) columna vertebral de datos**, **(B) proyecciones de UI**, **(C) integración con backend**. Todo en B es proyección de A; A se alimenta de C. Ninguna pieza de B tiene estado de dominio propio.

```
(C) backend emitter ─→ SSE adapter ─┐
                                     ├─→ (A) event reducer ─→ run store ─→ selector layer ─→ (B) proyecciones de UI
(C) fixture layer ──────────────────┘
(C) trace/evidence store ←─ refs (diff/log/diagnosis) ←── (B) panel de foco / evidencia
```

---

## A. Columna vertebral de datos

### A1 · Event reducer
- **Responsabilidad:** función pura `(model, RunEvent) → model`. Único lugar que interpreta eventos.
- **Consume:** `RunEvent` (de SSE o de fixtures).
- **Produce:** `RunModel` normalizado.
- **Selectores:** ninguno (está debajo de ellos).
- **Fases:** todas.
- **Relación:** alimenta el run store; consume del SSE adapter / fixture layer.
- **NO debe:** derivar fase/salud/freshness/wavefront (eso son selectores), ni escribir `ExecutionState` "a mano", ni emitir efectos secundarios. Debe ser determinista y testeable sin servidor.

### A2 · Run store
- **Responsabilidad:** sostener el `RunModel` actual + el `cursor` (último `seq`), aplicar eventos vía el reducer, notificar cambios.
- **Consume:** stream de `RunEvent`.
- **Produce:** el `RunModel` para los selectores.
- **Eventos:** consume todos; no produce.
- **Fases:** todas.
- **Relación:** fuente única para la capa de selectores.
- **NO debe:** guardar estado visual local que duplique lo derivable (mata la clase `nodeStatusOverrides`), ni mezclar identidad/config con dinámica.

### A3 · Selector layer
- **Responsabilidad:** funciones puras `model → vista`. Toda la derivación.
- **Consume:** `RunModel`.
- **Produce:** `selectPhase`, `selectHealth`, `selectWavefront`, `selectAttention`, `selectBlocked`, `selectConflicts`, `selectEvidence`, `selectFreshness`, `selectInvalidatedNodes`, `selectAffectedByAmendment`, `selectPendingReexecution`, `selectRenderableNodeState` (ver [`run-operative-model.md`](run-operative-model.md#5-selectores-derivados)).
- **Fases:** todas.
- **Relación:** única interfaz que consumen las proyecciones de UI.
- **NO debe:** almacenar nada; recomputa siempre. No debe haber estado derivado persistido.

---

## B. Proyecciones de UI

### B1 · Marco persistente del run
- **Responsabilidad:** orientación constante: intención, fase, salud, acceso al canal de decisiones.
- **Consume:** `run.intent`, `selectPhase`, `selectHealth`, conteos derivados.
- **Acciones:** ninguna directa (es orientación).
- **Selectores:** `selectPhase`, `selectHealth`.
- **Fases:** todas (siempre visible).
- **Relación:** contiene/encadena todo lo demás.
- **NO debe:** mostrar detalle por nodo ni métricas de dashboard.

### B2 · Canal de decisiones humanas
- **Responsabilidad:** concentrar toda intervención humana tipada; rutear la atención.
- **Consume:** `selectAttention` (decisiones pendientes, bloqueantes vs advisory).
- **Acciones:** resolver un gate inline → emite `decision.resolved`.
- **Selectores:** `selectAttention`; usa `Decision.context` para hidratar (vía `Conflict`/`Amendment`).
- **Fases:** todas (ambiente cuando vacío).
- **Relación:** un ítem puede resaltar nodos en la superficie (`context.nodeIds`); una decisión bloqueante deriva `blocked` sobre el subárbol dependiente.
- **NO debe:** bloquear el wavefront entero (solo el subárbol afectado), ni convertirse en notification-center (vacío = éxito).

### B3 · Superficie de trabajo / DAG phase-adaptive
- **Responsabilidad:** sustrato espacial único que madura (hipótesis → wavefront → ensamblaje).
- **Consume:** `nodes` + `selectRenderableNodeState`, edges tipados (dep/costura/conflicto), `selectWavefront`, `waves`, `selectBlocked`.
- **Acciones:** seleccionar nodo/edge (→ foco), pan/zoom; invocar lentes secundarios (timeline/board).
- **Selectores:** `selectWavefront`, `selectRenderableNodeState`, `selectBlocked`, `selectInvalidatedNodes`, `selectAffectedByAmendment`.
- **Fases:** Proposal, Foundation, Supervision, Reconciliation (protagonista); Disposition (contexto).
- **Relación:** la selección alimenta el panel de foco; las decisiones la resaltan.
- **NO debe:** tratar timeline/board como modos pares; leer `execution` directo (debe usar `selectRenderableNodeState`); tener estado de nodo propio.

### B4 · Panel de foco polimórfico
- **Responsabilidad:** profundidad on-demand de **un** objeto (nodo / costura / conflicto).
- **Consume:** `selectRenderableNodeState` + detalle lazy (diff/log/diagnosis por ref).
- **Acciones:** las del objeto (re-scopear, ver firma, inspeccionar diagnóstico).
- **Selectores:** los del objeto enfocado.
- **Fases:** on-demand en cualquiera.
- **Relación:** lo abre B2 (decisión) o B3 (selección).
- **NO debe:** abrirse por defecto, ni pausar la ejecución (peek, no stop).

### B5 · Costuras / seams como contratos de primera clase
- **Responsabilidad:** hacer visible el contrato que *fabrica* el paralelismo.
- **Consume:** `Seam` (signature, contract, revision, state, productor/consumidores).
- **Acciones:** inspeccionar; (avanzado, v2) pin.
- **Selectores:** estado del seam + `selectAffectedByAmendment` para su blast.
- **Fases:** Proposal (draft), Foundation (frozen), Reconciliation (amended).
- **Relación:** edge portante en B3; detalle en B4; su `seam.amended` dispara la invalidación derivada.
- **NO debe:** confundirse con un edge de dependencia (es un contrato, no un orden).

### B6 · Signo vital de nodo / verify-loop
- **Responsabilidad:** convertir "produjo un diff" en "compila y pasa sus tests".
- **Consume:** `VerifyLoop` del `ExecutionState` (iteración, build, tests).
- **Acciones:** expandir a log/diff (en B4).
- **Selectores:** `selectRenderableNodeState`.
- **Fases:** Supervision (y re-ejecución en Reconciliation).
- **Relación:** alimenta `selectHealth` y `selectWavefront`.
- **NO debe:** volcar el stream crudo inline (resumen compacto; crudo a demanda).

### B7 · Superficie de evidencia final
- **Responsabilidad:** la prueba de que el trabajo es real, para la decisión de aceptación.
- **Consume:** `selectEvidence` (diff agregado, tests, narrativa, `invalidationTrace`).
- **Acciones:** aceptar/merge → `decision.resolved{approve_merge}`; explorar diff.
- **Selectores:** `selectEvidence`.
- **Fases:** Disposition (protagonista).
- **Relación:** consume el resultado integrado; alberga el gate de merge.
- **NO debe:** aparecer antes de Disposition.

### B8 · Canal de comandos
- **Responsabilidad:** steering rápido por teclado (⌘K) — pausar wave, re-scopear, forzar repair, etc.
- **Consume:** acciones disponibles según fase/selección.
- **Acciones:** emite comandos (que el backend traduce a eventos).
- **Fases:** on-demand en cualquiera.
- **NO debe:** ser la única vía de una acción crítica (accesibilidad/descubribilidad).

---

## C. Integración con backend

### C1 · SSE adapter (temporal + permanente)
- **Responsabilidad:** traducir el stream del servidor a `RunEvent`. Hoy también **adapta los eventos SSE actuales** al nuevo contrato (ver mapeo en [`run-operative-model.md`](run-operative-model.md#11-relación-con-la-ui-actual-mapeo--adaptadores)).
- **Consume:** stream SSE del backend.
- **Produce:** `RunEvent` para el reducer.
- **NO debe:** derivar estado; solo traducir forma. La adaptación de los eventos legacy es un **puente temporal** hasta que el backend emita `RunEvent` nativos.

### C2 · Fixture layer
- **Responsabilidad:** reproducir arrays de `RunEvent` (con timing opcional) idénticos al stream real.
- **Consume:** fixtures golden (ver [`golden-fixtures.md`](golden-fixtures.md)).
- **Produce:** `RunEvent` para el reducer (la misma forma que C1).
- **NO debe:** introducir campos que no existirían en vivo (salvo `playback` de timing, que se descarta).

### C3 · LangGraph StateGraph (Backend engine)
- **Responsabilidad:** Coordinar el flujo de ejecución completo del run utilizando una máquina de estados formal. Emite eventos a través del adaptador de trazas e implementa las interrupciones nativas (`interrupt()`) para la atención conversacional.
- **Estado:** **Propuesto (Prototipo LangGraph.js)**. Reemplaza al loop secuencial `RunExecutor` por un flujo estructurado en nodos y edges con soporte para paralelismo dinámico (Map-Reduce Send) y reintentos automáticos.
- **NO debe:** Manipular directamente los worktrees de git ni el Gemini CLI sin pasar a través de las primitivas de ejecución y Git correspondientes del dominio.

### C4 · Checkpointer & Trace Store (Persistencia y Evidencia)
- **Responsabilidad:** Almacenar de forma inmutable el historial de checkpoints (el State inmutable) de LangGraph en archivos JSON locales en el disco (`JsonFileCheckpointSaver`). Resuelve de forma síncrona el estado para Next.js en la carga inicial y soporta la bifurcación (fork) no destructiva para la UI de time-travel.
- **Consume:** Actualizaciones de estado y checkpoints emitidos por el motor del grafo.
- **Produce:** El log de ejecución inmutable y el snapshot inicial del run.
- **NO debe:** Permitir mutaciones arbitrarias del estado fuera de los canales declarados en la anotación `RunStateAnnotation`.


---

## Colaboración: una sola dirección de verdad

- Todo **fluye de C → A → B**. Las acciones de B (resolver decisión, steer) producen **comandos** que el backend convierte en **eventos**, que vuelven por C. La UI nunca muta el `RunModel` directamente.
- **Selección en B3 → B4** (foco). **Decisión en B2 → resalta B3** (vía `context.nodeIds`).
- El único estado almacenado es el del run store (fold de eventos) + los refs en C4. Cualquier otra "verdad" es un bug de doble fuente.

---

## Qué evita el acoplamiento y la doble fuente de verdad

1. Las proyecciones (B) **solo leen** selectores; nunca el `RunModel` crudo ni `execution` directo.
2. El reducer (A1) **no deriva**; los selectores (A3) **no almacenan**.
3. El estado de nodo, freshness, fase, salud y blast radius son **siempre** derivados.
4. La adaptación de eventos legacy (C1) es **explícitamente temporal**; no se construye lógica nueva sobre ella.
