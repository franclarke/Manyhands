# Fixtures golden

> Estado: **baseline de diseño** (2026-06-05). Define el conjunto de fixtures que validan el modelo operativo **antes** del backend real. Cada fixture es un array de `RunEvent` (ver [`run-operative-model.md`](run-operative-model.md)).

---

## 1. Propósito

Los fixtures golden cumplen tres roles:
1. **Tests del reducer y los selectores** — dado un log de eventos, el estado derivado debe ser el esperado.
2. **Insumo del prototipo de UI** — permiten construir y validar la experiencia sin backend.
3. **Tests de regresión del contrato** — si un cambio rompe un golden, el contrato cambió y hay que decidirlo conscientemente.

## 2. Por qué fixtures y SSE comparten la misma forma

Un fixture es exactamente un array de `RunEvent`, el mismo envelope que emite (o emitirá) el stream SSE. El reducer no distingue origen. Esto garantiza que **lo prototipado con fixtures mapea 1:1 al backend real**: no hay trabajo descartable. El único agregado exclusivo de fixture es metadata de reproducción de timing:

```ts
type RunFixture = {
  runId: string;
  events: RunEvent[];
  playback?: { delaysMs: number[] };   // SOLO fixture: para replay con ritmo "vivo"; se descarta en backend
};
```

## 3. Cómo validan el modelo antes del backend

Como `ExecutionState`, fase, salud, wavefront, freshness y blast radius son **derivados**, alcanza con alimentar el log de un fixture al reducer para verificar que **todos** los selectores devuelven lo correcto en cada corte. Esto valida el corazón del sistema (modelo + reducer + selectores + UI projections) sin depender de Gemini, git, ni capacidades backend aún pendientes (grounding, verify-loop real, diagnóstico de conflictos).

---

## 4. El set golden

| Fixture | Demuestra | Estado backend que simula |
|---|---|---|
| `golden-happy-path` | Run exitoso sin conflicto | feliz |
| `golden-planning-question` | Pregunta humana durante planning | aclaración |
| `golden-verify-auto-repair` | Build/test falla y se auto-repara | reparación autónoma |
| `golden-behavioral-conflict` | Conflicto conductual invisible al merge | arbitraje humano |
| `golden-seam-amendment-blast-radius` | Cambio de firma + invalidación selectiva | plan vivo |

---

