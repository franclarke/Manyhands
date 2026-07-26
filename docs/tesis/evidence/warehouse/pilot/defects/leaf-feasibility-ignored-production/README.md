# La factibilidad de hoja ignoraba lo que había que producir

Clasificación: **defecto de diseño de la política C**. Es el primer caso del
piloto donde la política decide mal y el contrafáctico queda a la vista.

## Observación

W2 de `series-12` corrió dos veces, con executors y topologías opuestas, y las
dos agotaron el reloj sin entregar:

| Executor | Hojas que eligió C | Resultado |
|---|---:|---|
| Claude Code `sonnet` | 4 | timeout |
| Codex `gpt-5.5` | **1** | timeout a los 30 min exactos |

El caso limpio es el segundo. El Architect **sí** había propuesto un corte de
tres hijos sobre `w2-control-tower-visual`:

- `w2-visual-projection`
- `w2-react-svg-app`
- `w2-probe-visual-capability`

C lo reconoció viable (`splitViable: true`) y lo colapsó igual:

    splitAdvantage -0.2576 < minimumAdvantage 0.1500
    leafFeasible: true

Esa hoja única consumió treinta minutos y no entregó nada.

## Causa

`isLeafFeasible` medía únicamente lo que la unidad debía **leer**:
`measuredExistingTokens` contra el presupuesto de contexto, y la cantidad de
paths de alcance. Tras W1 el repositorio era diminuto, así que leer era gratis y
la raíz pasó ambas cotas.

Pero W2 tenía que **crear** una aplicación Vite/React entera. La política no
tenía ningún término para el volumen de producción, aunque el perfil de contexto
ya venía midiendo `plannedPathCount` — la señal existía y no se usaba.

Descartado por medición, no por argumento: se sospechó que el costo estaba en
instalar dependencias por worktree. Instalar el árbol Vite+React cuesta 17 s en
frío y **6 s** con el store caliente, sobre 2966 archivos. No explica treinta
minutos, y confirma que el aislamiento por worktree es barato: el costo de
descomponer es tiempo de agente, no duplicación de entorno.

## Corrección TDD

- Rojo: una unidad con 24 paths planificados sobre un repositorio vacío se
  declaraba hoja factible.
- Verde: leer y producir son cotas separadas. `maxLeafPlannedPaths` acota lo que
  una hoja puede traer a la existencia. La política pasa a
  `adaptive-utility/3.0.0-pilot`.
- El valor 12 es provisional y está declarado como tal: anclarlo entre los
  conteos de W1 (entregó) y W2 (no) es tarea del piloto.
- Verificación: suite completa 1350 PASS, 0 fallos; typecheck y build PASS.

> **Corrección posterior.** El anclaje propuesto arriba es imposible: W1 entregó
> con **10** planned paths y W2 falló con **6**. Ninguna cota separa los dos
> casos. La cota sigue siendo un límite superior válido, pero no discrimina aquí
> y su valor no está anclado empíricamente. Detalle en
> [`cut-terms-measured-edges-not-structure`](../cut-terms-measured-edges-not-structure/README.md).

> **Corrección posterior.** El reintento de W2 con esta cota no cambió la
> decisión (la cota no llegó a activarse) y además **no terminó en timeout**:
> murió a los 3 minutos porque `git worktree add` encontró
> `worktree-pool/1ef32c5c37a6/slot-000` ya existente, dejado por el run abortado
> anterior. La tabla de arriba describe las dos corridas previas, no ésta.

> El defecto de recuperación y su reclasificación como infraestructura están en
> [`worktree-pool-orphan-recovery`](../worktree-pool-orphan-recovery/README.md).

## Nota de nomenclatura

La política se llama **C** en el lenguaje de la tesis. La etiqueta `C` sobrevive
en los journals ya persistidos y no se renombra ahí: esos eventos son evidencia
inmutable.

## Qué no se concluye

No se concluye que dividir hubiera entregado W2. Se concluye que la política
declaró factible una hoja que empíricamente no lo era, y que lo hizo por una
señal ausente y no por un juicio discutible.
