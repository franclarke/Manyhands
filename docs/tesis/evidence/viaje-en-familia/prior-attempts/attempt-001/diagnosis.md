# Viaje en Familia — intento A001

- Run: `run:8d97907c95c63b8304a0185c30c40c7499db8ba7cd5a14ae32d02978ae135740`
- Workspace: `Viaje Familia A001` (`0c24c2c7-3202-43b5-8bfd-4067c734e867`)
- Commit inicial del target: `3ad7f3f8147865d4af16823ea69866def75662f7`
- Planificador: `claude-code-cli/sonnet`
- Ejecutor y reparación: `codex-cli/gpt-5.4-mini`, esfuerzo `medium`
- Resultado: intento fallido, cancelado por el operador y detenido antes de ejecución.

## Evidencia observada

Durante la creación apareció `Cannot fold a run without run.created.`. El journal
canónico conserva `run.created`, la aceptación del comando, el `model_call`, la
cancelación y el cleanup exitoso. Tras la cancelación, el proceso Claude de
planificación permaneció vivo hasta detener el daemon; se verificó después que
ambos procesos estaban muertos y que el puerto 3000 estaba libre.

## Causas raíz

1. El primer lote del journal se escribía con un stream visible antes de quedar
   completo. Un lector concurrente podía observar un archivo vacío o parcial y
   plegar una historia sin `run.created`.
2. El adaptador de planificación sólo consultaba invalidación antes de iniciar
   Claude. La cancelación duradera no se propagaba al `AbortSignal` del motor ni
   al árbol del proceso CLI ya activo.

## Corrección

Commit ManyHands `c2e5bb8f7b1075e9a5074799983d4771644623eb`:

- publicación atómica del lote de identidad del journal;
- monitoreo acotado de invalidación duradera durante planificación;
- propagación de `AbortSignal` hasta el CLI;
- terminación del árbol del proceso y descarte de resultados invalidados;
- regresiones para publicación inicial, adaptador activo y proceso CLI real.

## Verificación

- Regresiones focalizadas: 19/19 aprobadas.
- `pnpm typecheck`: aprobado.
- ESLint de archivos afectados: aprobado.
- Builds `@manyhands/run-store` y `@manyhands/daemon`: aprobados.
- Suite completa: 2.074 aprobadas, 10 omitidas y una falla documental preexistente
  en `tests/documentation-current.test.ts`; el mismo texto conflictivo ya estaba
  presente en el commit base `d12a3bc7`.

Los archivos `runs/`, `traces/`, `effects/` y `cache/` de este directorio son la
copia compacta del estado original del intento antes de eliminarlo.
