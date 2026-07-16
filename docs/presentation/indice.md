# Índice de la presentación — ManyHands

Artifact: [`manyhands-presentacion.html`](manyhands-presentacion.html).
Navegación: flechas izquierda/derecha para slides, click en el riel lateral.

Pensada para una charla de **10-15 minutos**: explicación general del sistema y de la
propuesta de cierre de tesis, con profundidad reservada para las preguntas. 10 slides
en total, en dos partes de un mismo deck.

**Parte I (slides 1-6) — el sistema construido.** Recorrido rápido: qué es, qué
problema resuelve, cómo se piensa el trabajo, cómo se ejecuta y se verifica, cómo
paraleliza e integra, y qué garantiza. Cada slide combina un diagrama con una o dos
afirmaciones fuertes, y las slides 3-5 incluyen pseudocódigo corto (la recursión del
decomposer, la forma de un contrato, el enum de veredicto, las reglas de la wave)
pensado para adelantar las preguntas más previsibles de alguien sin contexto del
proyecto — «¿cómo saben que dos tareas no chocan?», «¿cómo se arma el árbol?» — y así
minimizar lo que haya que explicar oralmente. El detalle que no entra en el slide
sigue en `apunte-tecnico-presentacion.md` y en las preguntas.

**Parte II (slides 7-10) — cierre de tesis con los profesores.** Cambia de registro:
ya no es «esto es así» sino «esto propongo, quiero su criterio». Muestra el estado
actual de las perillas de recursos (granularidad, routing), la propuesta de
automatizarlas (`auto v2` — sus ingredientes y por qué entra en el tiempo disponible)
y el diseño experimental para evaluarla, con su criterio de éxito ya explícito en el
slide. Las alternativas consideradas y no elegidas ya no son una slide: quedan como
material de respuesta si algún profesor pregunta por ellas
(`apunte-tecnico-cierre-tesis.md`, `guion-cierre-tesis.md`).

| # | Slide | Contenido y apoyo visual |
|---|-------|--------------------------|
| 1 | Qué es ManyHands | Mapa end-to-end en tres bandas: flujo `goal → DAG → waves → hojas → integración → branch`, gates humanos, y el event log como bus que alimenta reducer → selectors → UI |
| 2 | Qué problema resuelve | Tabla de mapeo 1:1: síntoma concreto → qué hace ManyHands → mecanismo en el repo |
| 3 | La unidad de trabajo | DAG de ejemplo (root/composite/leaf, estructura vs dependencia) + pseudocódigo de la recursión del decomposer (atomic/decompose/question) + forma del contrato + seam, con puntero a la slide 5 para la pregunta de colisión |
| 4 | Ejecución y verificación | Pipeline `contract → worktree → executor → recorder → result` + el enum `AgentResultStatus` + los tres pasos condensados del veredicto — «stdout explica, el diff decide» |
| 5 | Paralelismo e integración | Frontera de wave (seleccionadas / bloqueada con razón) + las cuatro reglas por las que dos tareas no comparten wave, junto a cherry-pick + repair con contexto — el scheduler decide qué corre junto, el integrador cómo se combina |
| 6 | Garantías y límites | Tabla garantía → mecanismo + límites actuales + por qué el fallo es visible + transición explícita hacia la Parte II |
| 7 | Parte II — Cierre de tesis | Marco: tres perillas de recursos (granularidad, modelo, esfuerzo), quién decide hoy vs. objetivo, con el alcance de cada una ya declarado + hoja de ruta de las slides 8-10 + por qué esto es tema de tesis y no una feature más |
| 8 | Estado actual (v1) | Granularidad `auto` y routing por complejidad tal como existen hoy: mecanismo, cita literal de la rúbrica, por qué son heurísticas sin evidencia, y puntero explícito a la propuesta de la slide 9 |
| 9 | Propuesta: auto v2 | Comparación v1 vs. v2 del juicio de atomicidad + los tres ingredientes de la propuesta (prior determinista, rúbrica cost-aware, feedback del corpus como stretch) + un bloque de «cómo se implementa» (factibilidad) + qué queda afuera a propósito |
| 10 | Evaluación | Cuatro brazos (auto v2 / auto v1 / balanced / random), 40 runs, criterios del corpus, métricas ya instrumentadas (`GranularityVector`), criterio de éxito explícito, curva conceptual del sweet spot |

Documentos complementarios:

- [`apunte-tecnico-presentacion.md`](apunte-tecnico-presentacion.md) — apunte de estudio de la Parte I, por slide, con modelo mental, matices y preguntas probables.
- [`apunte-tecnico-cierre-tesis.md`](apunte-tecnico-cierre-tesis.md) — apunte de estudio de la Parte II: estado actual verificado de granularidad y routing, la propuesta `auto v2`, diseño experimental completo, catálogo de hipótesis y preguntas probables.
- [`evidencia-tecnica.md`](evidencia-tecnica.md) — rutas, símbolos, tests y relaciones entre componentes (Parte I) — la referencia a usar si preguntan «¿dónde está eso implementado?».
- [`guion-exposicion.md`](guion-exposicion.md) — versión corta y conversacional para la Parte I, con qué señalar en cada visual.
- [`guion-cierre-tesis.md`](guion-cierre-tesis.md) — guion de exposición de la Parte II: qué decir y señalar en cada slide, y cómo manejar la conversación con los profesores.
- [`afirmaciones-no-verificadas.md`](afirmaciones-no-verificadas.md) — qué no se verificó por completo, en ambas partes.
