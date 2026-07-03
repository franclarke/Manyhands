# Evolución y Rationale Del Rediseño

> Estado: **registro histórico** (2026-06-05). Documenta no solo *qué* se decidió, sino *por qué se cambió*. No define una estrategia de evaluación vigente. Complementa la síntesis de decisiones en [`../DECISIONS.md`](../DECISIONS.md).

---

## 1. La dirección anterior

La primera generación de la interfaz de ManyHands trataba el sistema como un **visor de planes**. El flujo central era: el usuario describe una feature, el sistema descompone con Gemini en un DAG, y la interfaz **renderiza ese grafo**. La inversión de esfuerzo de producto estaba en la **fase de planificación**: un árbol de descomposición vivo, una consola con el stdout crudo del agente, un gate de preguntas de aclaración.

Para visualizar el grafo se ofrecían tres vistas conmutables —canvas, board, timeline— tratadas como pares. El estado de ejecución de cada nodo se representaba con un mecanismo deliberadamente simple (`nodeStatusOverrides`): un nodo era `running`, `done` o `failed`. La intervención humana vivía en superficies separadas (preguntas en planning, aprobación de plan en una barra de acción, conflictos en un panel inferior).

No era un diseño ingenuo: tenía streaming en vivo, un grafo navegable, un inspector editable. Pero resolvía el problema equivocado.

## 2. Los problemas que empezaron a aparecer

Al ejercitar el sistema con runs reales surgieron señales consistentes:

- La experiencia era rica durante el **planning** y pobre durante la **ejecución** —justo al revés de lo que un orquestador multiagente necesita, porque la ejecución es donde el humano supervisa.
- Las tres vistas pares revelaban una **indecisión de producto**: ofrecer tres lentes equivalentes es trasladar al usuario la carga de elegir qué mirar.
- El grafo mostraba **topología, no trabajo**: dependencias y riesgo estático, no el pulso de agentes construyendo.
- `nodeStatusOverrides` era **demasiado pobre**: un nodo en ejecución no es un color, es un proceso con un loop interno (construir, probar, corregir).
- El stdout crudo estaba **sobrepromovido**: debug ascendido a experiencia primaria, ahogando la señal.
- La intervención humana estaba **dispersa**, sin un lugar único que ruteara la atención.

## 3. Por qué esos problemas eran señales de un diseño inmaduro

Cada síntoma apuntaba a la misma raíz: la interfaz pensaba el problema como **"render de un plan"** en lugar de **"supervisión de trabajo autónomo"**. Un visor de planes es razonable si el plan fuera correcto y la ejecución, un detalle. Pero en un orquestador de coding agents el plan es una propuesta que la ejecución valida o corrige. Una interfaz que invierte su esfuerzo en planificación está optimizando la parte fácil (proponer estructura) y descuidando la difícil (supervisar que el trabajo realmente funcione y coordine).

Más profundo aún: el sistema no tenía una **arquitectura de estado**. El estado visual era local y mutable, lo que abría la puerta a una **doble fuente de verdad** entre lo que decía el backend, lo que la UI mantenía en memoria, y lo que se pintaba. Sin un modelo de eventos, no había forma rigurosa de representar evolución del plan, conflictos, o re-ejecución parcial.

## 4. El cambio conceptual: de DAG viewer a sala de control agent-first

La decisión central fue dejar de pensar ManyHands como un visor y empezar a pensarlo como una **sala de control continua**: un único run que **madura** a través de fases, donde lo que cambia es el **centro de gravedad de la atención**, no la pantalla.

De ahí se derivó la **U de involucramiento humano**: alto al inicio (autoría de la intención, juicio sobre el plan propuesto), bajo en el medio (supervisión ambiente del trabajo paralelo), alto al final (arbitraje de conflictos, aceptación). El medio de la U es donde el producto se gana el valor: el humano **fuera del loop, en comando**.

### De vistas separadas a una superficie phase-adaptive
En vez de tres vistas pares, **una sola superficie** (el grafo) que reinterpreta su énfasis según la fase: hipótesis en Proposal, frente paralelo en Supervision, ensamblaje en Reconciliation. Timeline y board pasan a ser lentes secundarios que se invocan. El DAG deja de ser protagonista permanente: es el escenario recurrente, que cede el centro a la intención al inicio y a la evidencia al final.

