# G5 — Protocolo del experimento comparativo de granularidad

> **Estado: NO EJECUTADO.** Este documento se registra **antes** de observar
> ningún resultado. Fija tareas, tamaño, orden, métricas y criterios de
> interpretación con antelación, de modo que ninguna decisión de análisis pueda
> tomarse después de ver los datos.
>
> **Diseño: 2 tareas × 3 condiciones × 2 repeticiones = 12 runs**, con una regla
> de escalamiento pre-declarada que puede llevarlo hasta 18.
>
> **Fecha de registro:** 2026-07-24 (UTC) · Reemplaza el diseño previo de 27–45
> runs, desproporcionado para el alcance y el presupuesto de esta tesis.

## 1. Preguntas de investigación

- **RQ1.** ¿Cómo varía la tasa de entrega verificada entre (A) hoja única
  forzada, (B) división fina fija y (C) política adaptativa?
- **RQ2.** ¿Qué trade-off existe entre éxito, duración wall-clock, tokens/costo
  y overhead de coordinación?
- **RQ3.** ¿Qué modos de falla, reintentos, resultados obsoletos o conflictos
  aparecen en cada configuración?

Este es un estudio **exploratorio de viabilidad y trade-offs**. No busca ni
puede alcanzar significancia estadística (§8).

## 2. Condiciones

| Cond. | Descripción | Mecanismo |
|---|---|---|
| **A** | Hoja única: se prohíbe descomponer | Umbral efectivo $\infty$: toda unidad se declara hoja |
| **B** | División fina fija | Umbral efectivo 0 y críticos de coalescencia desactivados |
| **C** | Política adaptativa productiva | `c-task/1.0.0`, umbral 3.5, críticos activos |

Las tres condiciones deben ser seleccionables de forma reproducible y quedar
registradas en el evento `planning.granularity_assessed` de cada run.

**Precondición de implementación (no satisfecha hoy):** el umbral y la
activación de los críticos son constantes del código. Deben exponerse como
configuración por run y versionarse en `formulaVersion` (p. ej.
`c-task/1.0.0+condA`), de modo que un run sea auto-descriptivo respecto de la
condición bajo la que corrió.

## 3. Tareas seleccionadas y por qué son representativas

El criterio de selección es deliberado y es lo que hace informativo un diseño
pequeño: **las dos tareas deben caer en lados opuestos del umbral de
decisión.**

Si ambas tareas fueran complejas, la condición A fallaría por construcción y la
condición C parecería superior por una razón trivial. La paradoja de la
granularidad tiene dos lados ---sub-división y sobre-división--- y un
experimento honesto debe exponer la política a los dos.

### T1 — Tarea multi-capa (por encima del umbral)

*Agregar categorías de gasto: campo opcional validado en el dominio, función de
totales por categoría, exposición en la API, presentación ordenada en la
superficie web y pruebas para las tres capas.*

- **Por qué es representativa:** toca tres capas con acoplamiento real entre
  ellas, requiere al menos un contrato de interfaz entre unidades y su
  verificación abarca varias suites. Es el perfil de tarea donde un agente único
  enfrenta saturación de contexto.
- **Complejidad observada:** en el run canónico la raíz obtuvo
  $C_{\mathit{task}} = 4{,}50$ (> 3,5) y la política la descompuso.
- **Predicción pre-registrada:** A dificultoso, B con sobrecosto de
  coordinación, C intermedio.

### T2 — Tarea acotada (por debajo del umbral)

*Agregar una regla de negocio confinada al dominio: permitir que un gasto se
divida en partes desiguales mediante ponderaciones explícitas por participante,
validando que las ponderaciones sumen el total, con sus pruebas.*

- **Por qué es representativa:** es un cambio cohesivo de una sola
  responsabilidad, concentrado en el módulo de dominio y su archivo de pruebas.
  Es el perfil donde dividir es puro costo.
