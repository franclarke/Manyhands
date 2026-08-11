# Demostración longitudinal: plan de trabajo

> **Objetivo**: mostrar que ManyHands construye software en iteraciones sucesivas
> sobre su propio resultado, decidiendo la granularidad con reglas explicables, y
> **medir dónde descomponer empieza a hacer falta**.

---

## 1. Qué se quiere demostrar

Tres afirmaciones, en orden de importancia:

1. **El sistema entrega.** Sobre un repositorio que crece, cuatro iteraciones
   producen software integrado y verificado externamente.
2. **Se recupera de sus fallos.** Un fallo en ejecución no termina el run: el
   sistema repara y entrega. *No se busca que no falle; se busca que no quede
   fallado.*
3. **La descomposición empieza a hacer falta en algún punto.** Cada iteración
   corre en dos condiciones —descompuesta y en una sola unidad— y el cruce entre
   ambas es el resultado.

La tercera es la más valiosa y la que ninguna serie anterior pudo dar. Es más
fuerte que "4/4 PASS" porque tiene una variable independiente real: el tamaño del
repositorio.

---

## 2. La política de granularidad

Reemplaza el promedio de siete features, cuya ablación mostró que aportaba 10
colapsos dispersos sobre 83 cortes.

**Se parte por tres razones, cada una observable:**

| # | Razón | Cómo se mide | Qué compra |
|---|---|---|---|
| 1 | **No entra** | La unidad excede `maxLeafContextTokens`, `maxLeafScopePaths` o `maxLeafPlannedPaths` | Factibilidad: sin esto el intento no puede terminar |
| 2 | **Corre en paralelo** | Los hijos no están encadenados por artefactos que bloqueen ejecución | Tiempo de reloj |
| 3 | **Se verifica por separado** | Cada hijo posee criterios de aceptación que ningún hermano comparte | Que un fallo no invalide el trabajo de los demás |

**Se colapsa cuando no vale ninguna de las tres.**

### 2.1 Por qué el paralelismo es la razón 2 y no la única

El scheduler despacha un nodo cuando sus artefactos requeridos existen. Un corte
en capas —`domain → aplicación → API`— produce aristas de artefacto entre los
hijos, así que se ejecutan **en fila**: tres intentos secuenciales más la
integración, contra un solo intento que hace todo junto. Ese corte es
probablemente *más lento*, no más rápido.

La ganancia de tiempo existe sólo cuando los hijos son independientes. Por eso la
razón 2 mide independencia, no cantidad de hijos.

Un corte en capas sigue partiéndose, pero **por la razón 3**: no gana velocidad,
gana que un fallo en la API no obligue a rehacer el dominio. La política debe
decir cuál de las tres razones aplicó, porque son promesas distintas.

### 2.2 Qué se retira

`benefit`, `cost`, `minimumAdvantage`, `contextRelief`, `coordination`,
`pathOverlap`, `validationDuplication`, `uncertainty`. Nueve conceptos que no se
pueden justificar en una oración cada uno.

**Verificación obligatoria**: medir la política nueva contra el banco de 83
cortes antes de usarla, y reportar en cuántos casos difiere de la actual.

---

## 3. Robustez: recuperarse, no evitar

La maquinaria existe y estaba **apagada a propósito** en los experimentos
anteriores (`automaticRetryBudget: 0`, para que el experimento fuera limpio).
Para esta demostración se prende:

- `automaticRetryBudget` > 0 en ejecución de hojas.
- `maxRepairsPerIntegration` > 0 para la reparación semántica en integración.

**Regla de reporte**: un fallo recuperado se muestra, no se esconde. Una
iteración donde el sistema falla, detecta, repara y entrega es evidencia más
fuerte de robustez que cuatro éxitos limpios, y el Run Workspace ya lo visualiza.

---

## 4. El target

### 4.1 Forma técnica

**Node ESM puro, sin framework y sin paso de build.**

- Servidor HTTP mínimo (`node:http`) que sirve HTML renderizado en el servidor.
- `node --test` como comando de validación, descubierto por el indexador.
- Núcleo de funciones puras separado de la capa HTTP.

El fallo documentado de Warehouse fue una hoja que debía crear una aplicación
Vite/React entera en un intento. Un stack sin build elimina esa clase de fallo
por completo, y una página HTML real sirve igual para capturas.

**Prohibido en el target**: relojes (`Date.now()`), aleatoriedad, números con
decimales, red. Los tres primeros rompen el determinismo del oráculo; el cuarto
lo hace frágil.

### 4.2 Dominio

**Catálogo de recetas**: recetas, ingredientes, etiquetas, filtros, lista de
compras derivada, estadísticas.

El criterio no es el tema sino la **forma del grafo de dependencias**: filtrar no
depende de la lista de compras, que no depende de las estadísticas. Son
independientes, así que el planner las propone como hijos paralelos y la razón 2
de la política tiene dónde aplicarse. Un dominio estrictamente en capas daría
cortes pero no velocidad.

### 4.3 Punto de partida

**No** un directorio vacío. En un repositorio sin nada el planner no tiene
evidencia sobre la cual fundar su plan, que es exactamente donde Warehouse falló.

