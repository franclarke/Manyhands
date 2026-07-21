# Guía de estudio — Defensa de tesis: ManyHands

> Documento de estudio progresivo, pensado para una lectura activa de **~60 minutos**. No es un resumen de las slides: es una explicación conectada, como si alguien que conoce el sistema en profundidad te lo estuviera enseñando de punta a punta antes de que lo defiendas vos mismo.
>
> Basado en las 16 diapositivas del deck actual y en el guion completo del presentador (`manyhands-presenter-deck.html`), más el conjunto de decisiones de arquitectura (`DECISIONS.md`) y los contratos técnicos (`docs/system/`).

---

## Cómo usar esta guía (2 min)

Cada bloque de contenido lleva una etiqueta que te dice cuánto esfuerzo ponerle:

| Etiqueta | Qué significa | Qué hacer con eso |
|---|---|---|
| 🎯 **ESENCIAL** | Si olvidás todo lo demás, esto no. | Memorizarlo, poder decirlo sin pensar. |
| 🗣️ **EN TUS PALABRAS** | Un concepto que tenés que poder parafrasear, no recitar. | Practicá decirlo de 2-3 formas distintas. |
| 🔧 **DETALLE TÉCNICO** | Enriquece la respuesta si te piden precisión. | Reconocerlo, no memorizarlo palabra por palabra. |
| 📎 **SOLO SI PREGUNTAN** | Material de reserva. | Leerlo una vez; volver si surge la pregunta exacta. |

La guía tiene tres partes: **Parte I** (el relato completo, ~35 min) es el corazón — enseña el sistema de punta a punta como una historia con causa y efecto. **Parte II** (~10 min) son los puntos débiles y cómo defenderlos sin ponerte a la defensiva. **Parte III** (~15 min) es repaso activo: resumen, glosario, autoevaluación y un simulacro de preguntas.

---

# Parte I — El relato completo

## Capítulo 0 — El marco: qué vas a defender

🎯 **ESENCIAL.** ManyHands es un sistema que toma un objetivo de desarrollo de software escrito en lenguaje natural y lo convierte en un **DAG jerárquico ejecutable**: un plan donde agentes de IA aislados implementan partes acotadas bajo **contratos explícitos**, y el sistema recompone el resultado con **evidencia verificable** de que cada parte cumple lo que prometía.

La palabra que sostiene todo el proyecto es *verificable*. No estás defendiendo "un sistema que funciona" — eso es fácil de simular con una demo bien ensayada. Estás defendiendo un sistema donde **cada afirmación fuerte tiene un respaldo concreto**: un test que pasa, un evento persistido, un commit inspeccionable. Ese es el criterio que vas a aplicar constantemente, y es también el criterio que el jurado va a aplicar sobre vos: si decís que algo "está verificado", tiene que estarlo de verdad.

🗣️ **EN TUS PALABRAS.** Practicá decir esto de memoria, es tu elevator pitch:

> *"ManyHands coordina agentes para convertir un objetivo de software en una implementación integrada y verificada. La idea central es que un objetivo de una frase casi nunca es una sola tarea — así que el sistema lo descompone en un grafo con contratos explícitos, ejecuta cada parte de forma aislada, y antes de aceptar cualquier resultado exige evidencia sobre el commit exacto, no la palabra del agente."*

**El hilo conductor de toda la charla — anotalo, va a aparecer una y otra vez:**

> No le creo al relato del agente sobre lo que hizo. Inspecciono el commit real, el diff real, el resultado real.

Este principio aparece explícitamente en la slide de Ejecución aislada, en Adopción de resultados, en Integración bottom-up y en el cierre de Resultados — no es casualidad, es la tesis técnica del proyecto resumida en una frase. Si en algún momento de la exposición no sabés bien qué decir, podés volver a esta idea y siempre vas a estar diciendo algo correcto y central.

---

## Capítulo 1 — El problema: por qué un objetivo no es una tarea

### El ejemplo que sostiene toda la charla

🎯 **ESENCIAL.** El ejemplo motivador —y también el fixture de referencia que usás en las demostraciones del sistema— es: *"agregar recuperación segura de contraseña a un portal existente"*. Dicho así suena a una sola tarea. El trabajo real cruza cinco superficies distintas: **API, dominio, persistencia, interfaz y tests**. Y esas superficies no son independientes: el formato del token que genera el backend condiciona el contrato que consume el frontend; la política de expiración condiciona tanto el backend como los tests end-to-end.

Tratar esto como una única tarea agentic lineal —un agente, un prompt, de punta a punta— **puede encontrar límites estructurales**. Fijate el verbo: "puede", no "siempre falla". Es una afirmación acotada a propósito.

### Los seis límites — y por qué cada uno importa

🗣️ **EN TUS PALABRAS.** No hace falta recitarlos con el número: alcanza con explicar la idea de fondo, que es esta —

> *"Cuando la ejecución es lineal, seis cosas dejan de estar bajo control: el contexto no entra de una vez porque el objetivo es grande y heterogéneo; las dependencias entre cambios quedan implícitas; la planificación se degrada a medida que la tarea se alarga; aparece interferencia si hay trabajo concurrente sobre el mismo repo; la validación es parcial —cada pieza puede pasar sus propios checks sin que el conjunto funcione—; y la integración llega sin estructura, todo se junta al final a mano."*

🔧 **DETALLE TÉCNICO — el mapa oculto de la charla.** Cada uno de estos seis límites tiene una respuesta arquitectónica concreta que vas a mostrar más adelante. Si te acordás de este mapeo, podés improvisar transiciones con mucha solidez:

| Límite | Respuesta que vas a mostrar |
|---|---|
| Contexto no entra de una vez | Grounding del planner (`RepositorySnapshot`) |
| Dependencias implícitas | Relaciones tipadas del grafo |
| Planificación se degrada | `GraphRevision` inmutable + enmiendas |
| Interferencia sobre el repo | Worktrees + scope |
| Validación parcial | `EvidenceMatrix` |
| Integración sin estructura | Integración bottom-up |

La consecuencia que cierra este capítulo, y que es literalmente el enunciado de tu proyecto: **planificación, dependencias e integración dejan de ser implícitas y pasan a ser problemas explícitos que el sistema tiene que representar y resolver.**

