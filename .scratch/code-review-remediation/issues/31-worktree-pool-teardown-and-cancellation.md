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
