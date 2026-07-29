# 21 — Unificar autoridad, fencing y takeover

**What to build:** claim y fence canónico no dejan una ventana de doble autoridad; todo takeover reconcilia y verifica procesos anteriores antes de despachar.

**Blocked by:** 20.

**Status:** agent-working

- [x] RED reproduce crash entre claim y advanceFence y rechaza writes del dueño anterior.
- [x] RED reproduce takeover con child vivo y exige receipt `allDead` antes del nuevo dispatch.
- [x] La pérdida de repository lease aborta efectos en vuelo.
- [x] CLAIM-053 permanece `partial` hasta cerrar también recovery, journal y stores productivos.
- [ ] Tests de concurrencia, gates afectados y reviews Standards/Spec pasan.

## Evidencia de trabajo

- RED: 3 fallos focales. No existía un módulo que unificara claim/fence y
  `withRepositoryLease` no entregaba una señal de aborto al efecto protegido.
- GREEN: `RunOperationAuthority` mantiene el mutex durable del `RunRecord`,
  pide al event store acuñar el siguiente fence canónico y sólo entonces
  publica la lease. Un crash simulado después del fence conserva el record
  anterior, rechaza su append tardío y permite que el siguiente claim salte el
  fence huérfano.
- Un takeover con child real vivo aborta, mata y verifica el árbol antes de
  devolver la lease; `lastTakeoverReceipt` enlaza dueño anterior, nueva
  autoridad, receipt, conteo y `allDead=true`. Un control con `allDead=false`
  no publica ni devuelve la nueva lease.
- El registro de runners quedó identificado por `operationId`; un cleanup
  tardío del dueño anterior no borra al sucesor verificado.
- `withRepositoryLease` entrega un `AbortSignal`, lo propaga a ejecución y
  delivery supervisadas y normaliza la causa a `RepoLeaseLostError`.
- GREEN focal: 5 archivos/24 tests PASS. Gate afectado final:
  15 archivos/50 tests PASS, incluida contención de 12 stores independientes.
  Typechecks de `@manyhands/run-store` y web PASS.
- Suite raíz PASS: 214 archivos, 1487 tests passed y 2 skipped. Build fresco de
  `@manyhands/run-store`, build de los 12 packages y web build PASS con Node
  `v22.23.1` y pnpm `7.29.3`.
- CLAIM-053 continúa `partial`: este ticket cierra autoridad/takeover, pero no
  anticipa recovery/scheduling, journal de integración ni stores/traces de
  tickets 23–25.
