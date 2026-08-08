# Oráculo externo de SP2

`evaluator.mjs` verifica los cinco criterios de
[`../sp2-protocol.md`](../sp2-protocol.md) sobre el commit candidato exacto de
una celda.

**Vive fuera de [`../sp2-target-template/`](../sp2-target-template/) a
propósito.** Mientras estuvo dentro del target quedó indexado como evidencia del
planner —el run planificaba con el test de aceptación a la vista— y quedó en el
scope de escritura de la raíz, de modo que el run podía editar el evaluador que
lo juzga. Ninguna de las dos cosas se ve en el resultado: un `PASS` obtenido
así es indistinguible de uno real. Ver
[`../sp2-preregistration.md`](../sp2-preregistration.md) §4.1.2.

## Cómo se evalúa una celda

```bash
git -C <celda> worktree add <árbol-descartable> <commit-candidato-exacto>
cp docs/tesis/evidence/semantic-planning/sp2-oracle/evaluator.mjs <árbol-descartable>/
cd <árbol-descartable> && npm test && node evaluator.mjs
```

El evaluador importa `./src/domain`, `./src/application` y `./src/api`, así que
tiene que correr desde la raíz del árbol candidato.

Nunca se modifica durante la serie. Si hace falta corregirlo, se corrige antes
del congelamiento y se registra en la pre-registración.
