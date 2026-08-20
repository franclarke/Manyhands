# Experimento: jerarquía profunda (profundidad ≥ 3)

Estado: pendiente de ejecutar. Escrito el 2026-08-17, después de que el run de
"Cuentas Claras" produjera raíz + 4 hojas (profundidad 2).

## Qué queremos probar

Que el planner produce un árbol con **profundidad 3 o más**:

```
raíz (composite)
├── composite A ── hoja A1, hoja A2
├── composite B ── hoja B1, hoja B2
└── composite C ── hoja C1, hoja C2, hoja C3
```

Lo que importa del experimento:

- Hermanos en profundidad 3, es decir hojas que cuelgan de un composite
  intermedio y no de la raíz.
- Al menos una **integración intermedia**: un composite que compone los
  artifacts de sus propias hojas antes de que la raíz componga nada.
- Cuanto más grande el árbol, mejor: sirve para ver el comportamiento del
  scheduler y de la UI con más de una decena de nodos.

El run de "Cuentas Claras" no lo logró: dio raíz + 4 hojas. Las hojas
reclamaron directorios disjuntos correctamente, pero ningún hijo se expandió.

## Precondición operativa (bloqueante)

Un repo greenfield **no puede ejecutar** ninguna hoja. `prepareValidationRecipe`
busca una capability ejecutable para cada obligación; `RepositoryModel.commands`
sale del `package.json`, y si no hay `package.json` no hay comandos, así que
toda obligación required queda sin materializar y cada hoja falla con
`needs_input` antes de invocar al agente.

Por eso, antes de correr el experimento, el repo destino tiene que estar
inicializado con un commit que ya incluya:

- `package.json` con al menos `"test": "node --test"`.
- La estructura mínima de carpetas que el plan vaya a usar, o nada: los
  directorios nuevos ya son reclamables como `path:<dir>`.

Sin esto el experimento mide el planner pero nunca llega a ejecutar.

## Dominio propuesto

Una aplicación entendible por gente no técnica, con subsistemas que a su vez se
parten en piezas cohesivas — que es lo que fuerza el nivel intermedio.

**"Biblioteca Barrial"**: gestión de una biblioteca de barrio.

La estructura natural del dominio da tres subsistemas, y cada uno se divide
solo:

- Catálogo → libros y ejemplares / búsqueda y filtros.
- Socios y Préstamos → socios / préstamos, devoluciones y multas.
- Interfaces → API HTTP / CLI / reportes.

## Prompt del run

> Construir una aplicación en Node.js llamada "Biblioteca Barrial" para
> administrar una biblioteca de barrio: qué libros hay, quién es socio y quién
> se llevó qué.
>
> La aplicación tiene tres grandes áreas, y cada una se divide en partes que se
> pueden construir y probar por separado.
>
> 1. Catálogo
>    1.1. Libros y ejemplares: alta de libros con título, autor, año y género, y
>         varios ejemplares por libro, cada uno con su estado (disponible,
>         prestado, en reparación, perdido).
>    1.2. Búsqueda y filtros: buscar por título, autor o género, filtrar por
>         disponibilidad y ordenar por año o por título.
>
> 2. Socios y Préstamos
>    2.1. Socios: alta de socios con nombre, documento y fecha de ingreso, y
>         estado del socio (activo, suspendido).
>    2.2. Préstamos y multas: registrar un préstamo de un ejemplar a un socio
>         con fecha de vencimiento, registrar la devolución, y calcular la multa
>         por día de atraso. Un socio con multa impaga no puede pedir prestado.
>
> 3. Interfaces
>    3.1. API HTTP: endpoints REST para consultar el catálogo, registrar socios,
>         prestar y devolver (/api/books, /api/members, /api/loans).
>    3.2. CLI: interfaz por línea de comandos para hacer lo mismo desde la
>         consola.
>    3.3. Reportes: reporte de texto con los libros más prestados, los socios
>         con multas pendientes y el total de préstamos activos.
>
> Cada una de las seis partes numeradas debe tener sus propios tests unitarios
> con `node --test`. Además, cada una de las tres áreas debe tener un test que
> pruebe que sus partes funcionan juntas, y la aplicación completa debe tener un
> test end-to-end que recorra el flujo entero: dar de alta un libro, dar de alta
> un socio, prestar, devolver con atraso y ver la multa en el reporte.

La numeración en dos niveles y la exigencia de tests **por área** además de
tests por parte son la señal explícita de que cada área es un composite con
integración propia. Sin eso el planner tiende a aplanar todo contra la raíz.

## Qué mirar cuando corra

En el payload de `graph.compiled`:

- `nodes[].parentId`: tiene que haber nodos cuyo padre no sea la raíz.
- `nodes[].kind`: al menos tres `composite` además del `root`.
- `resourceClaims[]`: cada hoja con su `path:` propio y disjunto de sus
  hermanas.
- Bloqueos en `wave.selected`: que sean `missing_artifact` y no
  `resource_claim_conflict`. Un conflicto de recurso significa que volvimos a
  serializar por reclamos superpuestos.