### De estados visuales locales a event log + reducer + selectores
Se adoptó un **event log append-only como única fuente de verdad dinámica**. Todo lo que la UI muestra —fase, salud, wavefront, atención, estado de cada nodo— se **deriva** mediante selectores puros sobre un `RunModel` reducido del log. Esto elimina por construcción la doble fuente de verdad y hace que **fixtures y stream real compartan exactamente la misma forma**, permitiendo validar la experiencia antes de tocar backend.

### De conflictos genéricos a conflictos tipados
Un panel genérico de conflictos aplana una distinción que es la clave del producto: los conflictos tienen **dimensión** (textual, de interfaz, conductual, estructural), y cada una se resuelve distinto. Los conflictos textual/interfaz/estructural se eliminan por construcción o se auto-reparan; el **conductual** es el que escala a juicio humano.

### Seams como contratos de primera clase
Se introdujo la **costura (seam)** como entidad central: el contrato entre nodos. La idea que lo justifica es que **una costura congelada es lo que vuelve independientes a dos lados de un seam** y, por lo tanto, lo que *fabrica* el paralelismo seguro. El grounding —congelar costuras extrayéndolas de código real— no compite con el paralelismo: lo habilita.

### Verify-loop como verdad operativa
Se redefinió "éxito" de un nodo. Antes, "produjo un diff". Ahora, **"compila y pasa sus tests"**. Un leaf es una *unidad verificable de trabajo*: itera construir→probar→corregir hasta verde. Esto convierte el progreso mostrado de "escribió código" en "el código anda".

### Freshness, staleness y blast radius
Para soportar el **plan vivo** se introdujo la noción de **vigencia (freshness)**: un nodo `integrated` puede quedar **stale** si una enmienda cambia la revisión de una costura que consume. La vigencia es un **eje ortogonal** al estado de ejecución, **derivado** comparando contra qué revisión se construyó cada nodo (`builtAgainst`) versus la revisión actual del seam. De ahí surgen el **blast radius** (qué se invalida) y la **re-ejecución parcial** (re-ejecutar solo lo stale, preservar lo no afectado).

## 5. Los stress tests que validaron el modelo

Antes de congelar el modelo operativo, se lo sometió a dos casos diseñados para romperlo.

### `golden-behavioral-conflict`
Dos agentes construyen tareas independientes (scopes disjuntos), cada uno pasa sus tests locales, no hay conflicto textual ni error de build — pero al integrar, un conflicto **conductual** (un mismatch de unidad a través de una costura cuya firma no capturaba la semántica) hace fallar el test end-to-end. El sistema no puede resolverlo solo y escala a una decisión humana bloqueante; el humano decide, se re-ejecuta el productor y la integración pasa.

**Qué enseñó:** que **congelar una costura fija su sintaxis, no su semántica** — por eso los conflictos conductuales sobreviven al grounding y los tests son su red de seguridad. Reveló cinco refinamientos (A–G): el evento `seam.amended` y el campo `Seam.contract` para que la resolución *enriquezca* la costura y no recurra; `Conflict.diagnosisRef` y `Conflict.status`; `decision.choice` estructurado; la **emisión atómica de gates** (que elimina una "ventana de flicker" donde la salud y el canal se contradecían); y que una falla de integración no siempre es un conflicto.

### `golden-seam-amendment-blast-radius`
Un agente descubre a mitad de ejecución que la **firma** congelada de una costura es insuficiente. La enmienda cambia la firma (no solo la semántica) e invalida consumidores **ya verdes** y un compuesto **ya integrado**, forzando re-ejecución parcial — mientras un nodo no afectado debe permanecer intacto.

**Qué enseñó:** que el modelo previo (A–G) **no alcanzaba**. Para derivar la invalidación sin caer en doble fuente de verdad hicieron falta los refinamientos H–P: **revisiones de costura** (`Seam.revision`), el registro de **contra qué se construyó cada nodo** (`builtAgainst`) —el habilitador sin el cual la invalidación no es derivable—, el `Amendment` enriquecido con blast radius, los selectores de vigencia, y la decisión explícita de que **la invalidación es siempre derivada (no existe `node.invalidated`)** y que **`stale` no es un estado persistido** sino un eje ortogonal. Confirmó además que el wavefront debe derivarse del estado de los nodos (la re-ejecución por enmienda no abre wave), validando esa elección de diseño.

