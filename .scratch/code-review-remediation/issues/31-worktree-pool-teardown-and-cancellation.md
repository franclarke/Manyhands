---
title: "Worktree pool: teardown y cancelación ante smoke/executor huérfano"
status: ready-for-agent
labels: [lifecycle, worktree, recovery, successor]
blocked_by: [27]
---

# Worktree pool: teardown y cancelación ante smoke/executor huérfano

## Defecto observado

En la candidate execution WC1, un smoke server quedó vivo y mantuvo abiertos
`start-smoke.out.log` y `start-smoke.err.log`. `git clean -fdx` falló con
`Invalid argument`; el release dejó el slot no disponible y la siguiente
llamada a `WorktreePool.acquire()` esperó indefinidamente porque el proveedor
no propagó `AbortSignal` ni un timeout. La pipeline conservó el lease del repo,
el run quedó `running` y el takeover normal informó `repository quiescent=false`.

## Acceptance

- [ ] RED reproduce cleanup fallido + slot no disponible + acquire cancelable.
- [ ] GREEN propaga cancelación/timeout desde el nodo hasta el acquire y
      libera o recrea el slot sin dejar leases activos inciertos.
- [ ] Smoke servers y descendientes quedan registrados en evidencia durable y
      el teardown los termina/verifica antes de limpiar el worktree.
- [ ] Executor exit, proceso huérfano, restart y cancelación convergen a un
      estado durable; una decisión real continúa siendo `waiting_for_input`.
- [ ] Regresiones focales, typecheck, gates afectados y revisiones Standards y
      Spec pasan.

## Evidencia de entrada

Run `3f5cf275-85c7-49ce-9fef-12744e1846d8`, eventos 34-39, y checkpoint WC1
en `docs/tesis/HANDOFF.md`. No modificar retry-9/10/11 ni usar este run como
resultado positivo; WC1 sucesor requiere freeze y candidate execution nueva.

## Checkpoint de implementacion - 2026-07-30

Los commits locales `8f8dca1`, `dedf0ff` y `6c71214` cubren la propagacion de
cancelacion y timeout desde V2NodeExecutor hasta la adquisicion pooled y
directa, incluyendo inicializacion/topology, repair de leaf, integracion
composite y validacion. Un abort posterior a `worktreeAdd` limpia worktree,
prune y branch; una inicializacion cancelada elimina los slots creados y no
conserva una capacidad parcial como pool valido.

La verificacion focal acumulada esta verde: suites de WorktreeManager,
WorktreePool, V2NodeExecutor y ExecutionBaseBuilder; typecheck de
`@manyhands/execution-core`; suites de proceso/cancelacion existentes; y
`git diff --check`.

La review Standards/Spec posterior todavia no permite cerrar este ticket.
Quedan por cubrir el teardown y la evidencia durable especificos de
smoke/descendientes, un timeout real dentro de operaciones Git y la
convergencia durable de recovery bajo proceso huerfano. No se reutiliza la
candidate execution WC1 ni se inicia N=4/N=8/N=16 mientras estas aceptaciones
sigan abiertas.

## Checkpoint de teardown supervisado - 2026-07-30

El commit `1df4548` agrega cancelacion real a las operaciones Git del pool
durante init/acquire y verifica descendientes de validaciones supervisadas
antes de devolver un resultado. La validacion falla cerrado con exit `125` si
no puede inspeccionar, matar o verificar un descendiente. Regresiones y
typecheck de execution-core pasan.

El ticket sigue abierto: falta la evidencia durable integrada con una candidate
real y el pool, ademas de la convergencia completa de huérfano/restart/heartbeat
y las reviews Standards/Spec finales.
## Checkpoint de decision independiente - 2026-07-30

El commit `4a0be8d` corrige una causa real de lifecycle relacionada: la ruta de
fallo de background ya no descarta un error de ejecucion solo porque exista
una decision pendiente para otro nodo. La nueva regresion comprueba que el run
converge a `failed`, conserva el `failureReason` y deja la decision en
`pending`; los fallos de dominio/planner mantienen la espera normal. Suite
focal 6/6 PASS y typecheck web PASS.

Este checkpoint no cierra 31. Sigue faltando la candidate real con evidencia
durable smoke->pool, la convergencia de huerfano/restart/heartbeat y las
reviews Standards/Spec finales.
## Checkpoint de evidencia durable de descendientes - 2026-07-30

El commit `63ce478` agrega un watchdog de tabla de procesos al journal de
supervision. Mientras un executor esta vivo, los descendientes observados se
registran con PID, comando y label; si el padre termina, la evidencia del
descendiente permanece abierta para el camino de restart/takeover. La
regresion simula el smoke server, comprueba que queda en el journal y verifica
que `killRunProcessesVerified` lo termina con `allDead=true`.

Verificacion: journal 6/6, process supervisor 6/6, takeover atomico 7/7,
leases 4/4, typecheck web y `git diff --check` PASS.

La acceptance de candidate real y la review no se declaran cerradas con esta
prueba aislada: todavia falta ejecutar el escenario productivo una sola vez,
verificar heartbeat/restart/huerfano y completar Standards/Spec.
