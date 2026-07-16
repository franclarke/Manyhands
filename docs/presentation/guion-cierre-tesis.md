# Guion de exposición — Parte II: cierre de tesis

Soporte: slides 7-10 de `manyhands-presentacion.html`. Este tramo es distinto a
la parte I: ya no estás mostrando lo construido, estás **proponiendo un plan y
pidiendo feedback**. El tono cambia de «esto es así» a «esto es lo que pienso
hacer y quiero su criterio». Material de estudio: `apunte-tecnico-cierre-tesis.md`.

Regla del tramo: separar siempre con claridad **estado actual** (verificado en
código) de **propuesta** (trabajo futuro). Los profesores tienen que salir
sabiendo exactamente qué existe y qué se promete.

Ritmo: esta parte es la más importante de la charla — puede llevarse algo más de
tiempo por slide que la Parte I (~1.5-2 min c/u), dentro del total de 10-15 minutos.

---

## Slide 7 — De perillas manuales a decisiones del sistema

Transición desde la parte I: el slide 6 ya cerró con «esto es lo construido, lo que
sigue es la propuesta» — no hace falta repetirla, solo seguir el hilo.

La frase a fijar: **el sistema tiene tres perillas de recursos — cuánto
descomponer, cuánto modelo gastar, cuánto razonar — que hoy gira el usuario. La
propuesta es que las gire el sistema, y medir si eso mejora el resultado.**

Señalar en el diagrama:
- las tres filas (granularidad / modelo / esfuerzo) y la columna «hoy»;
- el alcance ya declarado en la columna «objetivo»: fila 1 = contribución
  principal, fila 2 = evaluación preliminar (ya existe una v1), fila 3 =
  extensión declarada. Esto preempta «¿van a hacer todo eso en un mes?» — no:
  una contribución profunda, una secundaria, una declarada.

Debajo del diagrama el slide ya trae dos líneas que antes solo estaban en este
guion — leerlas o parafrasearlas resuelve dos preguntas antes de que las hagan:
- **la hoja de ruta explícita**: «08 diagnostica el estado actual · 09 propone
  auto v2 · 10 el diseño para medirlo» — deja claro desde acá cómo se arma el resto
  de la charla, sin que quede implícito.
- **por qué esto es tema de tesis**: routing de modelos y esfuerzo ya lo exploran
  los labs; la granularidad de descomposición para un enjambre de agentes está
  mucho menos explorada, y ManyHands es un vehículo raro para estudiarla porque
  todo el pipeline es sensible al tamaño de las hojas. Preempta «¿esto no lo hacen
  ya los labs?» antes de que la charla llegue al slide 10.

## Slide 8 — Estado actual (v1)

Tono: diagnóstico, no autocrítica. Las v1 son deliberadamente simples.

Columna izquierda (granularidad):
- explicar dónde vive la decisión: un juicio LLM por nodo, ¿atómico o partir?,
  sesgado por una rúbrica de «unidad cohesiva»; sin targets de profundidad;
- **leer la cita de la rúbrica en voz alta** — es el momento más elocuente del
  slide: la política de granularidad adaptativa hoy es un párrafo de prompt que
  dice «you choose»;
- rematar con el detalle de ciudadano de segunda (replan la degrada, el event
  log la registra como medium): muestra lectura fina del propio código.

Columna derecha (routing):
- el scorer existe, es determinista y explicable, y escala en repairs;
- el punto que importa: **nunca calibrado, nunca evaluado, y puenteado en el
  camino productivo** (un run con modelo fijo no consulta al router).

Cierre del slide: ya está escrito abajo de las dos columnas — «ambas son
heurísticas razonables para una v1, ninguna decide con evidencia, eso es lo que
propone arreglar y medir auto v2» — con puntero directo a la slide 9. No hace
falta improvisar el cierre, solo señalarlo.

## Slide 9 — Propuesta: auto v2

La idea en una frase: **hoy la decisión de atomicidad solo ve el texto del
goal; la propuesta es que vea un prior estructural del repo y el costo de
partir.** El slide ya trae esa frase como lead, con «atomicidad» definida en el
momento (la pregunta que se repite en cada nodo del árbol, slide 3).

Recorrer el diagrama de arriba hacia abajo:
- banda v1 (atenuada): goal → juicio «you choose» → atomic/split;
- banda v2: al mismo juicio le entran dos cosas nuevas (cobre): el prior
  determinista con señales del repository-index, y el costo de partir
  (+integración, +conflicto).

Debajo del diagrama, el slide ya trae dos columnas que antes solo estaban en la
cabeza de quien presenta — ahora se leen, no se improvisan:

**Izquierda — «las ideas propuestas» (los tres ingredientes):**
1. prior determinista en planning (función pura, misma filosofía que el scorer
   de routing, con señales del repository-index);
2. rúbrica consciente del costo (las dos fuerzas: hojas grandes fallan más, cada
   split agrega integración y conflicto);
3. feedback del corpus, marcado explícitamente como **stretch** — no
   comprometido para el mes.