📎 **SOLO SI PREGUNTAN — "¿no alcanza con más contexto?"** Más contexto ayuda a que el modelo *entienda* el repo, no a que el sistema *coordine* el trabajo. Aunque el modelo tuviera todo el repo en la ventana, seguiría sin existir una relación explícita de "esto depende de aquello", ni una regla que impida que dos agentes toquen el mismo archivo a la vez. Eso es estructura, y la estructura no aparece por agrandar el contexto.

---

## Capítulo 2 — La hipótesis: qué es lo que en realidad estás afirmando

🎯 **ESENCIAL — la pregunta de investigación:**

> ¿Puede una arquitectura de descomposición jerárquica, ejecución coordinada e integración bottom-up hacer abordables funcionalidades que no se resuelven bien como una única tarea lineal?

🎯 **ESENCIAL — la hipótesis de ingeniería, leída con cuidado:**

> Representar el trabajo como un DAG jerárquico con contratos explícitos **permite** dividir una funcionalidad grande en unidades acotadas, **identificar** dependencias, **habilitar** paralelismo seguro y **recomponer** los resultados de manera controlada.

Cada verbo está elegido a propósito: *permite*, *identificar*, *habilitar*, *recomponer*. No dice "garantiza" ni "supera a" agentes secuenciales. Esto **no es una hipótesis de superioridad estadística** — no hay un benchmark A/B con métricas de throughput. Es una **hipótesis de capacidad habilitada por diseño**, y se valida por construcción y verificación (tests, evidencia, un E2E de dominio), no por experimento controlado con muestras.

🗣️ **EN TUS PALABRAS — por qué esto importa decirlo así:** si en algún momento alguien te empuja a decir "demostré que esto es mejor que un agente lineal", tenés que poder corregir con seguridad: *"no es esa la afirmación — la afirmación es que esta arquitectura habilita capacidades concretas y verificables (paralelismo seguro, adopción segura de resultados, evidencia sobre el commit exacto) que un enfoque lineal no tiene forma de garantizar por diseño."*

### La pregunta secundaria, exploratoria: granularidad

🔧 **DETALLE TÉCNICO.** Dividir demasiado grueso da tareas grandes y difíciles de validar; dividir demasiado fino multiplica contratos, dependencias y coordinación. ¿Se puede estimar una granularidad adecuada por tarea, según su complejidad, alcance, interfaces y costo de coordinación? Esta pregunta **motiva** el modo "auto" del decomposer, pero **la política adaptativa completa y su evaluación comparativa son trabajo futuro**, no un resultado de esta tesis. Es importante no sobrevender esto: si preguntan por el modo "auto" en detalle, la respuesta correcta es "está motivado por esta pregunta, existe como mecanismo, pero no está evaluado comparativamente ni es la política final".

---

## Capítulo 3 — Objetivo y alcance: qué construiste, honestamente

🎯 **ESENCIAL — objetivo general:** diseñar e implementar un sistema que transforme un objetivo de desarrollo en un run **planificado, ejecutado, validado, integrado y supervisable**.

Los cinco objetivos específicos no son una lista abstracta — cada uno mapea a un módulo real del sistema:

1. Planificación basada en el repositorio → *planner + Graph Compiler*
2. Contratos y grafo ejecutable → *task-graph + contracts*
3. Ejecución aislada y concurrente → *execution-core con worktrees*
4. Validación e integración → *result-pipeline + composer*
5. Persistencia, supervisión y recuperación → *run-store + run-coordinator + web*

🎯 **ESENCIAL — el alcance real, dicho con la misma confianza que el resto:** el sistema es **local-first, single-host**. Corre agentes vía **CLI** —Claude Code y Codex, no llamadas directas a una API—, aísla con **Git worktrees**, persiste de forma durable en **JSONL local**, y tiene una interfaz web de supervisión. Lo que no incluye —infraestructura cloud, ejecución distribuida— está **fuera del alcance implementado**, declarado desde el principio, no descubierto como excusa al final.

🗣️ **EN TUS PALABRAS.** "Local-first, single-host" significa: un único proceso orquestador sobre un único checkout de repositorio por run, en la máquina del usuario. No hay multi-tenancy ni multi-usuario todavía. Decilo así de directo si preguntan — no hace falta un rodeo.

📎 **SOLO SI PREGUNTAN — "¿por qué no la nube desde el principio?"** Es una decisión de foco: para una tesis, profundidad de garantías pesa más que amplitud de infraestructura. Además, el diseño ya usa **puertos** —el store de eventos y el executor de agentes son interfaces reemplazables— así que extender a multi-host es una extensión natural del mismo diseño, no una reescritura.

---

## Capítulo 4 — El mapa mental: cómo corre un run de punta a punta

Este es el capítulo que sostiene el resto de la charla. Todo lo que viene después son detalles de una de estas etapas.

🎯 **ESENCIAL — el flujo completo, en orden:**

```
goal → inspección del repo → planning → compilación → aprobación humana
     → scheduling → ejecución → validación → integración bottom-up → delivery
```

Y la frase que tenés que decir apenas mostrás este diagrama: **esto no es un diagrama aspiracional, es el flujo que corre hoy en el sistema.**

🔧 **DETALLE TÉCNICO por etapa** (para responder con precisión si te piden detalle de alguna):

- **Inspección:** de solo lectura — el Repository Inspector nunca modifica el commit objetivo, solo lo lee para construir el *grounding*.
- **Compilación:** el Graph Compiler determinista convierte la propuesta semántica del modelo en identidad estable, relaciones tipadas y contratos ejecutables.
- **Scheduling:** calcula qué está *ready* y arma **waves** — el grupo de hojas que se despacha en paralelo, persistido *antes* de dispatchearlas, nunca después.
- **Validación:** produce una `EvidenceMatrix`, un veredicto por criterio de aceptación.
- **Delivery:** publicación idempotente contra un target sin cambios.

📎 **SOLO SI PREGUNTAN — "¿es un flujo estrictamente lineal?"** No — el diagrama muestra el camino feliz. Hay loops explícitos: un fallo o una ambigüedad puede volver a planning vía una enmienda o un replan local. Eso se cubre en el capítulo de Recuperación.

### El producto, en vivo: una escena de un run corriendo

🗣️ **EN TUS PALABRAS.** Cuando mostrás la captura del run en ejecución (wave 2 de 4, seis hojas, una decisión pendiente), el punto que tenés que transmitir no es "mirá qué linda la interfaz" — es esto:

