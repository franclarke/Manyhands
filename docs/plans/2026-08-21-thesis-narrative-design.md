# Diseño narrativo de la tesis de ManyHands

## Propósito

Reescribir la tesis para un público general del Departamento de Sistemas. El
documento debe explicar con claridad el problema, las decisiones de diseño y el
valor de la solución sin exigir que el lector conozca previamente el código.

## Estructura narrativa

1. Presentar el problema mediante la tensión entre un agente monolítico y una
   descomposición excesiva.
2. Dar primero una vista completa del sistema por capas y seguir un run desde
   el objetivo hasta la entrega. El lector debe poder ubicar los 17 subsistemas
   y comprender qué información pasa entre ellos, aunque no se describa cada
   clase interna.
3. Profundizar después en las cinco contribuciones centrales: granularidad,
   contratos, grafo híbrido, aislamiento y evidencia.
4. Introducir los algoritmos desde su intuición y luego formalizarlos sólo
   cuando la notación agregue precisión.
5. Mostrar la implementación como una cadena de custodia desde el objetivo
   hasta el commit entregado.
6. Cerrar con el run Viaje en Familia como demostración concreta, distinguiendo
   la evidencia canónica de la observación visual.

La regla de cobertura es \textbf{completitud con profundidad selectiva}: ningún
tramo necesario del recorrido queda implícito, pero el espacio se concentra en
las decisiones que constituyen un aporte. La vista integral agrupa los módulos
en capas de interacción, planificación, coordinación durable, scheduling,
ejecución y evidencia. El recorrido end-to-end explica, en orden, la creación
del contrato de objetivo, el grounding, la compilación del grafo, la selección
de la frontera ejecutable, los intentos inmutables, la integración jerárquica,
la validación exacta, la entrega y la proyección en la UI.

## Criterios editoriales

- Máximo de 40 páginas en el PDF final.
- Párrafos breves, una idea principal por párrafo y tecnicismos definidos al
  aparecer por primera vez.
- Nombrar todos los subsistemas una vez dentro de un mapa funcional, evitando
  inventarios posteriores de clases internas que no aporten al recorrido.
- Mantener las afirmaciones ligadas a evidencia observable y presentar las
  limitaciones de forma proporcionada.
- Utilizar diagramas pequeños para relaciones, secuencias y jerarquías; no
  decorar sin valor explicativo.

## Verificación

- Compilar con `pdflatex` y `bibtex`.
- Confirmar referencias y citas resueltas.
- Verificar que no existan cajas desbordadas relevantes.
- Renderizar todas las páginas y revisar legibilidad, tablas, diagramas,
  numeración y transiciones de capítulo.