## 6. Qué quedó congelado

- El modelo operativo del run con los refinamientos **A–P** (ver [`run-operative-model.md`](run-operative-model.md#refinamientos-congelados-ap)).
- El principio de **una sola fuente de verdad dinámica** (event log) con todo lo visible derivado.
- Las **seis fases como centros de gravedad** (no pantallas) y la **U de involucramiento**.
- **`Decision` como recurso unificado** para toda intervención humana.
- **Costuras de primera clase**, **verify-loop como verdad operativa**, **conflictos tipados**, **freshness derivada**.
- Los dos fixtures golden como **tests de regresión del contrato**.

## 7. Qué queda abierto

- La **implementación del agente scaffolder** de Foundation (se decidió generalidad sobre templates; el contrato de eventos es estable, la implementación no).
- La **capacidad backend de diagnóstico de conflictos** (distinguir conflicto cross-seam de defecto latente).
- La **política exacta** de `maxIterations` del verify-loop y de cancelación/interrupción a mitad de wave.
- Eventos **v2** que no bloquean la demo (cherry-pick por hijo, `node.cli.output`, `integration.diagnosis.started`, `plan.node.thinking`).

## 8. Por qué el nuevo diseño es más sólido y defendible

- **Más sólido técnicamente:** una sola fuente de verdad, todo derivado, sin la clase de bugs de estado visual local. Validado contra los dos casos más difíciles (conflicto conductual y evolución de contrato con blast radius).
- **Más coherente como producto:** una experiencia continua con jerarquía clara, en vez de un dashboard de vistas pares. La atención se rutea; el humano no caza.
- **Más alineado con el producto:** el rediseño hace explícito el valor técnico —**coordinar coding agents en paralelo vía costuras congeladas, verificación e invalidación selectiva**—. ManyHands deja de ser "un visor de DAGs" y pasa a ser una sala de control para fabricar, supervisar y corregir trabajo paralelo.

## 9. Decisiones tomadas durante la implementación (PR06–PR09)

La implementación fixture-first (PR06–PR09) confirmó el modelo congelado A–P sin renegociarlo, pero produjo decisiones de implementación que conviene dejar registradas:

- **Ruta `proto`, no `_proto`.** En el App Router de Next, una carpeta con guión bajo es *private folder* y no rutea; el prototipo vive en `/runs/proto/<fixture>`.
- **No reutilizar `DagCanvas`.** El `RunGraphViewModel` legacy tiene un enum `status` (`done/failed/...`) que **no puede expresar `obsolete`**; pasarlo por ahí rompería el invariante "stale nunca se ve done". Se construyó una **superficie propia** (columnas por profundidad), fiel al modelo y testeable en entorno `node`. Reconciliar un canvas real es trabajo futuro.
- **freshness changeKind-aware.** Se agregó `Seam.lastChangeKind`: una enmienda de **firma** invalida consumidores; una de **contrato** los enriquece sin invalidarlos. Sin esto, `golden-behavioral-conflict` marcaba falsos stale.
- **Resolución de decisiones por fast-forward del fixture.** El prototipo "resuelve" una decisión aplicando los eventos **existentes** del fixture hasta su `decision.resolved`; nunca inventa eventos (respeta la idempotencia `seq ≤ cursor`).
- **Verify-loop como signo vital de nodo.** Cada nodo expone un resumen compacto (build·tests·retry) derivado de `VerifyLoop`; el repair automático **no** genera atención humana (es no-op en el reducer, se deriva como "verificando con check no-verde"). `obsolete ≠ failed ≠ done`.
- **Lectura de `execution` solo para etiquetas.** El *display* siempre sale de `selectRenderableNodeState`; los view-models leen `execution` únicamente para texto auxiliar (agente/modelo/commit/causa), nunca para decidir qué pintar.

Limitación conocida registrada: `repairActive` es heurístico (el repair no se persiste en el modelo), y el path "failed" terminal no tiene fixture todavía.
