# Guion de exposición - ManyHands

> Exposición principal: diapositivas 1 a 11.
> Duración objetivo: 13 minutos 35 segundos; límite de práctica: 14 minutos.
> Las diapositivas 12 a 14 son respaldo y se abren únicamente ante preguntas.

## Cómo usar este guion

El texto bajo **Guion oral completo** sirve para practicar. Durante la entrevista conviene mirar solo **Ancla de emergencia** y **Transición**. No leas la diapositiva: usala como mapa visual y agregá problema, estrategia, implementación, evidencia y trade-off.

Reglas de relato:

- la funcionalidad completa, no una tarea individual, es el punto de partida;
- la hipótesis central es el DAG jerárquico con contratos explícitos;
- la separación entre propuestas probabilísticas y mecanismos deterministas es una estrategia arquitectónica que implementa esa hipótesis;
- la granularidad adaptativa completa es exploratoria, no un resultado demostrado;
- `result_ready` y `completed` no son equivalentes;
- la fixture no forma parte de estos 15 minutos.

## Preparación inmediata

- Presentación abierta en la diapositiva 1.
- Segunda pantalla con la [tarjeta compacta](#tarjeta-compacta-para-la-segunda-pantalla).
- Cronómetro visible, sin alertas sonoras.
- [Captura de la UI](../img/img2.png) ya incluida en la diapositiva 6; no abrir la UI durante el recorrido normal.
- Documentos de respaldo abiertos solo si preguntan: [arquitectura](../development/architecture.md), [estrategias](../development/problem-solving-strategies.md) y [librerías](../development/library-usage.md).

## Mapa temporal

| Diapositiva | Tema | Duración | Acumulado |
|---|---|---:|---:|
| 1 | Portada | 0:30 | 0:30 |
| 2 | Problema y motivación | 0:55 | 1:25 |
| 3 | Pregunta, hipótesis y granularidad | 1:00 | 2:25 |
| 4 | Objetivos y alcance | 1:00 | 3:25 |
| 5 | Metodología | 1:05 | 4:30 |
| 6 | Visión general del run | 1:20 | 5:50 |
| 7 | Descomposición, DAG y contratos | 1:25 | 7:15 |
| 8 | Ejecución coordinada | 1:35 | 8:50 |
| 9 | Integración, validación y recuperación | 2:00 | 10:50 |
| 10 | Implementación y librerías | 1:00 | 11:50 |
| 11 | Resultados y conclusiones | 1:45 | 13:35 |

El cronómetro manda más que la tabla. El texto principal contiene aproximadamente 1.630 palabras; a 130–145 palabras por minuto demanda entre 11:15 y 12:35 de habla continua. Con transiciones, pausas y señalamiento visual queda calibrado para 13 a 14 minutos. Si la diapositiva 8 empieza después de `9:30`, usar las versiones abreviadas de las diapositivas 9, 10 y 11.

## Tres rutas de ensayo

### Ruta de 15 minutos - exposición principal

Usá los once guiones completos, respetá los checkpoints de `2:25`, `5:50` y `8:50`, y cerrá alrededor de `13:35`. El margen restante absorbe pausas, una breve interrupción o una transición más lenta. No abras la fixture ni los respaldos.

### Ruta de 12 minutos - entrevista con agenda ajustada

Conservá completas las diapositivas 1–6. En 7 y 8 usá el guion principal sin enumerar todas las relaciones o campos. En 9–11 usá las versiones abreviadas. La pregunta, la hipótesis, los límites de evidencia y la conclusión no se recortan.

### Ruta de 8 minutos - resumen solicitado

Usá las versiones abreviadas de todas las diapositivas. En 5 mencioná sólo metodología y niveles de evidencia; en 7 resumí planner/compiler/Zod; en 8 worktree/scope/fingerprint; en 9 SHA/evidencia/integración/delivery; en 10 nombrá responsabilidades, no el catálogo completo. Cerrá con límites verificables. La demo sigue fuera del tiempo.

---

## Diapositiva 1 - ManyHands: orquestación verificable de agentes para desarrollo de software

**Función narrativa**

Presentar el proyecto y fijar la unidad de análisis: un objetivo de desarrollo convertido en un resultado integrado y verificable.

**Qué debe comprender la audiencia**

ManyHands no es un chatbot que genera código; es un sistema de coordinación alrededor de agentes de desarrollo.

**Mensaje imprescindible**

> La unidad de producto es un run que convierte un objetivo en un resultado integrado y verificable.

**Guion oral completo**

> Soy Francisco Clarke y ManyHands es mi proyecto de tesis. El sistema toma un objetivo de desarrollo, lo transforma en un grafo jerárquico de trabajo, ejecuta unidades aisladas bajo contratos explícitos y recompone un resultado integrado y verificable. En estos minutos voy a explicar el problema que motivó el diseño, la hipótesis de ingeniería, el flujo implementado y qué garantías pude comprobar sin ocultar los límites actuales.

**Ancla de emergencia**

> Objetivo grande → grafo → ejecución aislada → integración → evidencia.

**Transición**

> El punto de partida es entender por qué una funcionalidad grande no se comporta como una sola tarea.

**Tiempo objetivo:** 0:30.

**Versión abreviada**

> ManyHands transforma un objetivo de desarrollo en un grafo de trabajo y coordina su ejecución, validación e integración.

**Repreguntas probables**

¿Es un agente o un orquestador? ¿Cuál es su unidad de producto?

**Respuesta técnica corta:** Es un sistema de coordinación; los agentes son adapters de ejecución dentro de un run durable.

**Evitar:** presentarlo como un chatbot, un generador de código o un sistema cloud.

---

## Diapositiva 2 - Una funcionalidad grande no es una sola tarea

**Función narrativa**

Hacer concreto el problema con el ejemplo de recuperación de contraseña.

**Qué debe comprender la audiencia**

Una ejecución agentic lineal concentra contexto y deja implícitas dependencias, interferencia, validación e integración.

**Mensaje imprescindible**

> Una feature atraviesa límites técnicos; tratarla como una sola tarea oculta el trabajo de coordinación.

**Guion oral completo**

> Pensemos en agregar recuperación segura de contraseña a un portal existente. Parece una feature, pero cruza API, reglas de tokens y sesiones, persistencia, email, dos pantallas y tests de seguridad e integración. No alcanza con producir un endpoint o un formulario por separado.
>
> Si todo se entrega a una única ejecución lineal, el agente tiene que sostener mucho contexto heterogéneo, decidir un orden implícito, evitar pisar cambios concurrentes y validar piezas que pueden pasar individualmente aunque el recorrido completo falle. Al final, además, hay que integrar resultados relacionados sin una estructura que declare qué consume cada parte.
>
> El problema que decidí representar explícitamente fue entonces la planificación, las dependencias materiales, las interfaces, la interferencia y la recomposición del resultado.

**Ancla de emergencia**

> API + dominio + persistencia + UI + tests: una feature, varios límites técnicos.

**Transición**

> A partir de ese problema formulé una pregunta principal y una segunda pregunta exploratoria.

**Tiempo objetivo:** 0:55.

**Versión abreviada**

> Recuperar una contraseña cruza API, dominio, persistencia, UI y tests. Una ejecución lineal debe sostener todo ese contexto y deja implícitas dependencias e integración.

**Posibles preguntas técnicas**

- ¿Por qué no usar un único agente con una ventana de contexto mayor?
- ¿Cuándo la división agrega más costo que valor?

**Respuesta técnica corta:** Un único agente puede servir para cambios cohesivos; el DAG aporta valor cuando existen dependencias, interfaces y validaciones que conviene hacer explícitas.

**Evitar:** afirmar que múltiples agentes siempre son mejores o más baratos.

---

## Diapositiva 3 - Descomposición e integración guiadas por un DAG

**Función narrativa**

Separar con precisión la pregunta principal, la hipótesis, la granularidad y los límites de lo demostrado.

**Qué debe comprender la audiencia**

El DAG jerárquico con contratos es la hipótesis de ingeniería; encontrar automáticamente la granularidad adecuada sigue siendo una línea exploratoria.

**Mensaje imprescindible**

> El DAG con contratos es la hipótesis; la granularidad adaptativa óptima no es un resultado demostrado.

**Guion oral completo**

> La pregunta principal fue: ¿puede una arquitectura basada en descomposición jerárquica, ejecución coordinada e integración bottom-up hacer abordables funcionalidades difíciles de resolver como una única tarea agentic lineal?
>
> Mi hipótesis de ingeniería es que representar el trabajo como un DAG jerárquico con contratos explícitos permite acotar unidades, identificar dependencias, habilitar paralelismo seguro y recomponer resultados de forma controlada. Para implementarla separé lo que propone el modelo de los mecanismos deterministas que fijan identidad, contratos, scheduling y adopción.
>
> Hay una segunda pregunta: la granularidad. Una división gruesa reduce coordinación, pero deja tareas grandes y heterogéneas. Una división muy fina simplifica cada hoja, pero multiplica contratos, dependencias e integración. Dividir más no siempre es mejor. El código de descomposición incluye un modo `auto` y una rúbrica local por rama, pero el pipeline productivo que presento no constituye una política adaptativa completa ni evaluada. No sostengo que calcule un óptimo: su evaluación comparativa queda como trabajo futuro.

**Ancla de emergencia**

> Hipótesis: DAG jerárquico + contratos. Granularidad óptima: no demostrada.

**Transición**

> Con esa hipótesis, el objetivo fue construir y evaluar un run completo, no maximizar el número de agentes.

**Tiempo objetivo:** 1:00. **Checkpoint:** deberías estar cerca de `2:25`.

**Versión abreviada**

> La hipótesis es que un DAG jerárquico con contratos permite dividir, coordinar y recomponer trabajo complejo. La granularidad introduce un trade-off real; `auto` existe como heurística, pero su evaluación adaptativa completa queda pendiente.

**Repreguntas probables**

- ¿Cómo decide hoy cuándo una tarea es atómica?
- ¿Qué evidencia faltaría para afirmar que `auto` es mejor?

**Respuesta técnica corta:** Hoy existe una heurística local; demostrar una política adaptativa exigiría comparar calidad, costo, latencia y fallos con distintas granularidades.

**Evitar:** hablar de granularidad óptima, autoajuste probado o resultados estadísticos inexistentes.

---

## Diapositiva 4 - Un run planificado, ejecutado, validado e integrado

**Función narrativa**

Delimitar objetivos y alcance implementado.

**Qué debe comprender la audiencia**

El producto es un run supervisable de extremo a extremo, dentro de un alcance local-first y single-host.

**Mensaje imprescindible**

> El alcance probado es local-first y single-host; cloud y distribución son transferencia, no implementación actual.

**Guion oral completo**

> El objetivo general fue diseñar e implementar un sistema que transforme un objetivo de desarrollo en un run planificado, ejecutado, validado, integrado y supervisable.
>
> Eso se desglosa en cuatro objetivos: planificar con evidencia del repositorio; producir un grafo ejecutable con contratos; coordinar ejecución aislada y concurrente; y conservar persistencia, validación, integración y recuperación observables.
>
> El alcance implementado es deliberadamente local-first y single-host. Los agentes se ejecutan mediante CLIs, el aislamiento usa Git worktrees, la persistencia durable es local con JSON y JSONL y la supervisión se hace desde una interfaz web. No implementé infraestructura cloud, ejecución distribuida, multi-tenancy ni un sandbox de seguridad fuerte. Tampoco presento la granularidad adaptativa completa como terminada.

**Ancla de emergencia**

> Run completo; local-first; worktrees; JSONL; web; sin cloud ni multi-host.

**Transición**

> Para llegar a ese sistema trabajé de forma incremental y diferencié cuidadosamente los niveles de evidencia.

**Tiempo objetivo:** 1:00.

**Versión abreviada**

> Construí el ciclo del run desde planificación hasta delivery, con ejecución local aislada, persistencia durable y supervisión web; no implementé cloud ni multi-host.

**Repreguntas probables**

¿Qué quedó fuera de alcance? ¿Qué parte trasladarías primero a AWS?

**Respuesta técnica corta:** El límite actual es operativo: un host y almacenamiento local; los contratos permiten razonar una distribución futura sin afirmar que ya existe.

**Evitar:** confundir diseño transferible con infraestructura desplegada.

---

## Diapositiva 5 - Incremental, con decisiones y evidencia registradas

**Función narrativa**

Explicar la metodología de desarrollo y cómo se construyó evidencia.

**Qué debe comprender la audiencia**

Las decisiones se registraron y las garantías se verificaron en capas; test, smoke y trabajo futuro no se mezclan.

**Mensaje imprescindible**

> Cada afirmación se presenta con el nivel de evidencia que realmente la sostiene.

**Guion oral completo**

> La metodología fue desarrollo incremental por vertical slices. En lugar de una reescritura total, fui cerrando recorridos observables: primero contratos, después coordinación y persistencia, luego ejecución, integración y delivery.
>
> Las decisiones arquitectónicas importantes quedaron registradas en ADRs con contexto, alternativas y consecuencias. Cada cambio de comportamiento tuvo tests: unitarios para políticas, integración con filesystem y Git reales, boundaries de dependencias y E2E de dominio. También audité la ruta productiva con journals persistidos y smokes manuales usando CLIs reales.
>
> Durante la evaluación mantuve tres etiquetas: verificado por tests, observado en smoke y pendiente. Eso evita convertir una fixture visual o una inferencia de diseño en evidencia de ejecución productiva. El trade-off del enfoque incremental es convivir temporalmente con nombres y deuda residual, pero permitió reemplazar decisiones insuficientes sin perder el sistema entero.

**Ancla de emergencia**

> Vertical slices + ADRs + tests por capas + smokes auditados.

**Transición**

> Con esa metodología, el recorrido completo de un run quedó así.

**Tiempo objetivo:** 1:05.

**Versión abreviada**

> Trabajé por vertical slices, registré decisiones en ADRs y separé tests automatizados, smoke productivo, fixture visual y trabajo futuro.

**Posibles preguntas técnicas**

- ¿Qué cubre exactamente el E2E?
- ¿Qué aprendiste de una decisión que luego retiraste?

**Respuesta técnica corta:** El E2E automatizado prueba el dominio coordinado con adapters controlados; el smoke usa la ruta productiva real, pero hoy sólo está observado hasta `needs_approval`.

**Evitar:** usar “E2E completo” sin describir qué recorrido y qué adapters cubre.

---

## Diapositiva 6 - Flujo completo de un run

**Función narrativa**

Dar el mapa mental que organiza el resto de la explicación.

**Qué debe comprender la audiencia**

El run avanza desde evidencia del repositorio hasta una entrega confirmada; la captura muestra una proyección de esa historia.

**Mensaje imprescindible**

> Goal → inspection → planning → compilation → approval → scheduling → execution → validation → integration → delivery.

**Guion oral completo**

> Este es el flujo que conviene retener: `Goal → repository inspection → planning → graph compilation → approval → scheduling → execution → validation → bottom-up integration → delivery`.
>
> Primero se captura un `RepositorySnapshot`. El planner propone una división semántica y un compiler determinista la convierte en un grafo con contratos. Una persona aprueba una revisión concreta. El scheduler deriva qué nodos están listos y selecciona waves. Cada intento trabaja sobre una base aislada; luego se valida su candidate commit y, si sigue vigente, se adopta su resultado. Los composites integran esos artifacts de abajo hacia arriba. La raíz se valida otra vez y solo después puede publicarse.
>
> La captura es la demostración visual principal durante esta exposición. Muestra el mismo cockpit que consume los eventos de un run, con estados por nodo, decisiones y lentes para artifacts, contracts y conflicts. No necesito abrir una demo dentro de los 15 minutos; la fixture queda disponible para preguntas.

**Ancla de emergencia**

> Inspeccionar → planificar → compilar → aprobar → ejecutar → validar → integrar → entregar.

**Transición**

> Ahora voy a profundizar primero en cómo una propuesta del planner se vuelve un plan ejecutable.

**Tiempo objetivo:** 1:20. **Checkpoint:** deberías estar cerca de `5:50`.

**Versión abreviada**

> El run inspecciona, planifica, compila y aprueba; después agenda, ejecuta, valida, integra bottom-up y entrega. La UI es una proyección de esa historia, no su autoridad.

**Repreguntas probables:** ¿Dónde se detiene el flujo? ¿Qué hace canónico al run?

**Respuesta técnica corta:** Se detiene en gates explícitos como aprobación, evidencia insuficiente o resultado stale; el journal conserva la historia canónica.

**Evitar:** narrar la captura como evidencia de una ejecución real de agentes.

---

## Diapositiva 7 - El planner propone; el Graph Compiler produce el plan ejecutable

**Función narrativa**

Explicar la frontera entre modelo probabilístico y dominio ejecutable.

**Qué debe comprender la audiencia**

El modelo propone semántica; Zod, el compiler y los critics impiden que esa propuesta gobierne directamente el runtime.

**Mensaje imprescindible**

> El planner propone un `WorkBreakdown`; el Graph Compiler determinista produce una `GraphRevision` validada.

**Guion oral completo**

> El planner recibe el goal y un `RepositorySnapshot`, es decir, evidencia estructurada vinculada al estado real del repositorio. Devuelve un `WorkBreakdown`: unidades, objetivos, evidencia observada, paths planificados, posibles artifacts, seams e incertidumbres.
>
> Esa salida cruza una frontera no confiable. Zod valida en runtime que tenga la forma e invariantes estructurales esperadas; si es inválida, no entra al dominio. Después el Graph Compiler, que es determinista, asigna identidades y produce una `GraphRevision` inmutable, bundles de contratos y relaciones tipadas. Los critics revisan completitud, atomicidad, scopes, aceptación y coherencia.
>
> `parentId` define quién integra; `ArtifactRequirement` expresa qué output material debe existir y puede afectar readiness; `SeamBinding` fija compatibilidad entre productores y consumidores sin imponer orden; y `ConflictConstraint` restringe una wave por riesgo sin inventar una dependencia funcional.
>
> Así, el modelo ayuda a comprender el problema, pero no controla lifecycle, scheduling ni persistencia.

**Ancla de emergencia**

> Snapshot + WorkBreakdown → Zod → compiler → GraphRevision + contracts + critics.

**Transición**

> Una vez aprobada la revisión, esas relaciones se convierten en condiciones concretas de ejecución.

**Tiempo objetivo:** 1:25.

**Versión abreviada**

> El planner propone un `WorkBreakdown` grounded. Zod protege la frontera; el compiler determinista genera `GraphRevision`, contratos y relaciones tipadas; los critics revisan coherencia.

**Repreguntas probables**

- ¿Qué valida Zod y qué queda para validadores algorítmicos?
- ¿Por qué un `SeamBinding` no es una dependencia?
- ¿Cómo se distinguen paths observados de paths futuros?

**Respuesta técnica corta:** Zod valida la forma en runtime y el compiler fija identidades, relaciones e invariantes; los critics agregan revisiones algorítmicas antes de ejecutar.

**Evitar:** decir que Zod vuelve determinista al LLM o que todas las aristas significan dependencia.

---

## Diapositiva 8 - Ejecución aislada y adopción de resultados

**Función narrativa**

Mostrar cómo se obtiene paralelismo sin mezclar estado ni adoptar trabajo obsoleto.

**Qué debe comprender la audiencia**

Un agente puede proponer cambios; el orquestador decide qué inputs recibe, qué cambió realmente y si el resultado todavía es adoptable.

**Mensaje imprescindible**

> Un exit code exitoso sólo produce un candidato; scope y `InputFingerprint` deciden si todavía puede adoptarse.

**Guion oral completo**

> El scheduler deriva readiness a partir de artifacts, decisiones, base materializable, conflictos, recursos y disponibilidad del executor. Luego persiste una wave antes del dispatch. Eso permite paralelismo solamente cuando las condiciones lo justifican.
>
> Para cada intento se construye una `ExecutionBase`: commit base más únicamente los artifacts declarados. Se materializa en un Git worktree propio. El `InputFingerprint` hashea entradas node-locales —identidad del nodo, contratos, base, artifacts consumidos, contexto, perfil de executor y validación—, sin la revisión global del grafo, para que una enmienda ajena no invalide un nodo independiente; es la identidad semántica del attempt.
>
> Claude Code CLI o Codex CLI implementan el mismo puerto `AgentExecutor`. Su stdout es diagnóstico. La fuente de verdad sobre el cambio es `git diff`. El scope aplica una política deny-wins: un path prohibido invalida el intento. Si el cambio es válido, el orquestador crea el candidate commit.
>
> Antes de adoptar, compara el fingerprint producido con el vigente. Si cambiaron inputs, registra `attempt.stale` y descarta el resultado, aunque sus tests hayan pasado. Así se evita que un proceso tardío integre trabajo calculado sobre una realidad anterior.

**Ancla de emergencia**

> Readiness → wave → base exacta/worktree → diff/scope → candidate → fingerprint vigente.

**Transición**

> Adoptar un candidato todavía no completa el run: falta demostrarlo, integrarlo y entregar exactamente ese árbol.

**Tiempo objetivo:** 1:35. **Checkpoint:** deberías estar cerca de `8:50`; si ya pasaste `9:30`, activá las versiones de contingencia de 9–11.

**Versión abreviada**

> Cada attempt usa una base exacta y un worktree. Git define el diff, scope deny-wins protege límites y el orquestador crea el candidate. Si el fingerprint cambió, el resultado es stale y no se adopta.

**Repreguntas probables**

- ¿Un worktree es un sandbox?
- ¿Por qué el base commit no alcanza como fingerprint?
- ¿Cómo evita el sistema que un proceso viejo vuelva a escribir?

**Respuesta técnica corta:** Cada attempt usa una base y worktree propios; Git define el diff, scope aplica deny-wins y el fingerprint evita adoptar un resultado obsoleto.

**Evitar:** equiparar worktree con sandbox de seguridad o `result_ready` con `completed`.

---

## Diapositiva 9 - Integración bottom-up y evidencia sobre el commit exacto

**Función narrativa**

Narrar la secuencia causal desde candidato aislado hasta delivery y explicar recovery sin saturar de detalles de concurrencia.

**Qué debe comprender la audiencia**

La evidencia acompaña al commit exacto y la integración compone únicamente resultados adoptados; recovery depende de la causa.

**Mensaje imprescindible**

> La evidencia pertenece al SHA exacto; sólo resultados adoptados se integran y `completed` exige delivery confirmado.

**Guion oral completo**

> La secuencia empieza validando el SHA exacto del candidato en un entorno Git limpio. El `ValidationContract` define qué debe demostrarse y la `EvidenceMatrix` registra, por criterio, obligación, estado, justificación y referencias. Un comando verde sin vínculo con el criterio no alcanza.
>
> Si la evidencia es elegible y el fingerprint sigue vigente, el output se adopta en el `ArtifactRegistry`. Recién entonces puede ser consumido. Los composites integran bottom-up: cada padre recibe artifacts adoptados de sus hijos y produce un `IntegrationManifest` que declara la base, qué artifacts requería, cuáles aplicó, las operaciones realizadas, el candidate SHA y la evidencia del contrato padre. Esto evita que un cherry-pick sin conflicto textual sea confundido con compatibilidad semántica.
>
> La raíz produce un candidato final, se valida nuevamente y pasa a `result_ready`. Delivery congela manifest, SHA, branch, head y fingerprint del target; solo un `DeliveryReceipt` confirmado lleva a `completed`.
>
> Si algo falla, no existe un retry universal. Un transitorio habilita un nuevo attempt acotado; código o tests admiten una reparación; un contrato requiere enmienda; scope o resultado stale se descartan; integración puede tener una reparación semántica y luego escalar a una decisión. El journal append-only conserva cada intento. CAS, leases y fencing sostienen la autoridad, pero los dejaría para una pregunta de profundidad.

**Ancla de emergencia**

> SHA exacto → EvidenceMatrix → adopción → manifests bottom-up → validación final → receipt.

**Transición**

> Estas responsabilidades están implementadas con tecnologías concretas, pero ninguna librería sustituye las reglas del dominio.

**Tiempo objetivo:** 2:00.

**Versión abreviada**

> Se valida el SHA exacto y la `EvidenceMatrix` cubre cada criterio. Solo outputs elegibles y vigentes entran al registry. Los padres los integran bottom-up con un manifest explícito; la raíz se valida otra vez. `result_ready` es candidato verificado; `completed` exige receipt de delivery. Los fallos se recuperan por causa, no con un retry fijo.

**Versión de contingencia si la diapositiva 8 empezó después de 9:30**

> La cadena es: validar el SHA exacto, registrar una `EvidenceMatrix`, adoptar solo resultados vigentes, integrar artifacts bottom-up con manifests y validar la raíz. `result_ready` no es entrega: `completed` exige un receipt confirmado. Recovery se elige por causa; un resultado stale o con una violación prohibida de scope se descarta.

**Repreguntas probables**

- ¿Qué diferencia hay entre `ValidationContract` y recipe?
- ¿Cómo se recupera delivery si hubo crash después del side effect?
- ¿Qué cubren CAS, lease y fencing?

**Respuesta técnica corta:** Se valida el candidate SHA, la matriz vincula criterios con evidencia, el registry adopta outputs vigentes y los manifests recomponen bottom-up; recovery cambia según la causa.

**Evitar:** saturar esta diapositiva con CAS, leases y fencing; usar el respaldo R3 si preguntan.

---

## Diapositiva 10 - Tecnologías atadas a responsabilidades concretas

**Función narrativa**

Relacionar cada tecnología con una responsabilidad comprobable.

**Qué debe comprender la audiencia**

Las librerías son adapters o herramientas; el dominio conserva identidad, lifecycle y políticas.

**Mensaje imprescindible**

> Cada tecnología tiene una responsabilidad concreta; ninguna es la autoridad del lifecycle.

**Guion oral completo**

> TypeScript cubre el monorepo y, en los boundaries críticos, los tipos se derivan de schemas runtime. Zod valida HTTP, salida de modelos, eventos, SSE y disco. Next.js aporta transporte y composition root; React compone el workspace y React Flow renderiza la proyección del grafo.
>
> Git es la autoridad sobre diffs y commits; `simple-git` es el adapter para worktrees e integración. Claude Code CLI y Codex CLI son perfiles intercambiables de `AgentExecutor`. Vitest cubre unitarios, integración con Git real, boundaries y E2E de dominio. JSON y JSONL soportan metadata, journal durable, checksums y replay.
>
> LangGraph tuvo uso histórico con `StateGraph` y checkpoints, pero fue retirado de la ruta productiva al consolidar el lifecycle en `RunCoordinator`. No lo presento como orquestador actual; el trade-off completo está en respaldo.

**Ancla de emergencia**

> Zod valida; Next transporta; React proyecta; Git verifica cambios; CLIs ejecutan; Vitest demuestra; JSONL conserva historia.

**Transición**

> Cierro separando qué quedó verificado, qué solo fue observado y qué sigue pendiente.

**Tiempo objetivo:** 1:00.

**Versión abreviada**

> TypeScript y Zod tipan y validan boundaries; Next, React y React Flow transportan y proyectan; Git y las CLIs ejecutan; Vitest verifica y JSONL conserva historia. LangGraph es histórico.

**Versión de contingencia si la diapositiva 8 empezó después de 9:30**

> Zod protege boundaries; Next y React componen la web; React Flow dibuja; Git y `simple-git` aíslan e integran; las CLIs implementan `AgentExecutor`; Vitest y JSONL aportan verificación y replay. LangGraph es histórico, no actual.

**Repreguntas probables**

- ¿Por qué Zod si ya existe TypeScript?
- ¿Qué equivalencia usarías en Python?
- ¿Por qué retirar LangGraph y cuándo lo volverías a usar?

**Respuesta técnica corta:** El dominio define puertos e invariantes; las librerías se pueden reemplazar sin duplicar estado ni autoridad.

**Evitar:** decir que LangGraph orquesta actualmente ManyHands o que TypeScript valida datos externos por sí solo.

---

## Diapositiva 11 - Resultados y límites actuales

**Función narrativa**

Cerrar con evidencia precisa, contribuciones y límites defendibles.

**Qué debe comprender la audiencia**

La arquitectura y sus invariantes tienen evidencia automatizada; la validación productiva completa y la operación distribuida todavía no.

**Mensaje imprescindible**

> Hay factibilidad e invariantes verificadas, pero no un benchmark de productividad ni un smoke real completo hasta delivery.

**Guion oral completo**

> Los resultados deben leerse por nivel de evidencia. En tests está verificado el recorrido de dominio hasta `result_ready`: compilación del grafo, waves, ejecución de hojas, artifacts e integración. Tests separados cubren delivery, receipt, crash recovery, Git real, worktrees, scope, CAS y fencing. La auditoría del 18 de julio registró 156 archivos, 915 tests pasados y uno skipped; es una fotografía de ese corte, no una métrica viva. En la revalidación de hoy el worktree actual ejecutó 163 archivos: 945 tests pasaron, dos regresiones de UI fallaron y uno quedó skipped. Por eso no presentaría el árbol actual como completamente verde.
>
> En smoke productivo observé planning greenfield con Claude Code CLI, nodos progresivos, decisiones durables, replan y llegada a `needs_approval`. No ejecuté todavía un smoke manual completo con CLIs reales hasta delivery. El streaming fuerte está demostrado para Claude; con Codex la granularidad útil de stdout sigue siendo parcial.
>
> La contribución arquitectónica es una única autoridad de lifecycle independiente de frameworks, adopción segura por fingerprint, evidencia ligada al commit y recovery por causa. Los límites son local-first, single-host, worktrees sin sandbox fuerte, sin multi-tenancy ni distribución, y granularidad adaptativa completa todavía futura.
>
> Mi conclusión es acotada: la implementación muestra que el DAG jerárquico y los contratos permiten convertir una funcionalidad grande en unidades coordinables y recomponerlas con control y evidencia. No demuestra que varios agentes siempre sean más productivos que uno. Hasta acá llega la exposición principal; dejo las diapositivas siguientes solo para preguntas.

**Ancla de emergencia**

> Tests: dominio y garantías. Smoke: planning hasta aprobación. Pendiente: smoke real hasta delivery, sandbox, distribución y evaluación de granularidad.

**Cierre**

> Estas son las decisiones técnicas que implementé, las garantías que pude verificar y los límites que todavía conserva el sistema. Quedo atento a las preguntas.

**Transición:** fin de la exposición principal; no avanzar automáticamente a los respaldos.

**Tiempo objetivo:** 1:45. **Checkpoint final:** `13:35`, con margen hasta 15 minutos.

**Versión de contingencia si la diapositiva 8 empezó después de 9:30**

> Los tests verifican el recorrido de dominio, delivery y recovery. La auditoría fechada registró 156 archivos, 915 tests y uno skipped. El smoke real llegó hasta `needs_approval`, no hasta delivery. El sistema sigue siendo local-first, single-host y sin sandbox fuerte; la granularidad adaptativa completa es futura. La conclusión es factibilidad con garantías acotadas, no superioridad estadística frente a un único agente.

**Versión abreviada**

> Los tests verifican el dominio y sus garantías; el smoke productivo llegó hasta aprobación, no hasta delivery. La contribución es factibilidad con evidencia y límites explícitos, no superioridad estadística frente a un agente único.

**Repreguntas probables**

- ¿Qué significa exactamente “E2E de dominio”?
- ¿Qué harías primero para acercarlo a producción?
- ¿Cómo trasladarías estas invariantes a Python y AWS?

**Respuesta técnica corta:** Los tests demuestran invariantes del dominio y la auditoría productiva llega hasta aprobación; quedan pendientes el smoke CLI-to-delivery, sandbox fuerte, distribución y evaluación comparativa de granularidad.

**Evitar:** convertir métricas fechadas en estado vivo o afirmar superioridad estadística sobre un único agente.

**Dato de respaldo sobre la suite actual**

- `typography-scale.test.ts`: detecta dos clases de espaciado fuera de escala en el cockpit y la fixture.
- `run-loading-skeleton.test.ts`: detecta drift entre el skeleton y el header actual.
- Son fallos del worktree vigente y no fueron causados por estos documentos; no ocultarlos si preguntan por la última ejecución.

---

## Diapositivas de respaldo

No avanzar automáticamente desde la diapositiva 11. Abrir una de estas diapositivas solo si responde una pregunta concreta.

## Respaldo R1 - Fragmentos de código y tests

**Usar si preguntan por evidencia directa en código.**

**Pregunta que lo activa:** “¿Dónde se ve esa garantía en código o en un test?”

**Elemento para señalar:** el fragmento correspondiente a fingerprint, fold o delivery; elegir uno, no leer los tres.

**Tiempo máximo:** 1:30.

- Fingerprint: orden canónico de contratos y artifacts antes de hashear.
- Coordinator: `foldRun` valida la transición antes del append.
- Delivery: branch y head deben coincidir con la aprobación congelada.

Frase de entrada:

> Acá hay tres ejemplos donde la garantía no queda en una descripción: identidad estable, transición válida antes de persistir y publicación exacta del candidato aprobado.

**Retorno al cierre:** “Estos tests son la evidencia automatizada de las invariantes que resumí; el límite productivo sigue siendo el smoke real hasta delivery.”

## Respaldo R2 - Evolución de LangGraph y trade-offs

**Usar si preguntan por LangGraph, checkpoints o por qué fue retirado.**

**Pregunta que lo activa:** “¿Por qué no usás LangGraph actualmente?”

**Frase de entrada:** “Lo usé en una arquitectura anterior; la decisión importante fue evitar múltiples autoridades sobre el lifecycle.”

**Elemento para señalar:** la transición desde checkpoints y estado duplicado hacia `RunCoordinator` + journal canónico.

**Tiempo máximo:** 1:30.

> `StateGraph` y checkpoints participaron de una arquitectura anterior. El problema fue la coexistencia de checkpoints, `RunRecord`, journal y UI como posibles autoridades. El lifecycle se movió a un `RunCoordinator` independiente de frameworks y el journal quedó como historia canónica. Los StateGraphs productivos se retiraron en `c5a4f99`. LangGraph podría volver como adapter si aporta branching o interrupts sin duplicar estado ni autoridad.

Trade-off:

- costo: más código de dominio, reducer y replay propios;
- ganancia: una autoridad testeable, historia auditable y snapshots descartables.

**Retorno al cierre:** “No es un rechazo a la librería: podría volver como adapter si no duplica estado ni autoridad.”

## Respaldo R3 - Matriz de recuperación y limitaciones operativas

**Usar si preguntan por retries, crash recovery, seguridad o producción.**

**Pregunta que lo activa:** “¿Qué ocurre si un worker o el coordinador falla?”

**Frase de entrada:** “No aplico un retry universal: primero clasifico la causa y después elijo una acción válida.”

**Elemento para señalar:** una fila de recovery y la separación entre CAS, lease y fencing.

**Tiempo máximo:** 2:00.

> La política comienza por la causa: transitorio, entorno, código, contrato, dependencia, scope, integración o infraestructura. Cada clase habilita acciones distintas. CAS evita ganar la misma secuencia; el lease asigna owner operativo; fencing rechaza al owner viejo. Ninguno reemplaza al otro.

Límites que deben quedar explícitos:

- latencia del planner aún sin medición visible estable;
- streaming progresivo fuerte solo con Claude Code CLI;
- smoke productivo hasta delivery pendiente;
- worktrees sin aislamiento de seguridad fuerte;
- single-host y sin multi-tenancy.

**Retorno al cierre:** “Estas garantías contienen fallos dentro del alcance local; distribución y sandbox fuerte siguen siendo trabajo futuro.”

---

## Tarjeta compacta para la segunda pantalla

```text
1  Qué es: objetivo → DAG jerárquico → resultado verificable
2  Problema: una feature cruza API, dominio, datos, UI y tests
3  Hipótesis: DAG + contracts; granularidad óptima NO demostrada
4  Alcance: run completo, local-first, single-host
5  Método: slices + ADRs + tests + auditorías
6  Flujo: inspect → plan → compile → approve → execute → validate → integrate → deliver
7  Planner propone; Zod protege; compiler fija; critics revisan
8  readiness → worktree → diff/scope → candidate → fingerprint
9  SHA exacto → matrix → registry → manifests → receipt
10 Tech por responsabilidad; LangGraph histórico
11 tests ≠ smoke ≠ fixture ≠ futuro; cerrar y esperar preguntas
   auditoría 18/07: 915 verdes; revalidación 19/07: 945 verdes, 2 UI rojos, 1 skip
```

### Control de tiempo

- `5:50`: comenzar diapositiva 7.
- `8:50`: comenzar diapositiva 9.
- Si la diapositiva 8 empieza después de `9:30`: abreviar 9, 10 y 11.
- `13:35`: cierre.

### Transiciones en una línea

1. Una feature no es una tarea.
2. Eso lleva a la hipótesis del DAG.
3. La hipótesis define objetivos y límites.
4. Los objetivos se trabajaron incrementalmente.
5. La metodología produjo este flujo.
6. Primero: planificación ejecutable.
7. Después: ejecución y adopción.
8. Luego: evidencia, integración y delivery.
9. Las librerías cumplen responsabilidades concretas.
10. Cierro con evidencia y límites.

## Frases que conviene evitar

| Evitar | Reemplazar por |
|---|---|
| “ManyHands calcula la granularidad óptima.” | “Existe una heurística `auto`; la política adaptativa completa y su evaluación son trabajo futuro.” |
| “Varios agentes son siempre mejores.” | “La arquitectura busca hacer abordable trabajo que cruza límites; no demuestra superioridad universal.” |
| “LangGraph orquesta ManyHands.” | “LangGraph tuvo uso histórico; hoy el lifecycle pertenece a `RunCoordinator`.” |
| “Zod garantiza que el plan es correcto.” | “Zod valida la frontera; compiler, validators y critics aplican semántica.” |
| “El worktree es un sandbox.” | “El worktree aísla Git; no restringe red, secretos ni filesystem externo.” |
| “El E2E prueba producción completa.” | “El E2E automatizado cubre un recorrido de dominio; el smoke real documentado llegó a `needs_approval`.” |
| “915 tests prueban calidad.” | “La auditoría fechada registró esa suite; la evidencia relevante está en qué invariantes cubren.” |
| “La fixture ejecuta agentes.” | “La fixture reproduce eventos con el reducer y cockpit reales; no ejecuta efectos externos.” |
| “`result_ready` significa entregado.” | “`completed` exige un receipt confirmado del candidato aprobado.” |

## Evidencia de referencia para preguntas

- [Arquitectura implementada](../development/architecture.md)
- [Estrategias problema → mecanismo → evidencia](../development/problem-solving-strategies.md)
- [Uso real de librerías](../development/library-usage.md)
- [Decisiones vigentes](../DECISIONS.md)
- [ADR de frameworks y executors](../adr/0009-framework-and-executor-boundaries.md)
- [Auditoría productiva del 18/07/2026](../audits/v2-productive-run-audit-2026-07-18.md)
- [Planner semántico](../../packages/decomposer/src/planner/work-breakdown.ts)
- [Graph Compiler](../../packages/decomposer/src/compiler/graph-compiler.ts)
- [Run Coordinator](../../packages/run-coordinator/src/coordinator.ts)
- [InputFingerprint](../../packages/run-coordinator/src/domain/fingerprint.ts)
- [Adopción de attempts](../../packages/run-coordinator/src/domain/attempts.ts)
- [Evidence Matrix](../../packages/execution-core/src/validation/evidence-matrix.ts)
- [IntegrationManifest](../../packages/execution-core/src/integration/manifest.ts)
- [Delivery publisher](../../packages/execution-core/src/delivery/publisher.ts)
- [E2E de dominio](../../tests/run-v2-e2e.test.ts)
- [Crash recovery de delivery](../../tests/run-v2-crash-recovery.test.ts)
- [Boundary del coordinator](../../tests/run-coordinator-boundaries.test.ts)
- [Guion opcional de fixture](guion-demo-fixture.md)
