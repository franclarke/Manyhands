# Guion de exposición — recorrido del sistema (Parte I)

Soporte: slides 1-6 de `manyhands-presentacion.html`. Charla de 10-15 minutos en
total (Parte I + Parte II): la idea es una explicación general con evidencia, no una
defensa formal exhaustiva. Si algo pide más detalle, ese detalle está en
`apunte-tecnico-presentacion.md` y en `evidencia-tecnica.md` — no hace falta
anticiparlo en la charla.

Regla general: el diagrama se recorre una vez, en voz alta, siguiendo las flechas.
El bloque de código no se lee completo; se usa para apoyar una o dos afirmaciones.
Ritmo objetivo: ~1 minuto por slide en esta parte — es el recorrido rápido antes del
cierre de tesis (Parte II), no el lugar para profundizar cada mecanismo.

---

## Slide 1 — Qué es ManyHands

Decir una sola frase clara: «toma un goal, lo convierte en trabajo ejecutable, corre
hojas aisladas e integra resultados con evidencia verificable».

Señalar en el mapa:
- la banda de arriba de izquierda a derecha (cada estación se retoma en un slide
  posterior);
- los dos gates con borde cobre: el humano no desaparece, se concentra en decisiones;
- el bus de eventos abajo: **todo** lo que la UI muestra sale de ahí.

El slide ya deja dicho, en una línea aparte, que esto no es «un agente que programa
mejor» sino la estructura que coordina varios agentes — leerla resuelve de entrada la
pregunta más común de esta parte. No abrir detalles de implementación todavía.

## Slide 2 — Qué problema resuelve

Leer la tabla por filas, completas: síntoma → qué hace ManyHands → mecanismo. La
tabla ya está redactada en términos concretos (no «interferencia» sino «los agentes
se pisan»), así que alcanza con leerla — no hace falta traducirla en vivo.

- los agentes se pisan → cada uno en su worktree, su propia branch → `mh/<run>/<task>` + `ScopeChecker`
- el agente dice «listo» y no lo está → el veredicto sale del repo, no del agente → `ResultRecorder`
- un crash deja todo ambiguo → estado durable → event log + checkpoints + gates

Cerrar con: la respuesta es estructura, no mejor prompting. Los tres mecanismos de la
tercera columna son literalmente los slides 4 y 5 que siguen.

## Slide 3 — La unidad de trabajo

Introducir la unidad básica con el diagrama del DAG:
- gris = estructura (quién compone a quién);
- cobre punteado = dependencia de ejecución (quién corre antes);
- son cosas distintas y el sistema las guarda por separado.

Matiz que conviene decir: `leaf-store` y `leaf-api` **no** tienen dependencia entre
sí — corren en paralelo, coordinadas por un seam. La dependencia del ejemplo es otra:
`leaf-ui` necesita `leaf-api`.

El slide ya trae dos cajas de pseudocódigo — no hace falta re-explicarlas de
memoria, alcanza con señalarlas:
- **cómo se arma el árbol**: el pseudocódigo de `decompose(nodo)` — un juicio LLM
  por nodo (`atómico | decompose | question`), recursivo. Es la respuesta directa a
  «¿cómo hace el agente para dividir las tareas?» sin tener que improvisarla.
- **forma del contrato**: el bloque `Contract { ... }` — objetivo, scope (forbidden
  gana, allow es advisory) y comandos de validación reales.

Después, el **seam** (interfaz compartida, comiteada como stub antes de que las
hojas arranquen) y la **dependencia** (solo orden de ejecución) quedan en una frase
cada uno debajo del contrato.

El propio slide adelanta la pregunta de colisión entre hojas hermanas apuntando a la
slide 5 — no hace falta responderla acá, solo confirmar que se retoma enseguida.

Si preguntan por el detalle de cada campo del contrato o la mecánica exacta del
seam, ahí es donde se abre `apunte-tecnico-presentacion.md` — no hace falta
adelantarlo acá.

## Slide 4 — Ejecución y verificación