- **Complejidad esperada:** $C_{\mathit{task}} \le 3{,}5$; la política debería
  conservar una sola hoja.
- **Predicción pre-registrada:** A adecuado, B con sobrecosto injustificado,
  C equivalente a A.

**El contraste esperado es distinto por tarea**, y eso es precisamente lo que se
quiere medir: una política adaptativa útil debe *parecerse a A en T2 y no ser
peor que B en T1*. Una política que se comporta siempre como B no resuelve la
paradoja, solo elige un extremo.

### Repositorio objetivo

El mismo `expense-splitter` del caso canónico, desde el mismo commit base
`1da878d`, restablecido antes de cada run. Ambas tareas parten de ese baseline,
de modo que T1 y T2 son independientes entre sí y el orden no las contamina.

## 4. Tamaño y repeticiones

**Diseño base: 2 × 3 × 2 = 12 runs.**

Justificación de **2 repeticiones**, ni menos ni más:

- Con **1** repetición es imposible distinguir un efecto sistemático de la
  variabilidad del planificador remoto, que ya se observó alta (ejecuciones del
  mismo objetivo produjeron topologías distintas).
- Con **2** se obtiene la señal mínima útil: si ambas repeticiones de una celda
  coinciden, hay consistencia interna; si difieren, la varianza del proveedor
  domina sobre el efecto de la condición, **y eso es en sí mismo un resultado
  reportable**.
- Con **3 o más** no se gana potencia estadística a esta escala ---seguiría sin
  haber base para una prueba de hipótesis--- y el costo crece linealmente. El
  beneficio marginal no justifica el gasto.

### Regla de escalamiento pre-declarada

Si en una celda las dos repeticiones **discrepan en la métrica primaria**
(entrega verificada), se ejecuta una **tercera repetición solo para esa celda**,
como desempate descriptivo. El máximo absoluto es de 6 celdas × 3 = **18 runs**.

Esta regla se fija ahora, antes de ver los datos. No se permite agregar
repeticiones por ningún otro motivo, y en particular **no** para «confirmar» un
resultado que favorezca la hipótesis.

## 5. Orden de ejecución (pre-registrado)

El orden se fija de antemano para que la deriva temporal del proveedor no se
alinee con ninguna condición. Se ejecutan dos bloques; el segundo invierte el
orden de las condiciones:

| # | Tarea | Cond. | Rep. |
|---|---|---|---|
| 1 | T1 | A | 1 |
| 2 | T2 | B | 1 |
| 3 | T1 | C | 1 |
| 4 | T2 | A | 1 |
| 5 | T1 | B | 1 |
| 6 | T2 | C | 1 |
| 7 | T2 | C | 2 |
| 8 | T1 | B | 2 |
| 9 | T2 | A | 2 |
| 10 | T1 | C | 2 |
| 11 | T2 | B | 2 |
| 12 | T1 | A | 2 |

Cada condición aparece una vez en la primera mitad y una vez en la segunda, y
ninguna ocupa dos posiciones consecutivas dentro de una tarea. Los runs de
desempate, si los hubiera, se ejecutan al final en orden de celda.

## 6. Constantes

Repositorio y commit base; objetivo y criterios de aceptación por tarea; modelo
(`gpt-5.5`), esfuerzo (`high`) y executor (Codex CLI 0.141.0) para planificación
y ejecución; `maxParallel = 2`; timeouts; **versión de ManyHands (un único
commit para los 12 runs)**; comandos de validación; hardware.

Si durante la ejecución se descubre un defecto que obliga a modificar
ManyHands, **el experimento se reinicia por completo** sobre el nuevo commit.
No se mezclan runs de versiones distintas.

## 7. Métricas

### Primarias

| Métrica | Tipo | Fuente |
|---|---|---|
| Entrega verificada | binaria | `lifecycle == completed` + receipt confirmado |
| Cobertura de criterios | proporción | matriz de evidencias |
| Duración wall-clock | segundos | primer y último evento del journal |
| Tokens / costo | numérico | telemetría del executor |
| Intentos y reintentos | conteo | `attempt.started`, `attempt.repair_attempted` |
| Modo de falla | categórico | `failure.classified` |

