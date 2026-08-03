# SP1 — Validación corta de la política semántica

## Propósito

SP1 valida la implementación posterior al rediseño de planificación semántica
en una tarea fija de seis capas. No es una comparación causal con A/B/C: esas
condiciones pertenecen al instrumento anterior y no consumen este plan.

## Hipótesis

**H-SP1.** Para la tarea congelada, ManyHands puede convertir una solicitud
multicapa en un plan semántico que el compilador acepta y puede ejecutar hasta
una entrega verificable. La política se considera suficientemente buena para
cerrar esta etapa si ambas repeticiones independientes cumplen los criterios
internos y externos definidos abajo.

Esto es evidencia de funcionamiento y viabilidad de la política, no inferencia
estadística ni prueba de superioridad frente a otra política.

## Diseño congelado

- 1 tarea fija (`T1`), 1 condición (`semantic-product`), 2 repeticiones.
- Cada repetición parte del mismo commit base en un clon objetivo independiente.
- Executor fijo: `codex-cli / gpt-5.4-mini / medium` en planning, ejecución y reparación.
- `maxPlanningAttempts: 1`, `automaticRetryBudget: 0`, `maxParallel: 2`.
- Techo por celda: USD 8; techo de la serie: USD 16.
- Límite de reloj: 30 minutos por celda.
- No se agregan celdas, no se cambia el prompt, el modelo, el esfuerzo, los
  criterios ni la política después de observar resultados.
- Un fallo se conserva como resultado adverso; no se reintenta.

El preflight de planificación queda registrado aparte y no cuenta como una de
las dos repeticiones.

## Criterios internos de la política

El plan solo es válido si cumple simultáneamente:

1. la raíz representa el objetivo completo y no finge ser una hoja;
2. cada hoja tiene exactamente un criterio de resultado;
3. cada hoja declara `existingPaths` y `plannedPaths` dentro de la evidencia
   disponible y no excede seis rutas planeadas;
4. cada compuesto tiene hijos no vacíos y cada hoja es ejecutable;
5. cada seam tiene productor y consumidor que existen como hojas y cada artefacto
   tiene un único productor;
6. las incertidumbres no inventan rutas, capacidades ni contratos; y
7. el Graph Compiler acepta el plan y materializa únicamente sus artefactos.

Los criterios están implementados en el esquema directo del plan y en la
validación del compilador; no se inspeccionan manualmente para rescatar una
corrida que el sistema rechazó.

## Criterios externos y veredicto

Cada SHA candidato se evalúa en un clon limpio mediante el evaluador externo
congelado de diez criterios: instalación, tests, typecheck, build, integridad
de tests del baseline, tres comportamientos importados y dos propiedades del
probe JSON determinista. La evaluación se hace sobre el árbol candidato, no
sobre las obligaciones compiladas por hoja.

El veredicto de SP1 es:

- **PASS:** 2/2 celdas completadas, ambas con plan interno válido y 10/10
  criterios externos satisfechos;
- **PARTIAL:** existe evidencia válida de planificación o una sola celda
  completa, pero falta replicación o algún criterio externo;
- **FAIL:** ninguna celda completa con plan válido, o ambas incumplen criterios
  externos esenciales;
- **NOT_ATTRIBUTABLE:** el fallo es exclusivamente de infraestructura o del
  proveedor y no permite atribuirlo a la política. Se reporta, no se convierte
  en PASS.

El resultado no afirma significancia estadística. La afirmación defendible, si
se obtiene PASS, es que ManyHands funciona para esta tarea y que la política
semántica produce una granularidad ejecutable y verificable bajo el protocolo.

## Artefactos

Por cada celda se preservan la configuración, journal, snapshot, métricas de
granularidad, resultado, diff y veredicto externo. El freeze registra hashes de
las configuraciones, criterios, evaluador y commit del código ManyHands.
