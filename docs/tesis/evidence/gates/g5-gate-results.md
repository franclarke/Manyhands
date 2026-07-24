# G5 — Experimento comparativo: **ejecutado**

> **Fecha:** 2026-07-24 (UTC) · **Commit de ManyHands:** `4f4ead5`, único para
> las 12 celdas · **Objetivo:** `expense-splitter`, base `1da878d`, restablecido
> antes de cada run · **Executor:** Codex CLI 0.141.0, `gpt-5.5`, effort `high`.
>
> Tablas y figuras en `experiment/results.md`, `raw-results.csv` y
> `results.svg`, **derivadas automáticamente** del journal de eventos por
> `scripts/derive-metrics.mjs`. Ninguna cifra de este documento se transcribió a
> mano.

## Resumen

**10 de 12 celdas alcanzaron entrega verificada.** Las dos que no
(`T1/B r1`, `T1/C r1`) quedaron en `waiting_for_input`.

| Tarea | Cond. | Entregas | Wall-clock (s) | Hojas | Tokens |
|---|---|---|---|---|---|
| T1 | A | **2/2** | 259, 357 | 1, 1 | 21 794, 24 898 |
| T1 | B | 1/2 | 942, 1209 | 4, 3 | 111 663, 101 120 |
| T1 | C | 1/2 | 810, 1109 | 3, 3 | 104 361, 96 316 |
| T2 | A | **2/2** | 282, 291 | 1, 1 | 29 546, 28 385 |
| T2 | B | **2/2** | 362, 393 | 1, 1 | 52 499, 28 270 |
| T2 | C | **2/2** | 344, 351 | 1, 1 | 32 096, 26 299 |

## Defecto de medición: la métrica primaria **no** es comparable entre condiciones

Esto se declara primero porque invalida la lectura ingenua de la tabla anterior.

Los criterios de aceptación se compilan **por unidad**, así que su cantidad es
función de la descomposición, no del objetivo. En T1:

| Condición | Hojas | Criterios evaluados | Diff entregado |
|---|---|---|---|
| A | 1 | **5** | +96 / −11 |
| B | 3 | **14** | +176 / −8 |
| C | 3 | **14** | +156 / −9 |

Las doce celdas tienen cobertura 1,00. Eso **no** significa que las tres
condiciones hayan superado la misma vara: significa que **cada una satisfizo la
suya**. Una condición que divide se impone más obligaciones y luego las cumple;
una que no divide se impone menos y también las cumple.

**Consecuencia:** «tasa de entrega verificada», tal como está instrumentada, no
puede responder RQ1 comparando condiciones. Es un defecto de validez de
constructo del instrumento, no de los datos, y es el resultado metodológico más
importante del experimento.

**Qué sí es comparable**, porque el objetivo, el repositorio y el commit base
son idénticos: duración wall-clock, tokens consumidos, modos de falla, métricas
estructurales y **la superficie pública efectivamente entregada**.

### Verificación de equivalencia funcional en T1

Se comparó el diff entregado por A y por C. Ambas exportan la misma superficie:

```
expenseCategories · ExpenseCategory · computeCategoryTotals · listCategoryTotals
```

más el desglose por categoría en la superficie web. La diferencia está en la
densidad de pruebas: A agregó **3** casos; C agregó **6**. **A implementó el
objetivo completo**, no una fracción.

## Resultado principal: la hipótesis pre-registrada queda **falsada**

La hipótesis (§8.5) era que C se comportaría como A en T2 —sin dividir de más— y
**no peor que B en T1**. El falsador incluía explícitamente «C no muestra ventaja
sobre B en T1».

Lo observado:

1. **En T2 la hipótesis se sostiene, y por el mecanismo previsto.** Las tres
   condiciones produjeron **una sola hoja** y entregaron 2/2. Es notable que
   **B también produjo una hoja**: la división fina no puede inventar un corte
   que el Architect no propuso, exactamente como predice el resultado negativo
   de esta tesis. En una tarea cohesiva, dividir no es una opción disponible.