> *"Una decisión humana pendiente —en este caso, si el enlace de recuperación expira a los 15 minutos o debe ser configurable— no frena el run entero. Mientras esa decisión está pendiente, otros nodos siguen avanzando: uno ya está completado, otro integrado, otros dos siguen corriendo. Solo lo que depende directamente de esa decisión queda bloqueado."*

🎯 **ESENCIAL — la frase que cierra esta escena, y que es una garantía arquitectónica real, no una frase de marketing:**

> La interfaz es una proyección del journal de eventos. Las garantías no vienen de lo que ves en pantalla — vienen del código, los tests y los eventos que la respaldan.

📎 **SOLO SI PREGUNTAN — si te preguntan si esa captura es un run real corriendo en vivo o una demostración de interfaz:** aclarar cuál es la fuente exacta antes de responder. Los fixtures de demostración prueban el modelo de interacción de la UI, no por sí solos el backend real — la evidencia real está en el E2E de dominio (código y tests), independiente de esa captura puntual. Decir esto con esta honestidad suma más de lo que resta.

---

## Capítulo 5 — Planificación: cómo un modelo probabilístico entra en un sistema determinista

Esta es, probablemente, la slide más importante de toda la charla desde el punto de vista de "control de sistemas agentic". Tomate un minuto extra acá.

### El problema de fondo

🎯 **ESENCIAL.** La salida de un modelo de lenguaje es texto probabilístico. Eso **no puede gobernar** el lifecycle de un run, ni el scheduling, ni la persistencia — sería delegarle al modelo decisiones que necesitan ser deterministas y auditables.

### La estrategia: separar dos roles

🎯 **ESENCIAL.** El **planner** es semántico: recibe el `goal` más un `RepositorySnapshot` —grounding real del repositorio, no una invención— y propone un `WorkBreakdown`. Es una **propuesta, no una orden**. El **Graph Compiler** es determinista: toma esa propuesta y le asigna identidad estable, decide qué nodos son *leaf* y cuáles *composite*, y genera los contratos.

🗣️ **EN TUS PALABRAS**, una forma natural de explicar la frontera:

> *"El modelo propone, el compiler decide. Todo lo que el modelo devuelve pasa primero por un schema de Zod — si el JSON es inválido, directamente no entra al dominio. Después corren critics deterministas que verifican completitud, atomicidad y validez del grafo. Y esto es lo que más quiero remarcar: cuando aparece una ambigüedad legítima, esa ambigüedad se convierte en una decisión humana durable — nunca en una alucinación que el sistema disimula."*

### Analogía útil

🗣️ **EN TUS PALABRAS.** Si te piden una analogía simple: es como un arquitecto (el planner) que propone un plano de obra, y un ingeniero de estructuras (el Graph Compiler) que revisa ese plano contra normas de seguridad antes de que empiece cualquier construcción. El arquitecto puede proponer lo que quiera; lo que se construye es lo que pasó la revisión.

🔧 **DETALLE TÉCNICO.** `RepositorySnapshot` es *grounding estructural*: paquetes, APIs públicas, convenciones, estado de git — **no es RAG ni recuperación semántica con embeddings**. Esta distinción es importante porque muchas preguntas de jurado asumen que "un sistema con LLMs" usa vectores; acá la respuesta correcta es que no.

Hay **siete critics** en total (la slide muestra un resumen de tres): *Completeness, Atomicity, Graph, Contracts, Scope, Validation, Risk*. Cada finding trae severidad, evidencia, el nodo/contrato afectado y una reparación propuesta — los errores bloquean la aprobación, los warnings se muestran con impacto, nunca se esconden en un log.

📎 **SOLO SI PREGUNTAN — "¿cómo se prueba un planner no determinista?"** El contrato de salida sí es determinista: schema, critics y compiler tienen tests propios. El modelo se testea por propiedades de su output —por ejemplo, que toda salida válida pase los critics— no por igualdad exacta contra un plan de referencia.

📎 **SOLO SI PREGUNTAN — "¿qué pasa con un plan válido en forma pero sin sentido, como una sola hoja gigante?"** Ahí entra el critic de *Atomicity*: una hoja tiene que ser cohesiva y descartable de forma independiente. Si mezcla outputs sin relación o su *blast radius* impide descartarla localmente, el critic la rechaza.

---

## Capítulo 6 — El grafo: cuatro relaciones, no una

🎯 **ESENCIAL.** Podrías haber modelado todo con una arista genérica de "depende de" — como hacen herramientas como Airflow o Dagster. La decisión fue **no hacerlo**, y hay una razón concreta.

| Relación | Pregunta que responde | Detalle clave |
|---|---|---|
| `parentId` | ¿Quién es el dueño de integrar este resultado? | Ownership — un único responsable por nodo |
| `ArtifactRequirement` | ¿Qué output tiene que existir antes? | Disponibilidad — ordena el scheduling |
| `SeamBinding` | ¿Quién comparte una interfaz con quién? | Compatibilidad — **no impone orden por sí sola** |
| `ConflictConstraint` | ¿Qué combinación eleva el riesgo? | Riesgo — nunca inventa una dependencia funcional |

🗣️ **EN TUS PALABRAS — el trade-off, dicho con confianza:**

> *"Es un modelo de grafo más complejo que una arista genérica. A cambio, cada relación responde una pregunta distinta sin ambigüedad, y puedo explicar exactamente por qué un nodo está bloqueado, y por cuál de estas cuatro razones."*

### Analogía útil

🗣️ **EN TUS PALABRAS.** Pensalo como una obra de construcción: `parentId` es "quién es el capataz responsable de esta parte"; `ArtifactRequirement` es "este muro no se puede levantar hasta que exista la cimentación"; `SeamBinding` es dos cuadrillas acordando de antemano el diámetro exacto de un caño donde se van a encontrar — mientras respeten esa medida, trabajan en paralelo sin consultarse todo el tiempo; y `ConflictConstraint` es "estas dos cuadrillas no pueden usar la misma grúa a la vez", una restricción de recurso, no una dependencia real de construcción.

🔧 **DETALLE TÉCNICO — la historia detrás de la decisión.** Esto no fue una elección temprana sin revisar: el campo genérico `node.dependencies` existió en una versión anterior y **fue retirado explícitamente** porque mezclaba ownership, disponibilidad y riesgo en una sola arista ambigua. Eso está en `DECISIONS.md`, en la lista de decisiones retiradas — es un dato real, no una construcción para la slide.

