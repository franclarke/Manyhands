# 03 — El ref por intento deja de repetir el `runId`

**What to build:** el ref de candidato por intento deja de gastar 72 caracteres
en escribir dos veces el mismo identificador.

**Blocked by:** None — can start immediately.

**Status:** open

## La observación

La pasada 2 del ensayo (`209c3e59`) murió así:

```
update_ref failed for ref 'refs/manyhands/runs/<runId>/attempts/<runId>_attempt_node-domai-<hash>/candidate':
cannot lock ref: unable to create directory
```

La aritmética: ruta del repo 138 + ruta del ref 136 = **274**, contra
`MAX_PATH = 260` en Windows. De esos 136, **72 son el `runId` escrito dos
veces** — una vez en el segmento `runs/` y otra dentro del nombre del intento.

Con el esquema actual, un target sólo puede vivir en una ruta de ~124
caracteres. La regla de operación ya está en `CLAUDE.md`, pero es una curita: la
restricción no debería existir.

## Diseño

El segmento `runs/<runId>/` ya establece el namespace. El identificador de
intento no necesita repetirlo para ser único **dentro** de ese namespace: le
alcanza con el nodo y su discriminante.

```
refs/manyhands/runs/<runId>/attempts/<nodo>-<hash>/candidate
```

Eso libera ~36 caracteres sin tocar la unicidad, que sigue garantizada por el
prefijo.

### Lo que hay que mirar antes de tocar

- **De dónde sale el nombre.** Si el segmento se deriva del `attemptId`
  —que por diseño contiene el `runId`— el arreglo no es en el naming del ref sino
  en cómo se proyecta el `attemptId` a un segmento de ref. Confirmar cuál de las
  dos cosas es antes de escribir el fix; cambiar la equivocada cuesta un run.
- **Refs vivos.** Un run en curso con refs del esquema viejo no debe quedar
  huérfano. Como son por-run y efímeros, lo más probable es que alcance con no
  romper la lectura; confirmarlo, no suponerlo.
- **Colisión.** El discriminante actual ya distingue intentos del mismo nodo.
  Verificar que lo siga haciendo con el prefijo más corto, con un test que cree
  dos intentos del mismo nodo.

## Checklist

- [ ] Regresión roja que falle **por longitud**, con un target en una ruta que
      hoy rompe y que con el ref corto entra. No un test de formato de string:
      el defecto es el largo, y un test de formato pasaría sin arreglar nada.
- [ ] Identificado si el arreglo va en el naming del ref o en la proyección del
      `attemptId`, con la evidencia de cuál es.
- [ ] Dos intentos del mismo nodo siguen produciendo refs distintos.
- [ ] Verificado contra el caso observado: un target en una ruta de ~138
      caracteres completa un intento.
- [ ] La regla de `CLAUDE.md` se actualiza con el margen nuevo, o se retira si
      deja de hacer falta.