2. **En T1 la hipótesis se falsa, y en la dirección más desfavorable.** La
   condición **A —no dividir— entregó 2/2**, mientras B y C entregaron 1/2 cada
   una. A lo hizo con ≈ **⅓ del tiempo** y ≈ **¼ de los tokens**, entregando la
   misma superficie funcional.

**No hay evidencia de que la política adaptativa aporte ventaja sobre no
dividir en este objetivo y este repositorio.** La tesis no afirma lo contrario.

## Por qué este resultado no autoriza la conclusión inversa

Tampoco alcanza para afirmar que «dividir es peor». Cuatro razones:

1. **El repositorio objetivo es pequeño** (5 pruebas en la línea de base). La
   hipótesis de la descomposición es que sirve cuando un agente único **satura
   su contexto**; con ≈ 25 000 tokens por run, eso no ocurrió ni cerca. El
   experimento no puso a prueba la condición bajo la cual la descomposición
   debería ganar.
2. **$n = 2$ por celda, y dos celdas discrepan internamente.** Por §8.4, en
   T1/B y T1/C **la varianza del planificador domina sobre el efecto de la
   condición**. Por §8.3, ninguna diferencia en T1 califica como «señal
   observada».
3. **Los fallos de T1/B y T1/C no fueron de granularidad**: uno fue un agente
   que agotó el timeout de 300 s, otro una validación fallida cuya reparación
   violó el alcance. Son modos de falla de ejecución, no evidencia de que
   dividir sea intrínsecamente peor.
4. **La métrica primaria está confundida** con la condición (arriba).

## RQ3 — Modos de falla observados

| Modo | Dónde | Lectura |
|---|---|---|
| `execution_failed` (timeout 300 s) | T1/C r1 | Una hoja excedió el presupuesto por agente. Con más hojas hay más oportunidades de agotarlo. |
| `validation_failed` → reparación con `scope_violation` | T1/B r1 | La división fina produjo una hoja dedicada a pruebas de regresión; al fallar su validación, la reparación salió de su contrato. |
| `conflict` | T1/B r2, T1/C r2 | Ambas **entregaron**: la integración ascendente resolvió el conflicto con un pase de reparación semántica. El conflicto es costo, no fallo. |
| ninguno | las 6 celdas de T2 | Una tarea cohesiva no genera coordinación que pueda fallar. |

**Los conflictos aparecen únicamente cuando se divide.** Es el costo de
coordinación que RQ2 pregunta, y acá está medido: +750 a +850 s y +70 000 a
+80 000 tokens respecto de no dividir, sobre el mismo objetivo.

## Desviaciones del protocolo

| Enmienda | Qué | Efecto |
|---|---|---|
| E-1 | Objetivos hechos auto-contenidos | Reparación del instrumento; idéntica para las tres condiciones |
| E-2 | Métrica de tokens habilitada | Sin ella RQ2 no tenía datos |

Dos intentos previos se descartaron **por completo** por defectos de ManyHands
descubiertos al ejecutar (`experiment/discarded-attempt-1/`), conforme al §6.
Ningún run anterior a `4f4ead5` se usa para responder una RQ.

**La regla de escalamiento del §4 no se invocó.** T1/B y T1/C discrepan entre
repeticiones y habilitarían una tercera, pero agregarla no cambiaría la
conclusión —la discrepancia ya está reportada como el resultado que es— y
hacerlo después de ver datos desfavorables sería exactamente el ajuste post-hoc
que el protocolo prohíbe.

## Amenaza a la validez que este experimento agrega

Además de las declaradas en el protocolo, la ejecución expuso una nueva:

> **Los criterios de aceptación son endógenos a la condición.** Cualquier
> métrica de éxito construida sobre ellos compara a cada condición contra su
> propia vara. Un diseño futuro debe fijar un **conjunto de criterios externo,
> idéntico para las tres condiciones**, y evaluarlo contra el árbol entregado.
