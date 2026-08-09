# 02 — La taxonomía nombra las causas que puede nombrar

**What to build:** `unclassified` deja de absorber causas que el sistema conoce
con precisión. Dos observadas en el ensayo, cada una con su clase y su política
de recuperación.

**Blocked by:** None — can start immediately.

**Status:** closed

## La observación

La etapa 5 cerró con la afirmación de que «toda falla mapea a exactamente una
causa con recuperación definida, y ninguna cae en un balde genérico», y agregó
`unclassified` justamente para no mentir cuando el sistema no sabe. Eso sigue
siendo correcto. Lo que el ensayo mostró es que **dos causas que el sistema sí
sabe nombrar están cayendo ahí**:

| Pasada | Observación registrada | Clase que salió |
|---|---|---|
| 1 (`1bb2b66b`) | `Could not materialize artifact ...: artifact_empty.` | `unclassified` |
| 2 (`209c3e59`) | `update_ref failed ... unable to create directory` | `unclassified` |

Dos observaciones independientes son un patrón, no una anécdota. Y la etapa 7
sólo acepta un resultado adverso **atribuible con causa observable**: un fracaso
que sale como `unclassified` no lo es.

## Diseño

Dos clases nuevas, ni una más. Cada una derivada de una observación registrada,
no de imaginar qué más podría fallar.

### `upstream_artifact_unusable`

El consumidor no pudo materializar el artefacto de su productor. La causa **no
está en el consumidor**, y ésa es la decisión de diseño que importa: hoy la
recuperación reintentaría al consumidor, que volverá a encontrar el mismo
artefacto vacío. La recuperación correcta apunta al productor.

- Recuperación: `raise_local_decision` nombrando al **productor**, no al
  consumidor. Sin retry automático del consumidor: repetirlo es garantía de
  repetir el fallo.
- Nota: la causa raíz de la pasada 1 —un intento vacío adoptado como verificado—
  ya está cerrada. Esta clase no existe para taparla, sino para que la próxima
  vez que un artefacto llegue inutilizable por otra vía, el journal diga cuál es
  el nodo culpable.

### `environment_workspace`

El filesystem o git rechazaron una operación del workspace por una condición del
entorno, no del código ni del plan. La observada fue longitud de ruta; la clase
cubre la familia.

- Recuperación: `raise_local_decision` con el mensaje del sistema operativo
  intacto. **Sin retry**: reintentar una ruta demasiado larga la deja demasiado
  larga.
- El mensaje crudo es la única cosa accionable acá, así que no se resume ni se
  reescribe.

### Lo que se conserva

`unclassified` **se queda**, y su política tampoco cambia. Es correcto tener un
destino honesto para lo que de verdad no se conoce; el defecto era que atraía
cosas conocidas. Un ticket que borrara `unclassified` estaría resolviendo el
problema opuesto.

## Checklist

- [x] Regresión roja construida desde las **observaciones registradas** de los
      runs `1bb2b66b` y `209c3e59`, no desde ejemplos inventados. Falla porque
      hoy devuelven `unclassified`.
- [x] `classifyFailure` distingue las dos causas por su `source`/`code`.
- [x] `recoveryPolicyFor` define ambas, y el test de totalidad de la etapa 5
      —que exige política para toda clase— sigue verde sin tocarlo.
- [x] El presupuesto de retry de las dos es 0, con la razón escrita: reintentar
      no cambia ninguna de las dos condiciones.
- [x] `upstream_artifact_unusable` nombra al nodo productor en la decisión que
      levanta.
- [x] Verificado que `unclassified` sigue apareciendo para una observación
      genuinamente desconocida — si desaparece, se rompió lo que la etapa 5
      construyó.

## Cierre verificado

Las regresiones se construyeron a partir de `artifact_empty` y del rechazo de
`git update-ref` observado en los ensayos. La clasificación, las políticas de
recuperación y la preservación de `unclassified` están cubiertas por
`tests/execution-failure-cause-classification.test.ts`,
`tests/failure-recovery-policy.test.ts` y la suite completa. Ambas causas
nombrables quedan con presupuesto de retry cero y decisión local observable.