📎 **SOLO SI PREGUNTAN — sobre el retiro completo de la arista genérica, esta es tu respuesta de mayor nivel:** en el dominio actual (v2) está retirada explícitamente. Hay un mecanismo de invalidación en una capa de ejecución anterior que todavía camina esa arista genérica para un caso puntual de replanning — lo identifiqué en una revisión propia del código y quedó anotado como retiro pendiente, no oculto. *(Esta respuesta demuestra que conocés el estado real del código, no solo el diseño en el papel — es una de las respuestas más fuertes que podés dar si te presionan sobre consistencia.)*

---

## Capítulo 7 — Ejecución aislada: cómo corre cada agente sin pisarse con otro

🎯 **ESENCIAL.** Cada intento arranca desde una `ExecutionBase` **exacta**: el commit base más, únicamente, los artifacts que ese nodo declaró que necesita — nada más se materializa. Cada intento corre en su **propio worktree de Git**, así que los agentes nunca comparten estado, aunque estén corriendo en paralelo en la misma wave.

🎯 **ESENCIAL.** El scope tiene una regla estricta: **deny-wins**. Los paths prohibidos son siempre un límite duro, en cualquier configuración.

### El InputFingerprint — la parte más delicada de toda la charla

🎯 **ESENCIAL.** Cada intento queda identificado por un `InputFingerprint`: un hash de las entradas que definen su significado exacto. Ese fingerprint es lo que decide, más adelante, si un resultado todavía es válido o quedó calculado sobre datos viejos.

> ⚠️ **Precisión técnica importante — leé esto con cuidado.** La fórmula que aparece en la slide dice, de forma abreviada, "hash(revisión · contratos · base · artifacts · contexto · executor · validación)". La identidad real y actual del intento es **estrictamente node-local**: se compone de sus propios contratos, el commit base, los digests de los artifacts que consume, su contexto, el perfil de executor y el contrato de validación. **La revisión global del grafo, deliberadamente, no forma parte del hash.** Si formara parte, una enmienda en una rama totalmente distinta del grafo invalidaría trabajo independiente que no tiene nada que ver con ese cambio. La revisión viaja como *procedencia* del intento — recuperable desde el propio historial de eventos — no como parte de su identidad de elegibilidad.
>
> No hace falta tocar la slide ni corregir nada en público: cuando lo narres, podés decir "identidad de contratos y grafo" en vez de "revisión" sin que suene forzado, y si te preguntan el detalle exacto, tenés el párrafo de arriba.

🗣️ **EN TUS PALABRAS — analogía simple para el fingerprint:**

> *"Es como el sello de horneado de una torta. Si cambiás un ingrediente después de que la torta ya salió del horno, el resultado horneado ya no corresponde a la receta actual — no importa que haya salido rica, no se sirve. El fingerprint es esa comparación entre 'con qué se horneó' y 'qué es válido servir ahora'."*

🔧 **DETALLE TÉCNICO.** Cambiar de perfil de executor —de Claude Code a Codex, por ejemplo— cambia el fingerprint. Nunca hay un cambio silencioso de proveedor de agente sin que quede identificado. Una wave se persiste (`wave.selected`) antes de despachar cualquier ejecución — nunca se ejecuta nada que no haya quedado registrado primero.

📎 **SOLO SI PREGUNTAN — "¿por qué worktrees y no contenedores o VMs?"** El problema que se ataca es contaminación de cambios entre agentes sobre el mismo repositorio, no hostilidad de código arbitrario. Un worktree aísla el estado de Git, que es justo lo que hace falta acá. **No es un sandbox de seguridad** — y eso se declara explícitamente como límite del sistema, no se oculta.

---

## Capítulo 8 — Adopción de resultados: por qué no le creo al agente

🎯 **ESENCIAL — el principio central, otra vez.** El orquestador inspecciona el **diff real de Git** y es quien crea el *candidate commit* — el agente nunca comitea directamente, y su salida de texto nunca define qué cambió.

Dos reglas sin excepción:

1. Cambios fuera del scope permitido ⇒ el intento se **descarta**.
2. Entradas cambiadas mientras el intento corría ⇒ el resultado queda **stale**, se **rechaza**, nunca se adopta.

🎯 **ESENCIAL — el invariante, tal cual:** *un resultado calculado con entradas que ya no son las vigentes no entra al sistema, sin importar si el proceso terminó con éxito técnico.*

El snippet de código que se muestra en esta slide es real, no ilustrativo:

```ts
if (attempt.inputFingerprint !== input.currentFingerprint) {
  return { eligible: false, event: { type: "attempt.stale", payload: { attemptId, nodeId } } };
}
```

Es, literalmente, "la única puerta productiva de adopción de artifacts" — una única comparación que decide, no lógica dispersa por el código.

📎 **SOLO SI PREGUNTAN — sobre la política de scope exacta:** hoy hay tres modos — **strict** (default: descarta el candidato), **gate** (lo retiene para decisión humana) y **advisory** (lo comitea igual y solo lo registra, útil cuando el allow-list es una conjetura del planner). Los paths explícitamente prohibidos son un deny duro en cualquiera de los tres modos, sin excepción.

📎 **SOLO SI PREGUNTAN — "¿por qué el agente no comitea directamente?"** Porque se separa "proponer cambios" de "aceptar cambios". El orquestador es la única autoridad que decide qué entra al historial, inspeccionando el diff real dentro del worktree — nunca lo que el proceso del agente reporta sobre sí mismo.

---

## Capítulo 9 — Integración bottom-up y entrega

🎯 **ESENCIAL.** El mismo principio de "no confío en el relato" se aplica ahora al árbol completo. La validación corre en un entorno de Git **temporal y limpio**, sobre el **SHA exacto** del candidato. De ahí sale una `EvidenceMatrix`: un **veredicto explícito por cada criterio de aceptación**, no un "pasó" genérico.

🎯 **ESENCIAL.** Cada composite integra a sus hijos de abajo hacia arriba, y su `IntegrationManifest` declara **exactamente** qué outputs de qué hijos aplicó. Un hijo exitoso cuyo artifact no se puede alcanzar es un error antes de integrar — **omitirlo sin dar razón es imposible de representar como éxito** en este modelo.

La entrega requiere **aprobación humana explícita** y produce un `DeliveryReceipt`. La publicación es **idempotente**: si el target no cambió desde la aprobación, reintentar la entrega no vuelve a ejecutar nodos.

