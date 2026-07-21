# ADR 0010 — Lentes del grafo e inspector contextual de decisiones

## Estado

Aceptado.

## Contexto

Mostrar jerarquía, artefactos, seams y conflictos al mismo tiempo vuelve
ilegible un grafo real. Ocultar todas las relaciones secundarias impide explicar
readiness y coordinación. Por otro lado, resolver una decisión en un dialog
separa las opciones del nodo y oculta parte del contexto que el usuario necesita
comparar.

## Decisión

La jerarquía es la estructura visual persistente. Las relaciones secundarias se
agrupan por par de nodos y se muestran con lentes explícitos:

- ejecución: vecindario del nodo seleccionado;
- artefactos;
- contratos;
- conflictos;
- todas.

La UI mantiene una franja global de decisiones pendientes. Al elegir una
decisión selecciona el primer nodo afectado y usa el inspector lateral como
superficie resolutiva. El inspector muestra alcance, razón, opciones y
consecuencias sin tapar el canvas. En viewport estrecho el mismo inspector se
presenta como sheet accesible.

El viewport se inicializa una vez. `Encuadrar` y el minimapa son herramientas
explícitas del operador; ningún evento ejecuta pan, zoom o `fitView`.

## Alternativas

- **Todas las relaciones siempre visibles:** completa, pero escala mal y mezcla
  semánticas distintas.
- **Solo jerarquía:** simple, pero no explica dependencias materiales, seams o
  riesgo.
- **Dialog de decisión:** concentra foco, pero oculta el contexto espacial y
  fuerza una capa modal para una acción que ya pertenece al inspector.
- **Lentes + inspector contextual:** elegida.

## Consecuencias

- La presentación de relaciones es una proyección; no crea ni cambia relaciones
  del dominio.
- Agrupar edges reduce ruido visual, pero el inspector debe conservar el detalle
  de cada relación original.
- Seleccionar una decisión puede cambiar la selección del nodo, nunca el pan o
  zoom del canvas.
- La franja global sigue siendo navegable y las ramas independientes continúan.
- Foco visible, labels accesibles y reduced motion son parte del contrato.
