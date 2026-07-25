# Contract fidelity through planning

Clasificación: **defecto productivo de planificación y compilación semántica**.

## Observación

El prompt W1 corregido declaraba que `capabilities` contenía `layout` e
`inventory` y que `stateHash` tenía formato `sha256:<64 hex>`. El planner
conservó los nombres, pero aplanó su relación en el acceptance intent compilado.
El executor recibió esa paráfrasis, creó tests para campos top-level y emitió un
hash hexadecimal sin prefijo. La matriz interna pasó; el oráculo externo rechazó
el contrato real.

La reejecución diagnóstica silenciosa está en
`series-2/runs/W1/oracle-silent-recheck.json`. No convierte al run en PASS y la
entrega no se adopta para W2.

## Causa y corrección TDD

Los acceptance intents funcionaban como una compresión con pérdida: podían
renombrar literales, aplanar objetos o debilitar formatos exactos antes de que el
Graph Compiler construyera el contrato ejecutable.

- Rojo: una regresión entregó una sección `## Probe contract` con nesting y
  prefijo exactos; el planner aceptó una paráfrasis aplanada en un solo intento.
- Verde: secciones declaradas Contract, Protocol o Schema deben preservarse
  completas y verbatim en un acceptance intent. El planner reintenta cualquier
  candidato o cache que pierda esa sección, y su system prompt explicita la
  frontera de fidelidad.
- Verificación: 18 tests de WorkBreakdown PASS.

La regla es general y no conoce Warehouse ni nombres de campos específicos. No
obliga a copiar el prompt completo: protege sólo secciones que el solicitante
marcó explícitamente como contrato, protocolo o esquema.
