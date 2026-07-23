# Diseño — Presentación de defensa (audiencia no técnica)

## Contexto y objetivo

El tribunal ya aprobó la tesis. Esta presentación es para el acto de cierre de
carrera: exposición ante familia y amigos, sin conocimiento técnico. El
objetivo no es defender el trabajo (eso ya pasó), sino contar la historia del
proyecto de forma simple, honesta y entretenida, y de paso enseñarle al
público algo real sobre orquestación de agentes de IA.

Esta presentación es un documento hermano de la ya existente
`manyhands-deck-main.html` (deck técnico, para audiencia técnica/entrevista).
Comparten el mismo proyecto y la misma honestidad sobre alcance y límites,
pero difieren en profundidad técnica, extensión y tono.

## Restricciones y decisiones previas

- **Duración:** 20+ minutos.
- **Formato de entrega:** deck HTML, mismo estilo de construcción que
  `manyhands-deck-main.html`.
- **Balance narrativo:** parejo entre historia personal y explicación del
  proyecto (no mayormente uno u otro).
- **Nivel base del público:** ya conoce asistentes de IA tipo ChatGPT: no hace
  falta explicar qué es la IA generativa desde cero, sí hay que explicar qué
  es un *agente* (que actúa, no solo responde) y qué es *orquestar* varios
  agentes.
- **Demo:** hay un lab de runs mock ya diseñado. Se usa en vivo, pero **no se
  integra dentro del deck** — el presentador cambia de pantalla manualmente.
  El deck solo incluye una diapositiva marcador ("Ahora, en vivo").
- **Notas de orador:** no se genera un archivo de notas separado (a diferencia
  del deck técnico, que sí tiene `manyhands-deck-notes.html`). El deck debe
  poder sostenerse solo con lo que está escrito en cada slide.
- **Estilo visual:** mismo sistema del deck técnico (fondo oscuro, un color de
  acento, tipografía limpia, WCAG 2.2 AA, `prefers-reduced-motion`), pero
  simplificado: menos texto por slide, tipografía más grande, sin diagramas
  densos ni fragmentos de código.

## Analogía elegida

**Cocina de restaurante**, usada en un único punto central de la charla (no
como hilo conductor de toda la presentación). Mapeo:

| Concepto del proyecto | Elemento de la cocina |
|---|---|
| Objetivo grande de software | Pedido grande de una mesa |
| Descomposición en unidades | El pedido se separa en platos |
| Ejecución paralela aislada | Cada cocinero trabaja en su propia estación, sin pisar a los demás |
| Validación antes de confiar | El jefe de cocina prueba/revisa cada plato antes de aprobarlo |
| Integración final | El mozo junta todo y entrega el pedido completo y coordinado |

Se descartaron: la orquesta sinfónica (conecta bien con el término técnico
pero es menos cotidiana y requiere entender cómo funciona una orquesta) y el
equipo de fútbol / producción de película (mapeos más débiles para
"validar antes de confiar").

La analogía aparece explícitamente en el Acto III (slide 8) y se retoma con
una única frase breve al hablar de validación (slide 9) — no se reabre ni se
extiende más allá de eso.

## Estructura de la charla (~15 slides, 20-25 min)

### Acto I — Apertura (~4 min)

1. **Portada.** ManyHands — qué es, en una frase simple.
2. **Por qué elegí este tema.** Momento personal, gancho de apertura: la
   motivación o curiosidad real detrás de elegir este tema de tesis.
3. **El problema, en términos cotidianos.** Pedirle a una sola persona que
   resuelva algo grande de una sola sentada es lento y frágil. Sin analogía
   todavía — lenguaje directo y llano.

### Acto II — La idea central de la tesis (~6-7 min)

4. **¿Qué es un agente de IA?** Parte de que el público ya conoce ChatGPT:
   "un asistente que además de responder, actúa — escribe código, corre
   comandos, prueba resultados".
5. **La pregunta que te hiciste, en simple.** ¿Se puede dividir un pedido
   grande de software en partes bien definidas, hacer que varias avancen a la
   vez sin pisarse, y volver a juntarlas de forma controlada?
6. **Qué estás afirmando en realidad (honesto).** No es una hipótesis de
   superioridad ("esto es mejor/más rápido que un agente solo"). Es una
   hipótesis de capacidad habilitada por diseño: paralelismo seguro, no
   confiar en un resultado hasta comprobarlo, saber exactamente sobre qué
   versión del código se probó cada cosa — cosas que un agente solo, de una
   sentada, no puede garantizar por diseño. Fiel a la matización real de la
   tesis (Capítulo 2 de la guía de estudio): ni sobrevender ni sonar a
   benchmark A/B que no existe.
7. **Una pregunta que quedó abierta: la granularidad.** Cortar muy grueso da
   partes grandes y difíciles de revisar; cortar muy fino multiplica la
   coordinación necesaria. No se resolvió del todo — quedó como exploración
   motivadora (el modo "auto" del decomposer), no como resultado cerrado y
   evaluado. Mantiene la misma honestidad que ya se usó frente al tribunal.

### Acto III — Cómo funciona (~6-7 min)

8. **La analogía de la cocina** (único uso extendido). Un pedido grande se
   descompone en platos; varios cocineros trabajan en paralelo en su propia
   estación sin pisarse; de ahí sale la idea de coordinar varios agentes a la
   vez.
9. **Qué construiste en concreto, en criollo.** Cómo arma el plan a partir
   del repositorio, cómo aísla cada agente para que trabaje sin arruinar a
   los demás, cómo valida antes de integrar (guiño de una frase a la cocina:
   "como el jefe de cocina que prueba el plato antes de que salga a la
   mesa"), cómo queda todo guardado y supervisable.
10. **El alcance real, con la misma honestidad que con el tribunal.** Corre
    en una sola máquina (local-first, single-host). Usa herramientas de IA
    existentes (Claude Code, Codex) como los "cocineros" — el aporte no es
    haber inventado el modelo de IA, sino cómo coordinarlos y verificar su
    trabajo.

### Acto IV — En acción (~5 min)

11. **Diapositiva marcador: "Ahora, en vivo".** El presentador cambia de
    pantalla y corre el lab de runs mock fuera del deck.

### Acto V — Cierre (~4-5 min)

12. **Resultados honestos.** Qué funciona y qué quedó pendiente, sin
    tecnicismos ni sobreventa.
13. **Qué significó este proyecto.** Cierre de etapa, reflexión personal.
14. **Agradecimientos.** Familia, amigos, docentes.
15. **Cierre final.** Posible guiño sutil al nombre "ManyHands".

## Fuera de alcance de este diseño

- Integración del demo dentro del deck (el presentador lo maneja aparte).
- Archivo de notas de orador independiente.
- Reescritura o reemplazo del deck técnico existente — este es un documento
  nuevo y separado.
- Contenido de las diapositivas de respaldo (backup slides) del deck técnico
  no tiene equivalente aquí: esta charla no tiene sección de preguntas
  difíciles pre-armada, porque el público no va a interrogar el trabajo como
  lo hizo el tribunal.

## Próximo paso

Con este diseño aprobado, el siguiente paso es un plan de implementación
(contenido palabra por palabra de cada slide, y luego construcción del
archivo HTML) siguiendo el mismo patrón de construcción usado para
`manyhands-deck-main.html`.
