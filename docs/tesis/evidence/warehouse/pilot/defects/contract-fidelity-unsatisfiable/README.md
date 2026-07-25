# La regla de fidelidad quedó insatisfacible al renderizar el contrato

Clasificación: **interacción entre dos correcciones propias**.

## Observación

W1 de `series-6` (run sobre ManyHands `635062e`) superó por fin el problema de
`plannedPaths`: emitió cuatro nodos y llegó a la validación. Sus tres intentos
murieron todos contra la misma regla:

    contract fidelity: preserve the complete ## Probe contract section verbatim
    in one acceptance intent

## Causa

Dos correcciones de este mismo programa se combinan mal.

1. `f5b99f2` introdujo la regla de fidelidad porque una entrega aplanó
   `layout`/`inventory` fuera de `capabilities` y emitió el hash sin prefijo
   `sha256:`. La regla exige que un `acceptanceIntents[].description` contenga
   la sección declarada **completa y verbatim**.
2. `6cc1910` pasó a renderizar `## Probe contract` desde el specimen, para que
   el estímulo no pudiera contradecirse a sí mismo.

Por separado son correctas. Juntas, la sección pasó de un párrafo de prosa a
**41 líneas y 1212 caracteres**, con un bloque JSON con fences, que el modelo
debe re-emitir dentro de un string JSON. Tres intentos consecutivos fallaron.

## Corrección TDD

- Rojo: una sección con fence cuyo specimen se reproduce sin la prosa
  circundante debía aceptarse y era rechazada.
- Verde: la regla exige verbatim **los bloques con fences** de la sección, y
  sólo la sección entera cuando no hay ninguno. La fidelidad que la regla
  protege —anidamiento y literales exactos— vive en el fence; la explicación
  alrededor puede resumirse. Una paráfrasis del propio fence sigue reintentando.
- Verificación: 32 tests de planning PASS; typecheck PASS; símbolo en `dist`.

El test original de secciones sin fence sigue verde, así que la garantía previa
no se debilitó donde no había specimen.

Resultado acumulado del piloto: **0/8**.
