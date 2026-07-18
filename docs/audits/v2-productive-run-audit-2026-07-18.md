# Auditoría del Run productivo V2 — 2026-07-18

## Alcance y evidencia

Esta auditoría revisa el camino productivo desde `POST /api/runs` hasta la
propuesta de grafo, tomando como evidencia código, tests, journal durable y una
verificación visual en navegador.

Runs inspeccionados:

- `72a1c639-3f7d-4f06-b7e5-9650449df9e2`: reproducción original sobre un
  repositorio greenfield. Falló al compilar el scope de
  `app-shell-and-persistence-foundation`.
- `5d765f05-7b81-4d19-881b-d3a1f7f9158e`: smoke intermedio. Demostró cinco
  nodos progresivos y expuso que preguntas legítimas se convertían
  incorrectamente en `planning.failed`.
- `9ce41047-516b-4028-857c-3bde3eccec8b`: smoke posterior a las correcciones.
  Demostró planificación greenfield, nodos progresivos, decisiones durables y
  replanificación con respuestas humanas. Se interrumpió al detectar que el
  servidor aún tenía cargado un `dist` anterior de `decomposer`.
- `b82d595e-f1aa-4c51-900e-acd9cbd14cf0`: smoke final después de recompilar
  todos los paquetes y reiniciar el servidor. Alcanzó `needs_approval` con seis
  nodos, seis bundles de contratos, cero preguntas pendientes, cero findings de
  error y scopes greenfield concretos.

La revisión se realizó en el worktree aislado
`C:\Users\franc\AppData\Local\Temp\manyhands-target-v2-fix`, rama
`codex/target-architecture-v2`. La instancia existente en el puerto 3001 corre
desde otro checkout y no debe considerarse evidencia de esta revisión.

## Resultado ejecutivo

El fallo original no era del executor: el Planner no podía declarar archivos
nuevos y el compiler sólo aceptaba paths ya presentes en el snapshot. Esto
hacía imposible cualquier proyecto vacío. El contrato ahora distingue evidencia
existente (`evidenceIds`) de outputs planificados (`plannedPaths`), y scope,
artifacts y critics comparten esa misma verdad.

El grafo ya no espera a `graph.compiled`. El journal persiste intentos y unidades
descubiertas durante la salida incremental de Claude, y el cliente construye un
grafo provisional que luego reemplaza por la revisión compilada. El viewport se
encuadra una sola vez; nuevos nodos y eventos no ejecutan `fitView`, pan ni zoom.

Las ambigüedades de producto ya no hacen fallar la planificación. Se convierten
en decisiones `clarify_goal`; al resolver la última, el sistema replantea con las
respuestas como requisitos autoritativos. La ejecución no arranca hasta que
existe un grafo compilado y aprobado.

## Findings

| Capacidad | Antes | Estado actual | Evidencia |
|---|---|---|---|
| Greenfield y archivos nuevos | incompatible | implemented | `plannedPaths` en schema, prompt, compiler y critics; smoke real superó el error de scope |
| Evidencia de repositorio parcial | partial | implemented | paths, scripts, stack y diagnósticos se conservan juntos |
| Grafo durante planning | missing | implemented para Claude | eventos `planning.attempt_*` y `planning.node_discovered`; smoke real mostró nodos antes de finalizar |
| Streaming con Codex CLI | unknown | partial | el host consume stdout incremental, pero depende de que la CLI emita chunks útiles |
| Preguntas humanas de planning | incompatible | implemented | `decision.raised`, resolución durable y replanificación; no se inicia ejecución prematura |
| Estabilidad del viewport | incompatible | implemented | sin `fitView`; un único encuadre inicial; verificación visual con crecimiento de 1 a 4 nodos |
| Texto UI UTF-8 | incompatible | implemented | literales corregidos y regresión que escanea `apps/web/src` |
| Lock de repositorio en Windows | partial | implemented | `EPERM` y `EBUSY` se tratan como contención transitoria en takeover |
| Run completo hasta delivery | unknown | pendiente de smoke dedicado | el smoke final llegó a `needs_approval`; no afirma ejecución ni delivery end-to-end |
| Rama servida en 3001 | incompatible | pendiente de integración | `main` no contiene el commit base de V2; hay que integrar y reiniciar desde una sola revisión |

## Correcciones implementadas

1. `WorkUnit.plannedPaths` declara outputs greenfield concretos sin inventarlos
   como evidencia existente.
2. El compiler incorpora esos outputs a scopes y artifacts; los critics rechazan
   tanto paths no fundamentados como un `plannedPath` que ya existía.
3. El Planner emite progreso canónico por intento y unidad. Los IDs de nodo
   provisionales coinciden con los de compilación.
4. El reducer cliente deriva un grafo provisional del último intento y lo
   reemplaza con `graph.compiled` sin overrides imperativos.
5. Las preguntas consecuenciales producen decisiones locales. Las respuestas se
   agregan al siguiente prompt y no disparan ejecución.
6. La UI eliminó mojibake literal y el canvas conserva la posición elegida por
   el usuario durante generación, fallos e integración.

## Riesgos y trabajo siguiente

1. **Integración operativa:** integrar esta rama en `main`, detener servidores
   antiguos y arrancar una sola instancia desde el commit resultante. Mientras
   eso no ocurra, la UI del puerto 3001 seguirá mostrando el comportamiento viejo.
2. **Latencia del planner:** el smoke coherente terminó en el primer intento,
   pero tardó más de un minuto antes del primer nodo. Debe medirse y explicarse
   esa latencia en UI; los intentos del smoke con `dist` mezclado no son evidencia
   válida sobre la tasa real del proveedor.
3. **Streaming Codex:** verificar la forma exacta de su stdout o incorporar un
   adaptador de eventos propio; hoy la garantía fuerte sólo está demostrada para
   Claude Code CLI.
4. **E2E productivo:** ejecutar un repositorio descartable desde aprobación
   hasta artifact verificado y delivery, auditando worktrees, validación,
   integración y publicación por separado.

## Verificación

- Tests dirigidos de planning, graph, reducer, fixture, encoding, viewport y
  locks: 50 pasaron.
- Suite completa: 156 archivos, 915 tests pasaron y 1 quedó skipped.
- Typecheck de `decomposer`, `run-coordinator` y web: pasó.
- Lint web: pasó.
- Build de paquetes y build de producción web: pasaron durante la corrección;
  deben repetirse después de cualquier integración en `main`.
- Navegador: el nodo raíz quedó centrado inicialmente y mantuvo su posición al
  aparecer descendientes; no se observaron errores de consola de aplicación.
- Smoke greenfield final: `planning → graph.compiled → needs_approval`, seis
  nodos/contratos, ninguna pregunta y ningún finding de error.