### Estructurales (para explicar las primarias)

Profundidad, cantidad de hojas, factor de ramificación, unidades fusionadas,
decisiones `resplit_declined`, restricciones de conflicto, violaciones de
alcance. Todas se persisten hoy en `<runId>.granularity-metrics.json` y en el
journal.

### Sobre el `GEI`

Se reporta **solo como indicador descriptivo**, siempre junto a sus tres
componentes, con la fórmula y el tratamiento del denominador cero versionados.
Con $n = 2$ por celda **no se usa para ordenar las condiciones ni para sostener
ninguna conclusión**. Si sus componentes apuntan en direcciones distintas, se
reportan los componentes y se omite el índice.

## 8. Criterios de interpretación (fijados antes de observar)

1. **No se aplican pruebas de significancia.** Con 2 observaciones por celda no
   hay base para p-valores ni intervalos de confianza. Todo lo que se reporte es
   descriptivo.
2. **Se publican los valores de cada run individual**, no solo agregados. Con
   $n = 2$, un promedio oculta más de lo que muestra.
3. Una diferencia entre condiciones se califica como **señal observada** solo si
   ambas repeticiones de la celda coinciden en dirección y la diferencia excede
   la dispersión observada dentro de las celdas. En cualquier otro caso se
   reporta como **no concluyente**.
4. **Discrepancia interna como resultado.** Si las dos repeticiones de una celda
   difieren en la métrica primaria, se reporta explícitamente que la varianza
   del planificador domina sobre el efecto de la condición para esa celda.
5. **Hipótesis y falsador, pre-registrados.** La hipótesis es que C se comporta
   como A en T2 (sin dividir de más) y no peor que B en T1 (dividiendo cuando
   hace falta). Se considerará **contraria a la hipótesis** cualquiera de estas
   observaciones: C divide T2 como lo hace B; C falla en T1 donde A entrega; o C
   no muestra ventaja alguna sobre B en costo o duración en T1.
6. **Ningún run se descarta** por perjudicar la hipótesis. Todo run ejecutado
   entra en el dataset con su resultado y su modo de falla.
7. **Regla de inconclusión.** Si más del 50 % de los runs, **en todas las
   condiciones por igual**, falla por la limitación conocida del contrato de
   alcance (§9), el experimento se declara **inconcluyente para RQ1** y se
   reporta como tal. En ese caso solo se sostienen las observaciones de RQ3
   (modos de falla), que no dependen de que el run complete.

## 9. Amenazas a la validez

**Validez estadística.** $n = 2$ por celda. No hay potencia para detectar
efectos moderados; el estudio solo puede mostrar diferencias grandes y
consistentes, o ausencia de señal.

**Validez interna.** El planificador es un modelo remoto no determinista: dos
runs de la misma celda pueden producir descomposiciones distintas. Esto se
mitiga parcialmente con las 2 repeticiones y el orden alternado, pero no se
elimina.

**Limitación conocida del contrato de alcance.** De cuatro ejecuciones del caso
canónico, una completó; el resto fue rechazada porque los agentes crearon
archivos que el planificador no había declarado en `plannedPaths`
(`../canonical-run/README.md` §7). Este modo de falla afecta a las tres
condiciones, pero **no necesariamente por igual**: la condición B, al generar
más unidades con alcances más estrechos, es a priori la más expuesta. Es un
factor de confusión declarado, y la regla de inconclusión (§8.7) existe
precisamente por él. **Se recomienda resolver esa causa raíz antes de ejecutar
el experimento.**

**Validez de constructo.** Los pesos y el umbral de $C_{\mathit{task}}$ son
parámetros de diseño no calibrados. El experimento evalúa la política tal como
está configurada, no la formulación en general.

