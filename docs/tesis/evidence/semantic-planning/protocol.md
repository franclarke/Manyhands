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

## Enmienda de recongelación SP1b

La corrida `de75e45c-fb3e-46e3-9e52-8ffc250fbd71` se ejecutó antes de detectar
un defecto de transición del compilador: produjo un plan válido, pero el host
no había compilado bundles V2 para los nodos de integración. Terminó antes de
crear un intento de ejecución y se conserva como evidencia del defecto de la
implementación anterior; no cuenta como repetición de SP1.

La serie comparable se recongela como **SP1b** después de corregir ese defecto
en `5570773`. Mantiene tarea, objetivo, executor, criterios, presupuesto,
clones base y regla de no reintento. Sus dos celdas son `sp1b-01` y `sp1b-02`.

La corrida `ab6d1163-a89f-4735-929c-2632b6d6d069` de SP1b alcanzó el modelo,
pero fue rechazada por marcar como incertidumbre bloqueante una decisión que el
objetivo ya resolvía explícitamente: agregar el script `study:g6-probe`. Se
conserva como fallo de la validación de propuesta. SP1c se recongela en
`43251af`, con la misma hipótesis, límites y criterios, y usa `sp1c-01` y
`sp1c-02` como las dos celdas comparables.

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

## Enmienda de recongelación SP1d

SP1c se conserva sin modificar como evidencia adversa: su primera ejecución
alcanzó un error de ruta larga en el journal de integración y una receta de
validación que ejecutaba `pnpm test` con selectores incompatibles. Esos
defectos se corrigieron en `be85b03`. El preflight `da3c9e6a-2939-4d2f-a74b-acbb5084b409`
demostró además que el planificador podía omitir el nuevo `g6` y reutilizar
`wc3`; el guard de scripts nuevos se corrigió en `cbc98bb`.

La serie comparable se recongela como **SP1d** sobre `cbc98bb`, manteniendo la
tarea, executor, criterios, presupuesto, clones base y regla de no reintento.
El preflight final `986ceaee-748c-42d0-98da-c8a3acab5576` alcanzó
`needs_approval` y su plan incluye `src/probe/g6.ts` y
`src/probe/g6.test.ts`. Sus dos celdas son `sp1d-01` y `sp1d-02`; el freeze
durable está en `freeze-sp1d.json`.

## Corrección de integración y sucesor SP1f

La primera celda real de SP1d (`ab5fc73f-16c9-471c-a2c9-e95a370b005e`)
reveló un defecto adicional del compilador semántico: el composite
`Durability` podía ser seleccionado antes de que su hoja `Journal Analytics`
produjera su artefacto. El integrador aceptó el baseline como candidato vacío;
la corrida quedó en `waiting_for_input` por presupuesto no medible y no se
cuenta como éxito.

El commit `3758a53` corrige esto compilando un requisito de integración
`node-result` para cada relación hijo-padre. La regresión focal y los gates del
driver pasan 34/34. El preflight sucesor `30d7976a-5176-4dff-a0d7-6631d0f49e09`
verificó seis requisitos estructurales y la inclusión de
`src/probe/g6-probe.ts` y su test; no cuenta como ejecución.

SP1f conserva el mismo estímulo, baseline, executor, presupuesto y regla de
un solo intento. Su primera celda (`210dfcc1-50ca-4622-8a95-e8a18b8593fc`)
falló durante planning sin propuesta: el CLI reportó un error de caché de
modelos (`supports_reasoning_summaries` ausente). Se preserva como fallo
ambiental no atribuible al producto y no se reintenta automáticamente. El
freeze está en `freeze-sp1f.json`.

## Artefactos

Por cada celda se preservan la configuración, journal, snapshot, métricas de
granularidad, resultado, diff y veredicto externo. El freeze registra hashes de
las configuraciones, criterios, evaluador y commit del código ManyHands.