🔧 **DETALLE TÉCNICO.** Los conflictos de integración se clasifican en seis tipos: *textual, structural, contract, behavioral, environment, internal* — no todo conflicto es "el código está mal". Se permite **una** reparación semántica automática acotada; si no converge, escala a una decisión humana con opciones concretas — nunca se apilan reparaciones idénticas sin límite.

📎 **SOLO SI PREGUNTAN — "¿por qué integrar por composite y no con un esquema tipo merge-train?"** Esta es una de las mejores preguntas que te pueden hacer, y tenés una respuesta de nivel alto:

> *"Es una alternativa real que identifiqué en una autocrítica del diseño. Un esquema de integración secuencial —cada candidato adoptado se integra en orden topológico sobre un tronco común del run— detectaría conflictos entre hojas de composites distintos más temprano; hoy esos conflictos recién se descubren en el ancestro común. Lo dejé documentado como línea futura, no lo implementé en esta tesis."*

Esta respuesta convierte una posible objeción en una demostración de que pensaste más allá de lo que implementaste — es exactamente el tipo de respuesta que distingue una buena defensa.

---

## Capítulo 10 — Recuperación: qué pasa cuando algo falla

🎯 **ESENCIAL.** El estado completo vive en un **journal append-only**, y se reconstruye siempre por **replay** de esos eventos. Un CAS de secuencia, *leases* y *fencing tokens* rechazan writers viejos y callbacks tardíos: si un proceso responde después de que otro tomó el control, ese resultado tardío se descarta, **aunque haya terminado con éxito técnico**.

🎯 **ESENCIAL — la frase textual de la decisión de arquitectura, memorizala tal cual:**

> No existe "reintentar tres veces" como respuesta universal.

La recuperación **clasifica la causa primero**:

| Causa | Respuesta |
|---|---|
| Transitorio | Reintento acotado — nuevo attempt |
| Código o test | Reparación con diagnóstico, mismo worktree |
| Contrato incorrecto | Enmienda o replan local |
| Dependencia no declarada | Registrar y enmendar el grafo |
| Scope o stale | Descartar directamente, sin intentar salvarlo |
| Integración | Reparación semántica; si no converge, decisión humana |

Y, como ya viste antes: esas decisiones humanas bloquean **solo su propio alcance**, nunca el run completo — el mismo principio de la escena del run en ejecución del Capítulo 4.

### Analogías útiles

🗣️ **EN TUS PALABRAS.**

- **Fencing token:** como un cheque con número de serie. Si perdés el talonario y alguien saca uno con número más alto, tu cheque viejo ya no se puede cobrar, aunque lo presentes después.
- **CAS de secuencia:** como reservar un asiento numerado. Si dos personas intentan reservar el mismo número al mismo tiempo, solo una gana; la otra tiene que consultar de nuevo cuál es el próximo libre.

🔧 **DETALLE TÉCNICO.** La tabla completa de causas tiene ocho filas, no solo las seis mostradas: además incluye *autenticación/binario/entorno* (se suspende solo ese recurso, se pide corrección) e *infraestructura compartida* (se detiene solo el trabajo afectado, sin declarar fallo de código).

📎 **SOLO SI PREGUNTAN — "¿por qué journal propio y no una base de datos?"** Por ser local-first: durabilidad simple con checksums, sin infraestructura externa corriendo. El store de eventos es un puerto, reemplazable.

📎 **SOLO SI PREGUNTAN — punto de autocrítica de alto nivel, si te preguntan "¿qué simplificarías?":**

> *"Buena parte de esta maquinaria de leases y fencing existe porque el proceso web puede tener múltiples writers concurrentes. Si en cambio hubiera un único proceso propietario por run, buena parte de esa complejidad se colapsaría estructuralmente — lo identifiqué en una revisión de arquitectura propia como una simplificación posible, no implementada todavía."*

---

## Capítulo 11 — El stack tecnológico: cada pieza con una responsabilidad

🎯 **ESENCIAL.** No es una lista de buzzwords — cada tecnología está atada a una responsabilidad concreta:

| Tecnología | Responsabilidad |
|---|---|
| TypeScript | Todo el monorepo; tipos inferidos desde schemas de runtime |
| Next.js | Transporte HTTP y composition root — **el dominio no lo importa nunca** |
| React + React Flow | Adapter visual del grafo, nada más |
| Git + simple-git | Worktrees, candidate commits, validación exacta |
| Claude Code / Codex | Perfiles intercambiables de `AgentExecutor` |
| Vitest | 4 niveles de test, incluyendo Git/filesystem **reales**, no mocks |
| JSON/JSONL | Journal append-only con checksums, snapshots descartables |

### Zod — la pieza que más vale la pena explicar bien

🎯 **ESENCIAL.** TypeScript **desaparece en runtime**. Cuando el dato viene de un modelo, de HTTP, de un stream SSE o de disco, el tipo estático no alcanza. Todo eso se **parsea en el límite** con Zod. Pero el límite de Zod también es claro: **valida forma, no gobierna lifecycle, freshness ni adopción** — esas siguen siendo reglas del dominio.

🗣️ **EN TUS PALABRAS — analogía del control de aduana:**

> *"Es como un control de aduana. Todo lo que entra del exterior —HTTP, la salida de un modelo, disco— se inspecciona contra una forma precisa antes de dejarlo pasar. Una vez adentro del dominio, ya se confía en que todo cumple la norma; el control de aduana no decide política interior, solo qué puede entrar con qué forma."*

🔧 **DETALLE TÉCNICO — analogías para un jurado con background en Python:** Zod ≈ Pydantic; los route handlers de Next.js ≈ endpoints de FastAPI.

### LangGraph — la respuesta más importante de toda la sección técnica

🎯 **ESENCIAL, decilo con confianza, no a la defensiva:**

> *"LangGraph se usó en la arquitectura anterior. Cuando detecté que había múltiples autoridades de estado compitiendo —checkpoints, RunRecord, la UI y el journal, cada uno pudiendo divergir— trasladé el lifecycle a RunCoordinator. Hoy no solo no tiene imports productivos: las dependencias fueron removidas por completo del manifest del proyecto, y un boundary test prohíbe explícitamente que el dominio la importe."*

Esta es una de las mejores historias de toda la tesis para un jurado: no es "no sé usar LangGraph", es "lo usé, encontré un problema real de arquitectura, y lo retiré de forma disciplinada sin perder el sistema". Eso demuestra criterio, no carencia.