### `golden-happy-path`
- **Propósito:** el camino feliz completo; valida las seis fases y las transiciones de fase/salud.
- **Historia:** feature simple; el plan se aprueba; Foundation congela una costura; una wave paralela; todos los leaves pasan verify; integración bottom-up verde; evidencia; merge.
- **Eventos mínimos:** `run.created` → `run.context.resolved` → `plan.*` → `decision{approve_plan}` → `grounding.*` + `seam.frozen` + `wave.planned` → `wave.opened` + `node.execution.started`×N + `node.verify.passed`×N + `wave.closed` → `integration.started/validated/completed` → `run.evidence.ready` + `decision{approve_merge}` → `run.accepted` → `run.completed`.
- **Assertions del reducer:** `selectPhase` recorre Framing→…→Disposition en orden; `selectHealth` = working durante la wave, attention solo en los dos gates, settled al cerrar; `selectWavefront` = los leaves de la wave simultáneamente; `selectInvalidatedNodes` = ∅ siempre.
- **Assertions de UI:** los signos vitales se encienden a la vez (paralelismo visible); canal de decisiones vacío salvo en los gates; evidencia al final.
- **Invariantes cubiertas:** 1, 5, 6, 11 (ver [`run-operative-model.md`](run-operative-model.md#6-invariantes-del-modelo-para-tests)).
- **Por qué golden:** es la línea base. Si este se rompe, algo fundamental del ciclo de vida cambió.

### `golden-planning-question`
- **Propósito:** validar el gate de aclaración durante planning como `Decision{clarify}`.
- **Historia:** durante la descomposición, el agente necesita desambiguar una decisión de diseño; emite una pregunta; el humano responde; el planning continúa.
- **Eventos mínimos:** `plan.started` → `plan.node.proposed`× → `decision.raised{clarify}` (con `context.question/options`) → `decision.resolved{choice:{answer}}` → `plan.node.proposed`× → `plan.ready` + `decision.raised{approve_plan}`.
- **Assertions del reducer:** mientras la pregunta está pendiente, `selectHealth=attention` y `selectAttention=[clarify]`; `selectPhase=Proposal`.
- **Assertions de UI:** la pregunta aparece en el **canal de decisiones** (no en una superficie aparte), con contexto embebido; el resto del planning no se pierde.
- **Invariantes cubiertas:** unificación de gates (toda intervención es `Decision`), 6 (sin flicker).
- **Por qué golden:** prueba que un gate **no-de-conflicto** usa el mismo recurso unificado; valida que la dispersión de intervención del diseño viejo quedó resuelta.

### `golden-verify-auto-repair`
- **Propósito:** validar el verify-loop y la reparación autónoma **sin** molestar al humano.
- **Historia:** un leaf falla el build en la iteración 1; el sistema repara; pasa en la iteración 2–3.
- **Eventos mínimos:** `node.execution.started` → `node.verify.iteration{build:fail}` → `node.verify.failed` → `node.repair.started` → `node.verify.iteration{build:pass, tests:n/m}` → `node.verify.passed`.
- **Assertions del reducer:** durante el loop, `selectHealth=working` (no attention — la reparación es autónoma); el signo vital refleja `retry k/max`; `selectAttention=∅`.
- **Assertions de UI:** el nodo late con `retry`; **el humano no es interrumpido**; el log crudo queda en drawer.
- **Invariantes cubiertas:** 1 (estado derivado), verify-as-truth.
- **Por qué golden:** prueba que lo reversible/verificable lo maneja el sistema solo, manteniendo al humano fuera del loop. Si esto empieza a generar `attention`, se rompió el principio P2.

### `golden-behavioral-conflict`
- **Propósito:** conflicto **conductual** que pasa los tests locales y solo aparece en integración; requiere juicio humano.
- **Historia:** un productor define `duration` en segundos; un consumidor lo llama en milisegundos. Ambos type-checkean y pasan local. La integración falla el e2e. El sistema diagnostica un mismatch de unidad no auto-resoluble y escala. El humano fija la unidad canónica; se re-ejecuta el productor; la integración pasa. La resolución **enriquece el `contract` de la costura** para que no recurra.
- **Eventos mínimos:** wave paralela con `node.verify.passed`× (builtAgainst rev1) → `integration.validated{passed:false}` → `conflict.detected{behavioral, autoResolvable:false}` + `decision.raised{resolve_conflict}` → `decision.resolved{resolutionId}` → `seam.amended{contract}` → re-`node.execution.started`/`verify.passed` del productor → `integration.validated{passed:true}` → `conflict.resolved` → evidencia.
- **Assertions del reducer:** tras `conflict.detected`, `selectHealth=attention` **en el mismo corte** (emisión atómica); `selectConflicts=[behavioral]`; `selectBlocked` incluye el compuesto, **no** los hermanos no implicados; tras resolver, el productor recorre `integrated→running→integrated` (no monotónico); `conflict.status=resolved` solo tras la re-validación verde.
- **Assertions de UI:** edge tipado entre los dos nodos implicados, el tercero sin marca; el resto del grafo no bloqueado; un único gate bloqueante hidratado con las dos interpretaciones + el assertion que falla; la evidencia cita la decisión humana.
- **Invariantes cubiertas:** 3 (no monotonicidad), 6 (sin flicker), 7 (resuelto tras re-validación).
- **Por qué golden:** prueba que congelar una costura no captura semántica, y que el modelo cierra el loop conflicto→decisión→`contract`. Es el regresión de los refinamientos A–G.

### `golden-seam-amendment-blast-radius`
- **Propósito:** evolución real del plan vivo — **cambio de firma** que invalida consumidores ya verdes y un compuesto ya integrado, con re-ejecución **parcial** y preservación selectiva.
- **Historia:** un productor descubre que la firma congelada es insuficiente (necesita paginación). La enmienda cambia la firma; invalida los dos consumidores (verdes) y el compuesto (integrado); un nodo independiente queda intacto. El humano aprueba viendo el blast radius; se re-ejecuta solo lo afectado; la integración final pasa.
- **Eventos mínimos:** wave con `node.verify.passed{builtAgainst:rev1}`× + `integration.completed` del compuesto → `amendment.proposed{changeKind:signature, affects}` + `decision.raised{approve_amendment}` → `decision.resolved{approve}` → `seam.amended{revision:2, signature}` → re-ejecución de productor + consumidores stale (`builtAgainst:rev2`) → re-`integration` del compuesto y la raíz → `evidence{invalidationTrace}`.
- **Assertions del reducer:** **antes** de aprobar, `selectAffectedByAmendment` = blast proyectado y `selectInvalidatedNodes=∅` (no aplicada); **tras** `seam.amended`, `selectInvalidatedNodes` = {consumidores + compuesto + raíz}, el nodo independiente **fresh**; los consumidores recorren `integrated→stale→running→integrated`; `freshness` vuelve a `fresh` al re-pasar con `builtAgainst=rev2`; el nodo independiente **nunca** emite un segundo `execution.started`.
- **Assertions de UI:** el blast radius se previsualiza antes de aprobar; los nodos invalidados se muestran **obsoletos (no fallo)**; solo los afectados re-laten; el independiente queda verde estático; la evidencia muestra `invalidationTrace` con `preserved`.
- **Invariantes cubiertas:** 2 (freshness derivada), 3 (no monotonicidad), 8 (no `completed` con stale), 9 (proyección vs realización), 10 (obsoleto ≠ done), 11 (una fuente de verdad).
- **Por qué golden:** es el único caso que prueba blast radius real, invalidación selectiva y re-ejecución parcial. Es el regresión de los refinamientos H–P, que el modelo A–G no tenía.

---

## 5. Cobertura del set

Entre los cinco, el set cubre: las seis fases, los cuatro tipos de `Decision` (approve_plan, clarify, resolve_conflict, approve_amendment, approve_merge), el verify-loop (éxito y reparación), las dos clases de evolución de costura (`contract` y `signature`), la invalidación derivada, y todas las invariantes del modelo. Un cambio que rompa cualquiera de estos fixtures debe tratarse como un cambio consciente del contrato congelado.
