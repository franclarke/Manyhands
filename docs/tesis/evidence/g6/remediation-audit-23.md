# Auditoría de remediación 23 — G6 condición B

## Fallo observado

La planificación de rem23 creó el run `de09759a-4056-4e9c-9fca-3fb7534caf0d` y ejecutó exactamente una tentativa. El sandbox sí arrancó con el binario standalone, pero Codex terminó con código 1 sin producir ningún envelope de planificación (`envelopes=none`, `stdoutBytes=0`). El texto capturado en stderr correspondía a contexto persistido del entorno Codex y no a un `WorkBreakdown` JSON válido. El run quedó en `failed` antes de generar un plan candidato.

La prueba diagnóstica mínima con el mismo binario, modelo y sandbox produjo `OK` con código 0. La comparación con el preflight congelado mostró que el comando de planning V2 no usaba `--ephemeral`, mientras que el preflight sí lo usaba. Por lo tanto, la causa no era disponibilidad del modelo ni el sandbox: era que la invocación productiva permitía reutilizar estado persistido del CLI y contaminar una tentativa experimental con contexto ajeno al estímulo.

## Fix profundo aplicado

Se centralizó la construcción de argumentos de Codex para planning en `buildCodexPlanningArgs()` y se agregó `--ephemeral` junto con el sandbox `read-only` y `--skip-git-repo-check`. Cada tentativa queda así aislada de sesiones persistidas, manteniendo explícitos el modelo, el esfuerzo y la política de sandbox.

## Verificación TDD

- Regresión roja previa al fix: `buildCodexPlanningArgs is not a function`, porque la ruta no exponía ni garantizaba el contrato de argumentos aislados.
- Fix aplicado en `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`.
- Build posterior: `pnpm build`; pasó.
- Suite focal posterior: `pnpm test -- tests/planning-cli-invocation.test.ts`; `1/1` pasó.

## Qué no se concluye

Este arreglo demuestra que el planning V2 construye una invocación efímera, pero no demuestra todavía que Codex produzca un breakdown válido en la celda G6 ni que la ejecución completa pueda llegar a un candidato. Rem23 queda preservado como fallo pre-candidate y no se reutiliza; la siguiente tentativa debe partir de otro target limpio y de un servidor reiniciado con este build.