📎 **SOLO SI PREGUNTAN — "¿por qué CLIs y no la API del modelo directamente?"** Los CLIs ya traen el loop agentic completo probado: uso de herramientas, edición de archivos, gestión de contexto. El seam `AgentExecutor` permite sumar un perfil de API directa más adelante sin tocar el dominio.

---

## Capítulo 12 — Metodología: cómo trabajaste de verdad

🎯 **ESENCIAL — los tres niveles de certeza, la idea metodológica más importante de la charla:**

> Verificado por tests · Observado en smoke · Trabajo futuro — **nunca mezclados bajo la misma etiqueta.**

Esta disciplina es la clave para leer correctamente la slide de Resultados que viene después, y también es, en sí misma, algo que podés presentar como un aporte metodológico, no solo una lista de prácticas.

🎯 **ESENCIAL.** Trabajaste de forma **incremental, por vertical slices**, con una **migración controlada** desde una arquitectura anterior — sin *big-bang*. Cada decisión arquitectónica quedó en un **ADR** (contexto, alternativas, consecuencias) y `DECISIONS.md` fija cuál está vigente. Los tests van antes o junto con cada cambio de comportamiento, en **cuatro niveles**, con un detalle que no es menor: las pruebas de Git y filesystem usan **repositorios temporales reales, no mocks de strings**.

🗣️ **EN TUS PALABRAS — por qué los mocks importan tanto acá específicamente:**

> *"Un diff simulado puede divergir silenciosamente del comportamiento real de Git. Toda la tesis de 'confío en el diff, no en el relato del agente' se cae si el test que lo verifica está mockeado — por eso esas pruebas corren contra un Git real, no contra una simulación."*

🔧 **DETALLE TÉCNICO.** "Boundaries" como nivel de test es distinto de integración: verifica fronteras arquitectónicas explícitas (por ejemplo, que el dominio no importe Next.js, React, Git o CLIs) y rompe el build si se viola esa dirección — no prueba comportamiento funcional.

> ⚠️ **Actualización de un dato que aparece en la slide.** El número mostrado (915 tests en 156 archivos, auditoría del 18/07/2026) está **fechado explícitamente** en la propia diapositiva — no pretende ser una constante. Si te preguntan si sigue siendo así: la cifra actual, verificada en el trabajo más reciente sobre el proyecto, es más alta —alrededor de **960 tests en unos 165 archivos, con typecheck limpio**—; el crecimiento viene de trabajo posterior a esa auditoría. No hay regresiones nuevas en la ruta de dominio: los únicos tests que fallan hoy son dos checks de lint de espaciado en componentes de UI, preexistentes y sin relación con el núcleo del sistema.

---

## Capítulo 13 — Resultados y límites: el cierre

Este capítulo aplica los tres niveles de certeza del capítulo anterior a resultados concretos.

🎯 **ESENCIAL — los tres niveles, aplicados:**

- **Verificado por tests:** el recorrido de dominio completo hasta `result_ready`, de punta a punta, automatizado (E2E).
- **Observado en smoke:** planning desde cero, decisiones durables y replan, hasta `needs_approval`.
- **Pendiente, dicho sin rodeos:** el smoke productivo end-to-end hasta `delivery` todavía no está hecho.

🎯 **ESENCIAL — qué resolvió la arquitectura, como aprendizajes de ingeniería, no como slogans:**

1. Una única autoridad de lifecycle, testeable sin frameworks externos.
2. Adopción segura de resultados concurrentes, gracias a los fingerprints.
3. Evidencia sobre el commit efectivamente entregado — **el mismo hilo conductor de toda la charla, cerrado acá explícitamente.**
4. Recuperación por causa, sin retry universal.

🎯 **ESENCIAL — los límites, con la misma confianza que los resultados:**

- Local-first y single-host.
- Worktrees que aíslan Git, pero **no son un sandbox de seguridad**.
- Streaming fuerte solo demostrado con Claude Code CLI — Codex depende de la granularidad de su propio stdout.
- Granularidad adaptativa como línea futura — **cierra el círculo con la pregunta exploratoria del Capítulo 2.**

🗣️ **EN TUS PALABRAS — la frase de cierre, memorizala:**

> *"Estas son las decisiones que implementé, las garantías que pude verificar, y los límites que el sistema todavía conserva."*

Después de esa frase: abrís a preguntas. No agregues más contenido después — es un cierre fuerte, dejalo terminar ahí.

---

# Parte II — Puntos débiles, objeciones y cómo responderlas (~10 min)

Esta sección es tan importante como la Parte I. Un jurado técnico no está buscando que el sistema sea perfecto — está buscando que **vos entiendas exactamente dónde está lo débil** y puedas hablar de eso sin perder seguridad. Todas las respuestas de acá abajo ya están integradas en el guion de arriba; esta sección las junta para que las repases como un bloque.

### 1. "El sistema tiene mucha maquinaria de concurrencia (leases, fencing, CAS) para correr en una sola máquina. ¿No es sobre-ingeniería?"

**Respuesta honesta y fuerte:** *"Es una observación válida, y la tengo identificada yo mismo. Gran parte de esa maquinaria existe porque el proceso web puede tener múltiples writers concurrentes sobre el mismo run. Si en cambio hubiera un único proceso propietario por run, buena parte de esa complejidad se colapsaría estructuralmente. Es una simplificación real que identifiqué en una revisión de arquitectura, documentada como línea futura, no implementada todavía."*

### 2. "¿La arista genérica de dependencias está realmente eliminada, o queda algo?"

**Respuesta honesta y fuerte:** *"En el dominio actual está retirada explícitamente. Hay un mecanismo legado en una capa de ejecución anterior que todavía la usa para un caso puntual — lo encontré en una auditoría propia del código y quedó anotado como retiro pendiente, no oculto."*

### 3. "El fingerprint en la slide dice que incluye la revisión del grafo — ¿es así?"

**Respuesta honesta y fuerte:** ver el recuadro completo del Capítulo 7. En resumen: no, es node-local a propósito, y la razón es evitar que una enmienda ajena invalide trabajo independiente.

### 4. "¿Por qué integrar por composite y no con un esquema de merge secuencial (merge-train)?"

**Respuesta honesta y fuerte:** ver Capítulo 9. Es una alternativa real, identificada, no implementada — declarada como línea futura.

### 5. "¿Qué tan seguro es el aislamiento? ¿Un worktree protege contra código malicioso?"