**Derecha — «cómo se implementa» (el argumento de factibilidad, ya no reservado
para si preguntan):**
- el prior es función pura → TDD directo, sin LLM en los tests;
- el canal ya existe: `buildStepPrompt` ya recibe hints del repo, agregar
  evidencia estructurada extiende un prompt builder ya testeado;
- no toca executor, recorder, scheduler ni integración — cambio acotado al
  decomposer.

Debajo, el recuadro «qué queda afuera» — preempta tres preguntas: no hay
RL/fine-tuning, routing es secundario, esfuerzo es extensión.

## Slide 10 — Evaluación

Empezar por la tabla de brazos, leyéndola como preguntas encadenadas:
- auto v2: ¿decidir con evidencia mejora?
- auto v1: ¿cuánto aporta la evidencia sobre la rúbrica pelada?
- balanced: ¿la automatización iguala al mejor ajuste manual?
- random: ¿la decisión importa siquiera? (piso de control, no rival serio)

Después la aritmética, sin dramatizar: 40 runs, 1 por ventana de cuota de ~5 h. El
slide ya agrega el criterio de diseño del corpus (5 features que admitan cortes
claramente distintos, con validación real ejecutable, congelado antes de correr el
primer brazo) — leerlo resuelve de entrada «¿no están sesgando el corpus?».

Del lado derecho, además de la curva y `GranularityVector`, el slide ya trae el
criterio de éxito escrito: **auto v2 iguala o supera al mejor ajuste manual por
feature —sin conocerlo de antemano— a costo igual o menor, y domina claramente a
random.** Es la definición operativa de «ganar» — señalarla en vez de definirla en
vivo.

Dos énfasis obligatorios:
1. **El instrumento ya existe**: `GranularityVector` se computa hoy por cada
   run (hojas, éxito, conflictos, costo, duración). No hay que construir
   aparato de medición.
2. **El diseño está blindado**: si auto v2 no gana, los brazos fijos igual
   trazan la curva del sweet spot, y hay estudios observacionales gratis sobre
   los mismos runs (falso éxito del agente, precisión del predictor de
   conflictos) que garantizan resultados empíricos sí o sí.

La curva de la derecha: presentarla como *lo que esperamos encontrar* — está
rotulada «ilustración conceptual, sin datos todavía». No dejar que nadie la lea
como resultado.

## Cierre y pedido de feedback

No hay una slide dedicada al cierre — después del slide 10, cortar el recorrido de
slides e invitar directamente a la conversación. Si la charla no las fue tocando ya,
estas cuatro preguntas sirven de guía, de más estratégica a más táctica:

1. Alcance: ¿este cierre — mecanismo + evaluación comparativa — es suficiente y
   defendible como tesis?
2. Rigor: ¿40 runs con distribuciones y análisis honesto alcanza, o esperan otro
   nivel de repetición?
3. Corpus: ¿features diseñadas sobre repos controlados, o prefieren que incluya
   un repo real?
4. Riesgo aceptado: si auto v2 no supera a v1, ¿el estudio comparativo honesto +
   la curva del sweet spot vale como resultado?

La cuarta es la más importante de destrabar: define si el plan tiene red de
seguridad académica ante los profesores. No hace falta leerlas todas si la
conversación ya las cubrió — son red de contención si el silencio se extiende, no
un checklist a recitar.

---

## Manejo de la conversación

- **Cuándo abrir el apunte**: si piden detalle de implementación (la rúbrica
  completa, el scorer señal por señal, el flujo GranularityMode →
  Aggressiveness), la referencia es `apunte-tecnico-cierre-tesis.md` — no
  intentar recitarlo.
- **Si cuestionan el N**: el límite es la cuota (1 run/~5 h), está declarado, y
  el tipo de análisis (distribuciones + auditoría por evidencia) está elegido
  para ese N. No prometer más corridas.
- **Si piden la comparación contra un agente único**: reconocerla como la
  pregunta natural — no es una slide en esta versión; está en el catálogo de
  alternativas del apunte técnico (sección 6) con su razón: duplica corridas y
  es difícil de diseñar justa. Ofrecerla como estudio de contraste futuro con N
  chico si el tribunal la considera necesaria.
- **Si preguntan por otras hipótesis descartadas** (seams reducen conflictos,
  scheduling risk-aware, crash-resume, worktrees vs. árbol compartido): el
  catálogo completo con la razón de cada descarte está en
  `apunte-tecnico-cierre-tesis.md`, sección 6. Ninguna está descartada como
  trabajo futuro, solo como cierre de un mes.
- **Si preguntan «¿y si no ganás?»**: respuesta de una línea — «el diseño está
  blindado: curva del sweet spot + estudios observacionales gratis garantizan
  resultados; una comparación negativa honesta también es un hallazgo».
- **Si preguntan por benchmarks públicos**: SWE-bench mide bug-fix mono-tarea;
  esto mide composición paralela de features — no hay benchmark público; el
  corpus congelado es parte del aporte.
- **Qué anotar durante la reunión**: las respuestas de los profesores a las
  cuatro preguntas de cierre, cualquier restricción nueva (fechas, formato de
  entrega), y si alguno pide una alternativa del catálogo como condición.
