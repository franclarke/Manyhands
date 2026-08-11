# Diseño del experimento de granularidad

> **Estado**: diseño, sin ejecutar.
> **Pregunta**: ¿descomponer una tarea grande en un árbol produce mejor
> resultado a menor costo que no descomponerla?

---

## 1. Qué salió mal antes, para no repetirlo

Cuatro defectos, todos verificados sobre los registros que se retiraron:

**La condición de control nunca funcionó.** En los diez runs registrados bajo
condición A, la política seleccionó `leaf` —colapsar todo a una unidad— y esa
selección se descartaba antes de compilar. Las diez celdas etiquetadas "sin
descomposición" ejecutaron el árbol de siete hojas del planificador. No hubo un
resultado negativo: **no hubo instrumento**.

**La variable dependiente no dependía de la independiente.** Se medía "¿entregó?"
sobre un sistema depurado hasta que entregara. Un agente único con contrato de
alcance también entrega. Una variable binaria sobre un sistema afinado para
producir el 1 no puede mostrar un efecto de granularidad.

**El régimen excluía el fenómeno.** El target medía 999 tokens: el 4 % del
presupuesto de una sola hoja. La descomposición existe para cuando el trabajo no
entra en un intento. Ahí entraba cuarenta veces.

**Las tareas estaban en los extremos.** Una tocaba tres capas, la otra una
función pura. Cualquier regla monótona las separa. La predicción era trivial.

---

## 2. Estructura: dos preguntas, dos instrumentos

Estaban mezcladas en una sola serie que no podía responder ninguna.

### Q1 — ¿La cadena funciona de punta a punta?

Prueba de existencia. Un puñado de celdas, pre-registro, freeze, oráculo
externo. **n chico es legítimo**: se demuestra que existe, no se estima un
efecto. Es lo que la serie anterior hacía bien y hay que conservar.

**Esto no es una evaluación de la política.** No se reporta como tal.

### Q2 — ¿La política elige bien?

Es la pregunta de la tesis y necesita comparación.

---

## 3. Q2, etapa 1 — Ablación offline (costo cero)

Antes de gastar un solo run. El banco tiene 87 cortes reales; se corre la
política contra sí misma mutilada:

| Variante | Qué aísla |
|---|---|
| completa | línea base |
| sin regla de aislamiento | cuánto aporta esa regla |
| sin términos de costo (partir si es viable) | cuánto aporta el modelo de costo |
| siempre hoja | el suelo trivial |

**Qué se reporta:** matriz de acuerdo entre variantes. Si la política completa
coincide con "partir si es viable" en la gran mayoría de los casos, **la política
es decorativa** y hay que decirlo antes de diseñar 16 runs alrededor de ella.

Esto no valida nada — caracteriza. Es la diferencia entre saber qué hace tu
regla y suponerlo.

---

## 4. Q2, etapa 2 — Comparación viva

### 4.1 El target

**Criterio duro, no subjetivo:** la superficie que cada tarea debe leer y
escribir tiene que **superar `maxLeafContextTokens`**. Por debajo de eso, A y C
son la misma cosa y el experimento no puede discriminar.

El target se construye, se congela por SHA y se verifica antes de abrir celdas:
para cada tarea, medir la masa de contexto de su superficie declarada y
registrarla en el freeze. **Si alguna tarea entra holgada en un intento, esa
tarea no entra al experimento.**

### 4.2 Las tareas

Cuatro, y **ninguna en los extremos**. Al menos dos deliberadamente ambiguas:
casos donde el autor no sepa de antemano si conviene partir. Ahí es donde una
política vale algo; en los extremos cualquier regla acierta.

Cada tarea se declara con su forma esperada **antes** de correr, pero esa
predicción no es la hipótesis — es un control de que el instrumento discrimina.

### 4.3 Condiciones

**A (una sola hoja) contra C (adaptativa).** Se deja B afuera: duplica el costo
y es la condición menos informativa.

**Antes de abrir celdas hay que verificar que A colapsa de verdad**, sobre un
run de ensayo, leyendo el árbol compilado y no la etiqueta. Es exactamente el
defecto que invalidó la serie anterior y el ensayo cuesta un run.

**Diseño intra-tarea**: cada tarea corre bajo A y bajo C. Cada tarea es su propio
control, lo que elimina la varianza entre tareas del contraste.

**4 tareas × 2 condiciones × 2 repeticiones = 16 runs.**

### 4.4 Variables dependientes

No una. Un vector, porque el objetivo tiene dos lados:

| # | Variable | Lado |
|---|---|---|
| 1 | El oráculo externo pasa sobre el SHA entregado | calidad |
| 2 | Tokens totales consumidos | costo |
| 3 | Intentos fallidos antes del candidato aceptado | costo |
| 4 | Ciclos de reparación | costo |
| 5 | Violaciones de alcance detectadas | calidad |

Con esto se puede afirmar algo que ninguna serie anterior podía: *"descomponer
costó 2,3× los tokens y entregó en 3 de 4 tareas donde la hoja única entregó en
1"*. O lo contrario. **Las dos son resultados publicables.**

### 4.5 El oráculo

Externo al target, ejecutado sobre un checkout limpio del SHA candidato, sin
leer prompts ni journals. Preflight bidireccional obligatorio: **debe fallar
sobre el target intacto y pasar sobre una solución de referencia** escrita fuera
del repositorio. Sin la segunda mitad no se distingue "el sistema falló" de "los
criterios eran imposibles".

**Mitigación de la circularidad:** el oráculo lo escribe la misma persona que
las tareas, así que mide conformidad a una especificación propia. Se declara como
límite, y sus criterios se publican textuales en un apéndice para que un tercero
pueda juzgarlos.

### 4.6 Reglas fijadas antes de correr

- Un `not_run` no cuenta como PASS.
- No hay reemplazo de celdas ni reintento de una repetición fallida.
- El ensayo previo no integra el denominador, y **cualquier corrección de código
  que produzca queda registrada en el freeze** — un ensayo que cambia el
  artefacto evaluado no es gratis.
- **Regla de detención**: si A y C entregan igual en las cuatro tareas, el
  resultado es que *en este régimen la descomposición no aporta*, y se reporta
  así. Escrito antes de ver un solo run.

---

## 5. Qué no hacer

**No buscar significación estadística.** Con 16 runs no la hay, y fingirla es
peor que no tenerla. Se reporta una tabla por tarea con los cinco números y se
cuentan victorias. Una demostración de ingeniería replicable con un vector de
costo honesto vale más que un p-valor inventado sobre n=4.

**No mezclar Q1 con Q2.** La prueba de existencia y la comparación tienen
denominadores distintos y no se suman.

**No reinterpretar una serie fallida.** Si el instrumento no discrimina, se
frena la serie, se corrige y se abre un freeze nuevo.

---

## 6. Qué habilita concluir

Con este diseño se puede sostener:

> Bajo un target donde una unidad excede el presupuesto de un intento, y para
> las cuatro tareas pre-registradas, descomponer produjo *[más/menos]* entregas
> verificadas externamente a un costo de *[N]×* en tokens.

Y **no** se puede sostener —hay que decirlo explícitamente— superioridad
general, optimalidad de la topología elegida, escalabilidad a monorepos, ni
generalización a otros lenguajes o modelos.

Es una afirmación más chica que la que la tesis intentaba antes. También es la
primera que su evidencia puede sostener.