**Respuesta honesta y fuerte:** *"No. Un worktree aísla el estado de Git entre agentes trabajando sobre el mismo repositorio — eso es lo que necesitaba resolver. No es un sandbox de seguridad contra código hostil, y lo digo como límite explícito del sistema, no como algo que se descubrió tarde."*

### 6. "¿Cómo sabés que la hipótesis se cumplió, si no hay una métrica comparativa?"

**Respuesta honesta y fuerte:** *"La hipótesis es de capacidad habilitada, no de superioridad estadística. Se valida por construcción y verificación: cada garantía que afirmo —paralelismo seguro, adopción por fingerprint, evidencia sobre el commit— tiene tests o un E2E de dominio que la respalda. No hay un benchmark de throughput contra un agente lineal, y no pretendo que lo haya."*

### 7. "El número de tests en la slide de metodología parece bajo / desactualizado."

**Respuesta honesta y fuerte:** ver el recuadro del Capítulo 12. Tenés el número actualizado a mano — decilo con seguridad, no te disculpes por la diferencia, es evidencia de que el proyecto sigue creciendo activamente.

### 8. "¿Por qué no hiciste el smoke de delivery completo? Es la pieza más importante del pipeline."

**Respuesta honesta y fuerte:** *"Es la brecha de evidencia más grande que declaro abiertamente, y si tuviera que elegir una sola cosa para hacer primero, sería esa. Todo lo demás en el sistema tiene evidencia automatizada respaldándolo; esta es la pieza que falta cerrar, y lo sé con precisión porque distingo los tres niveles de certeza en cada afirmación que hago."*

### 9. "¿No es contradictorio decir que el sistema es 'verificable' si todavía hay partes con solo un smoke manual?"

**Respuesta honesta y fuerte:** *"No, porque 'verificable' no significa 'todo verificado hoy' — significa que cada afirmación declara explícitamente su nivel de evidencia, y nunca se presenta un smoke manual como si fuera un test automatizado. Esa disciplina de separar los tres niveles es en sí misma parte de lo que estoy defendiendo."*

### 10. "¿Cómo migrarías esto a producción real / a una infraestructura distribuida?"

**Respuesta honesta y fuerte:** *"El store de eventos y el executor de agentes ya son puertos. El store podría implementarse sobre un log compartido —por ejemplo con una condición sobre el número de secuencia, como DynamoDB o un stream— y el mismo CAS y el mismo fencing modelan exactamente ese problema de escritores concurrentes distribuidos. No es una reescritura, es una extensión del mismo diseño de puertos."*

---

# Parte III — Cierre y repaso (~15 min)

## Resumen ejecutivo (repaso de 3 minutos)

> ManyHands transforma un objetivo de desarrollo en un run planificado, ejecutado, validado, integrado y supervisable. El problema que resuelve: un objetivo de una frase casi nunca es una sola tarea — cruza capas, tiene dependencias implícitas y se degrada si se ejecuta de forma lineal. La hipótesis: un DAG jerárquico con contratos explícitos habilita división en unidades acotadas, dependencias explícitas, paralelismo seguro y recomposición controlada — no es una afirmación de superioridad estadística, es de capacidad habilitada por diseño.
>
> El sistema separa un **planner semántico** (propone) de un **Graph Compiler determinista** (decide), modela el grafo con **cuatro relaciones tipadas** en vez de una arista genérica, ejecuta cada hoja en un **worktree aislado** identificado por un **InputFingerprint node-local**, y nunca confía en el reporte de un agente: inspecciona el **diff real** y valida sobre el **commit exacto** con una **EvidenceMatrix**. La integración es **bottom-up** con manifests explícitos, la recuperación **clasifica la causa antes de actuar**, y el estado vive en un **journal append-only** protegido por CAS, leases y fencing.
>
> Los resultados se presentan en **tres niveles de certeza** —verificado, observado en smoke, trabajo futuro— sin mezclarlos nunca. Los límites son local-first/single-host, sin sandbox de seguridad, streaming completo solo con Claude Code CLI, y granularidad adaptativa como línea futura. El hilo que sostiene toda la charla: **nunca confiar en el relato del agente, siempre en el commit real.**

## Lista de conceptos imprescindibles (glosario relámpago)

| Término | Definición en una línea |
|---|---|
| **Run** | La unidad de producto: un objetivo llevado de punta a punta hasta la entrega. |
| **GraphRevision** | Una versión inmutable del plan ejecutable; cambiarla crea otra revisión. |
| **WorkBreakdown** | La propuesta semántica del planner, antes de compilarse. |
| **Leaf / Composite** | Hoja ejecutable vs. nodo que integra a sus hijos. |
| **ArtifactRequirement** | "Este output tiene que existir antes" — ordena el scheduling. |
| **SeamBinding** | Interfaz congelada compartida entre siblings; no impone orden. |
| **ConflictConstraint** | Señal de riesgo/recurso; nunca una dependencia funcional. |
| **ExecutionBase** | El commit base más solo los artifacts declarados para un nodo. |
| **InputFingerprint** | Hash node-local de las entradas exactas de un intento; decide vigencia. |
| **Wave** | Grupo de hojas ready despachadas en paralelo, persistido antes del dispatch. |
| **EvidenceMatrix** | Un veredicto explícito por criterio de aceptación, no un "pasó" genérico. |
| **IntegrationManifest** | Declara exactamente qué outputs hijos aplicó un composite. |
| **DeliveryReceipt** | Confirmación idempotente de una publicación aprobada. |
| **Fencing token** | Invalida writers viejos aunque su proceso termine tarde. |
| **CAS de secuencia** | Solo un writer gana por número de secuencia esperado. |
| **Scope deny-wins** | Los paths prohibidos son un límite duro siempre, sin excepción. |
| **Boundary test** | Test que rompe el build si el dominio importa algo que no debería. |

## Preguntas de autoevaluación

Respondé estas preguntas en voz alta, sin mirar la guía, antes de dar por estudiado el material. Si dudás en alguna, volvé al capítulo correspondiente.