El punto de partida es un repositorio que existe pero **no es la aplicación**:

```
package.json      # con "test": "node --test test/*.test.mjs"
test/             # vacío
README.md         # qué se quiere construir
```

Diez minutos de trabajo manual. La aplicación entera la genera el sistema.

---

## 5. Las iteraciones

| # | Qué agrega | Régimen esperado |
|---|---|---|
| 1 | El núcleo: modelo de receta, almacén en memoria, servidor que lista | Chico. Descomponer no debería hacer falta. |
| 2 | Etiquetas y filtrado | Chico-medio. |
| 3 | Lista de compras derivada + estadísticas | Medio. Dos partes independientes: la razón 2 debería activarse. |
| 4 | Persistencia en disco, importación/exportación y una vista de detalle | Grande. Debería exceder un intento. |

**Antes de cada iteración se mide y se registra la masa de contexto del
repositorio.** Ese número es el eje X del resultado.

### 5.1 Las dos condiciones

Cada iteración corre en **A** (una sola unidad, sin descomponer) y en **C**
(política adaptativa). La cadena continúa desde el resultado de **C**; el
resultado de A se mide y se descarta.

**Verificación obligatoria antes de la primera iteración**: confirmar sobre un
run de ensayo que la condición A **colapsa de verdad**, leyendo el árbol
compilado y no la etiqueta. En todas las series anteriores A decía "una hoja" y
ejecutaba siete; nadie lo miró y eso invalidó toda comparación.

### 5.2 Qué se anota por run

1. ¿Pasó el oráculo externo sobre el SHA entregado?
2. Tokens totales.
3. Tiempo de reloj de punta a punta.
4. Intentos fallidos antes del candidato aceptado.
5. Ciclos de reparación ejecutados.
6. Violaciones de alcance detectadas.
7. Topología: profundidad, hojas, y **cuál de las tres razones aplicó en cada
   corte**.

El punto 3 es nuevo respecto de los diseños anteriores y es el que sostiene la
afirmación sobre paralelismo.

---

## 6. El oráculo

Uno por iteración, **acumulativo**: el de la iteración 3 verifica también lo que
prometieron la 1 y la 2. Así una regresión posterior no pasa desapercibida.

- Vive fuera del target y fuera de ManyHands.
- Recibe la ruta de un checkout limpio del SHA candidato.
- No lee prompts, ni trazas, ni el journal.
- **Preflight bidireccional obligatorio**: debe fallar sobre el estado previo a
  la iteración y pasar sobre una solución de referencia escrita a mano. Sin la
  segunda mitad no se distingue "el sistema falló" de "los criterios eran
  imposibles".

---

## 7. Reglas fijadas antes de correr

- **Si una iteración falla**: la cadena continúa desde el último estado que pasó
  su oráculo, y el fallo se reporta con su causa. No se reintenta la iteración
  con un enunciado distinto.
- **Un `not_run` no es un PASS.**
- **El ensayo de la condición A no cuenta**, y si produce una corrección de
  código, esa corrección se registra: un ensayo que cambia el artefacto evaluado
  no es gratis.
- **Regla de detención**: si A entrega en las cuatro iteraciones, el resultado es
  que *en este rango de tamaño la descomposición no fue necesaria*, y se reporta
  así. Escrito antes de ver un solo run.

---

## 8. Lo visual

- **La app creciendo**: captura de la página en cada iteración.
- **El grafo de cada run**: chico y plano en la iteración 1, ancho y profundo en
  la 4. Sale del Run Workspace.
- **Una recuperación**: la secuencia fallo → reparación → entrega, si ocurre.
- **El gráfico del cruce**: masa de contexto en el eje X; para cada iteración, si
  A entregó y si C entregó, más el tiempo de reloj de cada uno.

Ese último gráfico es el resultado de la tesis.

---

## 9. Orden de ejecución

| # | Trabajo | Costo |
|---|---|---|
| 1 | Reescribir la política con las tres razones y medirla contra el banco | medio día |
| 2 | Prender reintentos y reparación; elegir valores | medio día |
| 3 | Armar el punto de partida y escribir el oráculo de la iteración 1 | medio día |
| 4 | Ensayo de la condición A | 1 run |
| 5 | Iteración 1 en A y C, e inspección completa antes de seguir | medio día |
| 6 | Iteraciones 2, 3 y 4 | 6 runs |
| 7 | Capturas, gráfico y escritura | — |

El paso 5 es un punto de control: si la iteración 1 sale mal, conviene entender
por qué antes de comprometer la cadena entera.

---

## 10. Qué habilita concluir

> Partiendo de un repositorio vacío de código, ManyHands construyó una
> aplicación en cuatro iteraciones sucesivas sobre su propio resultado. Hasta la
> iteración *N* una sola unidad alcanzaba; desde la *N+1* sólo la versión
> descompuesta entregó. Los cortes se decidieron por tres reglas declaradas, y el
> sistema se recuperó de *k* fallos de ejecución sin intervención humana.

Y **no** habilita: superioridad general, optimalidad de la topología,
escalabilidad a monorepos, ni generalización a otros lenguajes o modelos. Eso se
declara.
