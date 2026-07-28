# Missing Git identity in orchestrator-owned commits

## Observado

En `retry-9` N=4, run `3340ab0b-b255-43b5-af33-870e8872b00e`, el primer
agente terminó su trabajo, pero el commit propiedad del orquestador falló con
`Author identity unknown`. El journal conserva el intento y la clasificación
incorrecta `code_test` en las secuencias 30–32.

## Causa raíz

`SimpleGitRunner.commit()` delegaba directamente a Git y asumía que el target
tenía `user.name` y `user.email` efectivos. `ensureRunnableRepo` sólo ofrecía
identidad acotada al commit inicial de repositorios nuevos; un repositorio
existente podía pasar preflight y fallar recién después de gastar una ejecución
de agente.

## Corrección

Commit `60eb12f`. `SimpleGitRunner.commit()` conserva una identidad efectiva
existente. Si falta nombre o email, crea únicamente ese commit con
`-c user.name=ManyHands -c user.email=manyhands@local`. No persiste cambios en
la configuración del repositorio ni en la global.

TDD:

- RED: `pnpm vitest run tests/execution-core-git-runner.test.ts` →
  `1 failed / 3 passed`, con el error exacto de identidad.
- GREEN: el mismo archivo `4/4`; la suite afectada conjunta pasó.

## Qué no se concluye

- No demuestra que la ejecución completa N=4 entregue un candidato.
- No corrige la clasificación `code_test`; sólo elimina la causa de commit.
- No convierte `retry-9` en una serie comparable: el run anterior permanece
  adverso y se requiere un freeze sucesor desde N=4.