1. ¿Por qué un objetivo de una frase no es necesariamente una sola tarea? Dá el ejemplo concreto.
2. ¿Cuál es la diferencia exacta entre la pregunta de investigación y la hipótesis de ingeniería?
3. ¿Por qué la hipótesis no es una afirmación de superioridad estadística?
4. Nombrá los cinco objetivos específicos y a qué módulo del sistema corresponde cada uno.
5. Recitá el flujo completo de un run, de memoria, en orden.
6. ¿Por qué una decisión humana pendiente no frena el run entero?
7. Explicá la diferencia entre lo que hace el planner y lo que hace el Graph Compiler.
8. ¿Por qué existen cuatro relaciones tipadas en el grafo en vez de una sola arista genérica?
9. ¿Qué compone exactamente el InputFingerprint hoy, y por qué la revisión global del grafo NO forma parte de él?
10. ¿Qué significa "el orquestador inspecciona el diff real, no el relato del agente"? Dá el mecanismo concreto.
11. ¿Qué es un IntegrationManifest y por qué hace imposible ocultar un hijo omitido?
12. Recitá la frase textual sobre la recuperación por causa. ¿Por qué es importante que no haya un "reintentar tres veces" universal?
13. Nombrá tres tecnologías del stack y su responsabilidad exacta (no genérica).
14. Contá la historia de LangGraph en 30 segundos, sin sonar defensivo.
15. ¿Cuáles son los tres niveles de certeza que separás en los resultados? Dá un ejemplo de cada uno.
16. Nombrá los cuatro límites actuales del sistema, sin dudar.
17. ¿Cuál es el hilo conductor que atraviesa toda la charla? ¿En qué slides aparece explícitamente?

## Simulacro de preguntas y respuestas

Practicá estas en voz alta, cronometrándote — cada respuesta debería durar entre 20 y 45 segundos, no más.

**P: ¿Qué es ManyHands en una sola oración?**
R: Un orquestador que convierte un objetivo de software en un plan ejecutable por agentes aislados, con contratos que definen qué se espera de cada parte y evidencia que demuestra que se cumplió.

**P: ¿No alcanza con darle más contexto al modelo en vez de toda esta arquitectura?**
R: El contexto ayuda a entender, no a coordinar. Aunque el modelo tuviera todo el repo en la ventana, seguiría sin haber una relación explícita entre cambios ni una regla que impida que dos agentes pisen el mismo archivo. La estructura no desaparece por agrandar el contexto.

**P: ¿Cómo mediste que el paralelismo es "seguro"? ¿Hay una métrica?**
R: No hay una métrica de throughput — "seguro" se define operacionalmente por las garantías verificadas: fingerprint que rechaza resultados obsoletos, scope que descarta escrituras fuera de límite, evidencia sobre el commit exacto. Eso está en el capítulo de resultados, no es un benchmark de velocidad.

**P: ¿Cómo se construye el contexto del planner? ¿Usa RAG?**
R: No. Viene de repository-index: estructura real, paths existentes y seams relevantes al goal. No hay recuperación semántica ni base vectorial — es grounding estructural directo sobre el repositorio.

**P: ¿Qué pasa si el modelo devuelve JSON inválido?**
R: El parseo falla en el boundary de Zod. El intento se registra como un fallo de planning con su causa, y nada malformado llega a tocar el dominio.

**P: ¿Por qué worktrees de Git y no contenedores?**
R: Porque el problema que ataco es contaminación de cambios entre agentes sobre el mismo repositorio, no hostilidad de código arbitrario. Un worktree aísla exactamente eso. No pretendo que sea un sandbox de seguridad, y lo digo explícitamente como límite.

**P: ¿El fingerprint incluye la revisión completa del grafo?**
R: No, deliberadamente. Es estrictamente node-local — contratos propios, base, artifacts consumidos, contexto, executor y validación. Si incluyera la revisión global, una enmienda en una rama distinta del grafo invalidaría trabajo independiente sin relación con ese cambio.

**P: ¿Por qué el agente no comitea directamente?**
R: Porque separo "proponer cambios" de "aceptar cambios". El orquestador es la única autoridad que decide qué entra al historial, inspeccionando el diff real — nunca lo que el proceso del agente reporta sobre sí mismo.

**P: Si tuvieras que elegir una sola cosa para mejorar primero, ¿cuál sería?**
R: El smoke productivo end-to-end hasta delivery. Es la brecha de evidencia más grande que declaro abiertamente — todo lo demás ya tiene evidencia automatizada.

**P: ¿Cuál es, para vos, el aporte más defendible de esta tesis?**
R: Que las garantías del sistema —freshness, scope, evidencia— están respaldadas por código y tests verificables, no por la promesa de que un agente "lo hizo bien". Esa disciplina de verificación es transferible a cualquier stack, no es específica de estos agentes en particular.

**P: ¿Usás LangChain o LangGraph actualmente?**
R: No en la ruta productiva. LangGraph se usó en una arquitectura anterior; lo retiré cuando empezó a duplicar la autoridad del lifecycle. Hoy las dependencias están completamente removidas del manifest del proyecto, y un boundary test evita que vuelvan a colarse en el dominio.

## Guía breve para practicar la presentación completa

1. **Primera pasada (hoy):** leé toda la Parte I en voz alta, sin cronómetro, deteniéndote en cada recuadro ⚠️ y en cada analogía. El objetivo es entender la conexión entre capítulos, no memorizar.
2. **Segunda pasada:** practicá el elevator pitch del Capítulo 0 y la frase de cierre del Capítulo 13 hasta poder decirlas sin dudar, en cualquier orden que te las pidan.
3. **Tercera pasada, con cronómetro:** recorré los 16 capítulos como si fueran las 16 slides, apuntando a que la charla completa entre en el tiempo que tengas asignado (los guiones individuales suman ~2.800 palabras en total, es decir **19 a 22 minutos** de discurso hablado a ritmo normal — 130-150 palabras por minuto —; ajustá según tu tiempo real disponible, priorizando los bloques 🎯 ESENCIAL si tenés que cortar).
4. **Cuarta pasada:** hacé el simulacro de preguntas de esta guía en voz alta, sin mirar las respuestas primero. Cronometrá cada respuesta — si te pasás de 45 segundos, es señal de que la respuesta necesita comprimirse.
5. **Última pasada, el día anterior:** releé solo el Resumen ejecutivo, la lista de conceptos imprescindibles y la Parte II completa (objeciones). Esas tres secciones son tu "calentamiento" final antes de exponer.

Y para el día de la presentación: tenés el deck con `?view=main` en la pantalla principal y `?view=notes` en tu segunda pantalla, sincronizados — cada vez que avances con las flechas, tu pantalla de notas va a mostrar exactamente este mismo contenido, capítulo por capítulo, en el mismo orden que estudiaste acá.