**Validez externa.** Un repositorio, un lenguaje, un modelo, dos tareas. No es
extrapolable a repositorios grandes, a otros lenguajes ni a otros proveedores.

**Riesgo de implementación.** Las condiciones A y B requieren código que hoy no
existe (§2). Un defecto en esa parametrización afectaría a las condiciones de
forma asimétrica. Debe cubrirse con pruebas antes de ejecutar.

## 10. Qué conclusiones permite este diseño y cuáles no

### Permite

- Afirmar que el recorrido completo es **viable** bajo las tres condiciones, o
  identificar cuáles no completan.
- **Describir trade-offs observados** entre éxito, duración y costo, con los
  valores de cada run a la vista.
- **Caracterizar modos de falla** por condición (RQ3), que es donde un diseño
  pequeño rinde más: los modos de falla son cualitativos y no requieren muestra
  grande.
- Mostrar si la política adaptativa **evita el extremo** de sobre-división en
  una tarea acotada, que es una propiedad observable en una sola ejecución.

### No permite

- Afirmar que la política adaptativa es **superior** a una estrategia fija. Eso
  exige una muestra mucho mayor.
- Reportar **significancia estadística**, p-valores o intervalos de confianza.
- Generalizar a otros repositorios, lenguajes, modelos o familias de tareas.
- **Calibrar** los pesos o el umbral.
- Sostener una afirmación de **eficiencia de costo** sobre la base del `GEI`.

La redacción de la tesis debe mantenerse dentro de estos límites: el resultado
esperado es una **evaluación exploratoria de viabilidad, trade-offs y modos de
falla**, no una demostración de superioridad.

## 11. Entregables

```text
docs/tesis/evidence/experiment/
  protocol.md          (este documento, registrado antes de ejecutar)
  environment.json     (versiones, hardware, modelo, commit de ManyHands)
  tasks/               (T1.md, T2.md con objetivo y criterios de aceptación)
  raw/runs.csv         (una fila por run)
  raw/run-artifacts/   (journal, snapshot, métricas y diff por runId)
  scripts/             (agregación y generación de tablas)
  derived/summary.csv  (generado, nunca editado a mano)
  analysis.md          (resultados e interpretación)
  limitations.md       (amenazas materializadas)
```

Cada fila de `raw/runs.csv` debe contener: `runId`, tarea, condición,
repetición, posición en el orden de ejecución, commit de ManyHands, commit base,
`finalSha`, entrega verificada, cobertura, duración, tokens, costo, intentos,
reintentos, modo de falla y ruta a los artefactos.

Las tablas de la tesis se generan desde `raw/` mediante los scripts. **Ningún
número se escribe a mano en el documento.**

## 12. Procedimiento de ejecución

```bash
# Precondiciones
#  1. Resolver la causa raíz del contrato de alcance (recomendado; ver §9).
#  2. Parametrizar umbral y críticos por run, versionando formulaVersion.
#  3. Fijar UN commit de ManyHands para los 12 runs.

export MANYHANDS_SESSION_TOKEN=<uuid>
export MANYHANDS_CODEX_BIN=codex
pnpm --filter @manyhands/web exec next dev -p 3111

# Por cada fila de la tabla de §5, en ese orden exacto:
#  a. git -C <target> reset --hard <baseSha> && rm -rf <target>/.manyhands
#  b. POST /api/runs con la condición correspondiente
#  c. POST /api/runs/<id>/decisions/<approve-plan-id>  { optionId: "approve" }
#  d. POST /api/runs/<id>/deliver  (solo si alcanza result_ready)
#  e. copiar artefactos a raw/run-artifacts/<runId>/ y agregar la fila a runs.csv
```

Los artefactos por run son
`.manyhands/runs/<runId>.events.v2.jsonl`,
`.manyhands/runs/<runId>.snapshot.v2.json`,
`.manyhands/runs/<runId>.granularity-metrics.json` y el diff
`git -C <target> diff <base>..<final>`.