Este slide sostiene la tesis más fuerte del sistema: **stdout no prueba nada, el
diff decide**.

Recorrer el pipeline de arriba en una pasada: contrato → worktree aislado →
executor CLI (subprocess con timeout) → recorder → resultado tipado.

El slide ya muestra el enum completo (`AgentResultStatus`, ocho estados) antes de la
lista de pasos — señalarlo y decir que ninguno de esos estados lo elige el agente.
Después, los tres pasos condensados del veredicto — son el recorder en orden:
1. ¿terminó bien, sin que el agente commiteara por su cuenta? (el agente nunca firma
   el resultado)
2. ¿hay un cambio real, dentro de lo permitido? (forbidden gana siempre)
3. el sistema hace el commit, y recién ahí corre la validación

Matiz que suele sorprender si preguntan: el commit ocurre **antes** de la
validación — el repair trabaja sobre estado commiteado y auditable.

## Slide 5 — Paralelismo e integración

Dos diagramas, una idea: el scheduler decide qué corre junto: el integrador decide
cómo se combina.

Izquierda (paralelismo): la wave se decide en ejecución, no en planning. Debajo del
diagrama el slide ya lista las cuatro reglas por las que dos tareas no comparten
wave (riesgo alto/bloqueante, overlap de scope, falta de contrato → conservador, la
wave nunca se cuelga) — es la respuesta directa a «¿cómo saben que no van a
chocar?», ya no hace falta reconstruirla de memoria, solo leerla.

Derecha (integración): los commits de los hijos se cherry-pickean en orden; si hay
conflicto, repair con el contrato del padre y los diffs de hermanos; si el
presupuesto se agota, gate humano con lo parcial preservado.

No vender el Composer como magia: es repair con contexto estructurado y presupuesto
acotado.

## Slide 6 — Garantías y límites

Cierre técnico corto de la Parte I. Leer la tabla garantía → mecanismo (cada fila ya
apareció en un slide anterior; esto es el resumen). Después los límites, con la misma
claridad:

- CLIs externos: el runtime del agente no se controla, se contiene;
- persistencia single-machine;
- la validación vale lo que valgan los comandos del contrato.

Cerrar con la frase que ya está en el slide: «esto es lo construido — lo que sigue es
la propuesta para cerrar la tesis». Es la transición literal hacia la Parte II
(`guion-cierre-tesis.md`); no hace falta improvisarla, solo leerla.

## Preguntas que probablemente aparezcan

Varias de estas ya están respondidas directamente en el slide correspondiente (ver
arriba) — quedan acá como red de contención si alguien pide más detalle del que el
slide muestra.

- **¿Qué es exactamente un contrato?** La frontera de ejecución de una hoja; cada campo
  tiene un componente que lo hace cumplir (slide 3).
- **¿Qué es un seam?** Una interfaz compartida real entre hojas, con firma TS concreta,
  scaffoldeada antes de que las hojas corran (slide 3).
- **¿Por qué el diff decide el resultado?** Porque el repo es la evidencia, no el
  stdout; el veredicto es un pipeline ordenado con estados tipados (slide 4).
- **¿Qué pasa si dos tareas tocan lo mismo?** El scheduler serializa por scope overlap
  o riesgo; si igual hay conflicto, la integración lo evidencia y lo repara con
  presupuesto (slide 5).
- **¿Cómo saben que la UI no miente?** Deriva de un event log persistido (JSONL →
  reducer → selectors); `gated` y `stale` no existen como flags, se recalculan en
  cada render. No es una slide dedicada en esta versión corta — está en el apunte
  técnico si preguntan por el detalle.
- **¿Qué pasa si el proceso muere a mitad del run?** Checkpoints por thread +
  reconciliación del mundo físico al reanudar; reanudar no re-ejecuta agentes.
- **¿Dónde está implementado eso?** `evidencia-tecnica.md` tiene el mapa completo
  concepto → archivo → símbolo → test; no hace falta tenerlo de memoria.
