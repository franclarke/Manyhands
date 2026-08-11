# Rediseño de la política de granularidad

> **Estado**: dirección de diseño, no implementación.
> **Decisión**: se conserva la estructura, se reemplaza la función de decisión.

---

## 1. Qué se conserva y qué se tira

La pregunta era si eliminar la implementación actual o rediseñarla. La respuesta
es que son dos cosas distintas y sólo una está mal.

**Se conserva la separación de responsabilidades**, porque es el aporte y porque
está probada:

| Componente | Por qué queda |
|---|---|
| `RecursivePlanner` + `CutFeasibilityCritic` | El corte es semántico. Una regla determinista puede juzgar un corte, no inventarlo. |
| `selectGranularityStrategy` como punto de decisión | El planificador propone, la política elige. La frontera está en el lugar correcto. |
| `applyGranularitySelection` | La decisión se aplica sobre el `SemanticPlan`, la única fuente que lee el compilador. |
| Cotas de factibilidad de hoja | `maxLeafContextTokens`, `maxLeafScopePaths`, `maxLeafPlannedPaths` están ancladas a un fallo observado, no a una intuición. |
| El banco de regresión | 87 cortes reales. Cualquier función de decisión nueva se mide contra ellos antes de gastar un run. |

**Se reemplaza la función de decisión**, o sea todo lo que hoy vive entre las
features y el veredicto. Cuatro razones, en orden de gravedad:

1. **No expresa el objetivo.** El objetivo es maximizar calidad y minimizar
   costo. La regla actual produce un número adimensional —promedio de tres
   beneficios menos promedio de cuatro costos— del que no se puede decir "este
   corte cuesta X y compra Y". No tiene unidades, así que no se puede validar
   contra nada medido.
2. **La agregación es arbitraria.** ¿Por qué media de tres contra media de
   cuatro? ¿Por qué pesos iguales dentro de cada grupo? Ninguna de esas
   elecciones tiene justificación; son la forma más simple de combinar términos,
   no un modelo de nada.
3. **El umbral no decide.** Barrido sobre los 83 cortes viables: todo valor de
   `minimumAdvantage` en `[0, 0.20]` produce exactamente la misma partición
   (67 split / 16 leaf). Está en una meseta.
4. **El piso de aislamiento está atornillado por fuera.** Es una condición
   booleana adosada al score porque el score no sabía expresar lo que ella
   expresa. Que haya hecho falta es el síntoma de que el modelo agregado no
   captura el fenómeno.

**Advertencia sobre la versión actual (3.2.0).** Sus tres cambios se aplicaron
juntos, en un commit, con un solo bump. El banco reporta que 3 de 573 decisiones
se movieron pero **no está atribuido cuál cambio movió cuál**. El rediseño no
debe partir de 3.2.0 como si fuera un resultado establecido.

---

## 2. La dirección: costo esperado, en unidades reales

La regla actual pregunta *"¿la ventaja supera el umbral?"*. La regla que
propongo pregunta **"¿qué me sale más barato?"**, con el costo medido en algo
que existe: intentos y tokens.

### 2.1 El modelo

Sea `u` una unidad con `k` hijos propuestos.

**No partir** cuesta el intento de la hoja única, más el reintento esperado si
falla:

```
E[costo(hoja)] = c(u) + p_falla(u) · c(u)
```

donde `c(u)` es el costo de un intento sobre `u` (estimable por su masa de
contexto y su superficie de escritura) y `p_falla(u)` es la probabilidad de que
un intento único sobre esa masa no produzca un candidato válido.

**Partir** cuesta la suma de los hijos, más la integración, más el reintento
esperado — pero el reintento sólo alcanza al hijo que falló, en la medida en que
los hijos estén aislados:

```
E[costo(corte)] = Σ c(hᵢ) + c_int(k) + Σ p_falla(hᵢ) · [ c(hᵢ) + (1 − I) · Σ_{j≠i} c(hⱼ) ]
```

donde `I` es el aislamiento —la proporción de criterios de aceptación que ningún
par de hermanos comparte— y `c_int(k)` el costo de integrar `k` resultados.

**La regla:** partir cuando `E[costo(corte)] < E[costo(hoja)]`.

### 2.2 Por qué es mejor que lo que hay

**Cada término tiene unidades y significado.** "Partir cuesta 1,8× más tokens
pero reduce el costo esperado un 40 % porque un fallo no invalida las otras dos
capas" es una afirmación verificable. "La ventaja es 0,17 y el mínimo es 0,15"
no lo es.

**Los parámetros se estiman de datos, no se eligen.** `p_falla` en función de la
masa de contexto es exactamente lo que un run mide y persiste. El experimento
deja de ser una validación ceremonial y pasa a ser lo que produce la
parametrización.

**El aislamiento entra donde corresponde.** Hoy es un booleano adosado; en el
modelo es el factor que determina *cuánto trabajo se pierde cuando un hijo
falla*. Deja de necesitar un piso arbitrario y pasa a tener un gradiente: un
aislamiento de 0,8 vale menos que 1 y más que 0,3, cosa que la regla actual no
puede expresar.

**Explica por qué el corte en capas conviene aun sin paralelismo.**
`domain → application → api` es una cadena: no compra concurrencia. Lo que compra
es que el fallo del API no obligue a rehacer el dominio. El modelo de costo lo
dice solo; la regla actual necesitó una excepción para decirlo.

**Y explica el caso incómodo.** Sobre un repositorio de 999 tokens, `p_falla` de
la hoja única es baja, así que el término de reintento casi no aporta y el costo
de integración domina: el modelo dice *no partir*, que es la respuesta correcta.
El régimen donde partir gana es aquel donde `p_falla(u)` crece con la masa — que
es precisamente el régimen que ningún experimento previo tocó.

### 2.3 Lo que hay que estimar

| Parámetro | Cómo se obtiene |
|---|---|
| `c(u)` | Tokens consumidos por intento, en función de masa de contexto y rutas escritas. Ya se persiste en `AttemptUsage`. |
| `p_falla(u)` | Proporción de intentos que no producen candidato válido, por tramo de masa. **Requiere runs sobre unidades grandes**; con el corpus actual no se puede estimar. |
| `c_int(k)` | Costo del nodo composite: su propio intento de integración y su validación. Observable. |
| `I` | Ya se calcula (`faultIsolation`). |

**Ninguno se elige a mano.** Ese es el punto.

---

## 3. Orden de trabajo

1. **Ablación sobre el banco, antes de escribir nada nuevo.** Correr la política
   actual contra sí misma mutilada —sin piso de aislamiento, sin términos de
   costo, siempre hoja— y ver cuánto aporta cada parte. Si la política completa
   y "siempre partir si es viable" coinciden en la mayoría de los 87 casos, la
   regla actual es decorativa y conviene saberlo antes de reemplazarla.
2. **Instrumentar `c(u)` y `p_falla`** en el journal, si falta algo.
3. **Construir el target del experimento** (ver [el diseño del
   experimento](granularity-experiment.md)), porque sin él `p_falla` no se puede
   estimar en el régimen que importa.
4. **Correr el experimento**, estimar los parámetros, e implementar la regla.
5. **Validar la regla contra el banco** y contra una serie retenida.

El paso 1 es gratis y contesta la pregunta más incómoda. Es por donde se empieza.
