# Los seams no participaban en la detección de ciclos

Clasificación: **defecto de validación del grafo**. Es el primer caso del piloto
donde un término de la política C detecta una contradicción que el compilador
deja pasar.

## Observación

`warehouse-wide-n16`, run `bc859c1d`, política `adaptive-utility/3.1.0-pilot`.
El árbol candidato persistido declara sobre 19 hijos:

    artifact-projection-registry    projection-registry    -> [study-wide-graph-script]
    seam-study-wide-graph-command   study-wide-graph-script -> [projection-registry]

Las dos relaciones son inversas entre sí: el artifact dice que el script consume
el registry, y el seam dice que el registry consume el script. Es un ciclo de
dos nodos.

El grafo **compiló igual**, se aprobó, y 19 agentes trabajaron unos cuarenta
minutos. Las 19 hojas quedaron `Verified [1/1 passed]`. El run murió recién en
la integración de la raíz:

    failure.classified  integration:conflict  "Integration required semantic repair."
    integration.failed  "The single semantic repair attempt failed."

## Causa

`validateGraphRevision` construye su mapa de adyacencia con
`artifactRequirements` y `legacyOrderingConstraints`. Los `seamBindings` sólo se
revisaban por auto-relación:

```ts
for (const binding of graph.seamBindings) {
  if (binding.producerNodeId === binding.consumerNodeId) { /* self_relation */ }
}
```

Nunca se agregaban como arista. Un seam nombra un productor y un consumidor
exactamente igual que un artifact, así que la mitad de las dependencias
declaradas era invisible para el único chequeo capaz de detectar una
contradicción. Un ciclo cerrado por un seam pasaba entero.

## Qué sí lo detectó

El término `coordination` de la política C, que en `3.1.0-pilot` recorre
artifacts ∪ seams y devuelve 1 cuando el grafo no es ordenable:

    parallelism   0.8889     <- sólo artifacts; el fan-out real
    coordination  1          <- artifacts ∪ seams; el ciclo

Fue la única señal en todo el sistema que marcó el problema antes de la
integración. No sirvió para frenar el run porque `coordination` es un costo de
la función de utilidad, no una barrera de validación.

Nota sobre `parallelism`: con la fórmula anterior (`1 - aristas/(hijos-1)`) este
corte daba **0** — 18 aristas de artifact sobre 18 — pese a ser un fan-out de 19
unidades casi enteramente paralelo. Con `3.1.0-pilot` da **0.8889**. Es la
primera validación del rediseño sobre datos productivos reales.

## Corrección TDD

- Rojo: un grafo con artifact `n2 -> n3` y seam `n3 -> n2` devolvía `[]`, sin
  ninguna incidencia.
- Control negativo: un seam en la **misma** dirección que su artifact no debe
  producir error.
- Verde: los `seamBindings` se agregan a la adyacencia con tipo de arista
  propio. La clasificación existente los reporta como `artifact_cycle`, igual
  que cualquier ciclo que no sea puramente jerárquico.

Consecuencia declarada: la dirección de un seam pasa a ser vinculante para la
validación. Si más adelante aparece un caso legítimo de interfaz mutua entre dos
unidades, ése es el momento de separar el código de incidencia, no antes.

## Qué no se concluye

No se concluye que el ciclo sea la causa del fallo de integración. La reparación
semántica falló sobre `src/analytics/projections.test.ts`, un archivo de test
compartido que las 19 hojas escribieron; eso es un defecto distinto y todavía
sin corregir. Lo que sí queda establecido es que el grafo nunca debió compilar,
y que ahora no compila.
