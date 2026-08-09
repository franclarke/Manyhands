# Experimento final de tesis

Este directorio contiene la única serie que puede aportar evidencia positiva al
argumento central de la tesis después del recorte de alcance.

- `preregistration.md`: hipótesis, tareas y criterios fijados antes de abrir
  celdas.
- `protocol.md`: procedimiento operativo y reglas de atribución.
- `target-template/`: baseline limpio, sin la solución de ninguna tarea.
- `oracle/`: evaluador externo, fuera del target y fuera de ManyHands.
- `preflight.mjs`: prueba de que el target intacto falla y una solución de
  referencia pasa.

G5, G6, G7, SP2 y Warehouse se conservan como evidencia histórica separada.
No son celdas de este experimento ni se mezclan en sus veredictos.

La primera rehearsal descubrió y dejó registrado un límite del planner: una
raíz cohesiva necesitaba una envoltura de un solo hijo, pero el contrato sólo
aceptaba cortes de dos hijos. La corrección TDD está en el runtime congelado de
la serie final; la rehearsal anterior sigue siendo evidencia adversa del
instrumento y no se cuenta.
