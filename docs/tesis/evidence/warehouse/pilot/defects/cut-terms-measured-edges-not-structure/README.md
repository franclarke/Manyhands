# `parallelism` y `coordination` medían aristas, no estructura

Clasificación: **defecto de diseño de la política C**. A diferencia del caso
anterior, este no se detectó por un contrafáctico sino por inversión de los
features registrados: los dos términos que deciden un corte estaban en sus
extremos simultáneamente sobre un corte que no los justificaba.

## Observación

Root `w2-control-tower-visual`, `series-12`, política
`adaptive-utility/3.0.0-pilot`, tres hijos:

    parallelism   0        <- el mínimo posible
    coordination  1        <- el máximo posible
    benefit       0.3617
    cost          0.4835
    splitAdvantage -0.1217 < 0.1500  ->  leaf

Los tres hijos (`w2-visual-domain-metrics`, `w2-react-svg-app`,
`w2-probe-and-tooling`) son unidades de capas distintas. Ninguno de los dos
extremos describe ese corte.

## Causa

Ambos términos contaban aristas y ninguno miraba la forma del grafo.

**`parallelism = 1 - aristas / (hijos - 1)`.** El divisor es la cantidad de
aristas de un árbol de expansión, es decir el **mínimo** que puede tener un
corte conexo. Por lo tanto todo corte conexo daba cero, y un fan-out — donde
todos los consumidores avanzan a la vez detrás de un productor — era
indistinguible de una cadena estricta, donde no avanza nada en paralelo. El
software en capas es conexo por construcción: el término no aportaba nada a
ninguna descomposición de las que debía juzgar.

**`coordination = aristas / hijos`.** Un corte conexo pagaba al menos
`(n-1)/n`, y el valor **crecía hacia 1 a medida que el corte se agrandaba**: una
cadena de ocho unidades costaba 0.875 y una de cuatro 0.75. Cuanto más limpia y
más grande la descomposición, más cara se declaraba. Además contaba dependencias
transitivamente implicadas como si fueran handoffs adicionales.

Juntos daban un sesgo estructural contra exactamente la forma que toma el
software en capas: dominio, después interfaz, después instrumentación.

## Corrección TDD

Rojo primero: tres aserciones que fallaron por la razón correcta —
fan-out ≡ cadena, transitiva ≠ cadena, y cadena de 8 más cara que cadena de 4.

Verde, política `adaptive-utility/3.1.0-pilot`:

- `parallelism = (n - L) / (n - 1)`, con `L` la longitud del camino crítico del
  orden de producción entre hijos. Independientes → 1; cadena estricta → 0;
  fan-out de 4 → 0.667. La concurrencia es una propiedad de la **profundidad**
  del orden, no del número de dependencias.
- Sólo los artifacts ordenan el trabajo. Un seam es una interfaz que ambos lados
  acuerdan antes de escribir cualquiera de los dos: restringe **qué** se
  construye, no **cuándo**.
- `coordination = 2 · |reducción transitiva| / (n · (n-1))`: la fracción de pares
  de hijos que deben coordinar directamente. Una dependencia que otra ya implica
  no es un segundo handoff y no se cobra.
- Un corte con ciclos no se puede planificar: `parallelism` 0, `coordination` 1.

## Qué le hace esto a W2

**Nada.** Hay que decirlo explícitamente porque el caso motivó el cambio.

El árbol candidato no se persiste — el journal guarda sólo su hash —, así que el
conjunto exacto de aristas de W2 no es recuperable. Se enumeraron las **458
topologías** compatibles con los features registrados:

| parallelism | coordination | splitAdvantage | decisión | topologías |
|---:|---:|---:|---|---:|
| 0 | 1 | -0.1217 | leaf | 356 |
| 0 | 0.6667 | -0.0384 | leaf | 12 |
| 0.5 | 1 | 0.0449 | leaf | 78 |
| 0.5 | 0.6667 | 0.1283 | leaf | 12 |

Bajo **ninguna** topología admisible la política 3.1.0 divide W2. El mejor caso
llega a 0.1283 contra un umbral de 0.1500.

No se toca `minimumAdvantage` para forzar el resultado. La corrección se sostiene
por lo que los términos miden mal, no por el caso que la motivó; ajustar el
umbral hasta que W2 divida sería ajustar al resultado.

## Corrección de un resultado anterior

El documento [`leaf-feasibility-ignored-production`](../leaf-feasibility-ignored-production/README.md)
dejó pendiente anclar `maxLeafPlannedPaths` entre los conteos de W1 y W2. Medido:

| Increment | plannedPaths | Resultado |
|---|---:|---|
| W1 | **10** | entregó `71f61c9e`, oráculo PASS |
| W2 | **6** | no entregó |

**No hay cota que separe los dos casos**: cualquier valor que rechace W2 (≤ 5)
habría rechazado también W1. El conteo de paths declarados no es proxy del
volumen de trabajo — los 6 paths de W2 incluyen una aplicación Vite/React
completa. La cota agregada en `4b27fe9` sigue siendo correcta como límite
superior, pero queda registrado que **no discrimina** estos dos casos y que su
valor 12 no está anclado empíricamente.

Contribuye a la deflación una regla del prompt del planner que yo mismo
introduje: editar un `package.json` o `tsconfig` existente es evidencia, nunca
planned path. Es correcta para el grounding y a la vez saca del conteo trabajo
real, que es justo la señal que la cota lee.

## Defecto de reproducibilidad que esto expone

La entrada de la política — el árbol candidato del Architect — no se persiste.
`planning.granularity_strategy_selected` guarda `candidateTreeHash` y los
features derivados, pero no el árbol. Consecuencia concreta: la decisión de C no
es reproducible desde el journal, y este análisis tuvo que enumerar topologías en
lugar de leer la que hubo. Para una tesis cuyo aporte **es** la política, la
entrada de cada decisión tiene que quedar en la evidencia.

## Qué no se concluye

No se concluye que 3.1.0 hubiera entregado W2, ni que los términos ahora estén
calibrados. Se concluye que medían algo distinto de lo que nombran, que el error
era estructural y no de calibración, y que corregirlo no alcanza para explicar el
colapso de W2.
