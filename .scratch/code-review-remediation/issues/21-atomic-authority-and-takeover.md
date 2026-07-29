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
- La primera review encontró P2 en la fecha del receipt y P1 en delivery:
  ambos produjeron 3 RED focales. El receipt/heartbeat ahora se fecha después
  de `allDead`; execution y delivery registran controllers por `operationId`,
  cleanup viejo no borra al sucesor y todo spawn supervisado consulta la señal
  antes de crear el proceso.
- GREEN focal de remediación: 2 archivos/6 tests PASS. Gate ampliado:
  8 archivos/35 tests PASS; typechecks de `@manyhands/run-store` y web PASS.
- Suite raíz final PASS: 215 archivos, 1490 tests passed y 2 skipped. Build de
  los 12 packages y web build PASS con Node `v22.23.1` y pnpm `7.29.3`.
- La re-review Standards detectó P2 por reutilizar la clave global legacy tras
  cambiar la forma del registry. RED reprodujo el TypeError bajo HMR; GREEN
  versiona `run-abort-registry:v2`: 3 archivos/7 tests y web typecheck PASS.
- La re-review Spec detectó P1 cross-host: `allDead` era sólo una foto de
  children y el controller no cruza procesos. RED demostró que el claim podía
  asentarse sin esperar una barrera repository. GREEN exige para
  execution/delivery cruzar la repository lease durable antes de publicar,
  persiste `repositoryQuiescent=true` y revalida el fence tras toda adquisición
  tardía. La prueba real mantiene una lease Git desde un “host viejo” y prueba
  que el takeover espera; la cancelación productiva vuelve a PASS.
- Gate final después de la barrera: 9 archivos/38 tests y ambos typechecks
  PASS. La primera suite raíz expuso tres fixtures con target ficticio; tras
  reemplazarlos por un repositorio Git real, la misma suite quedó en 216
  archivos, 1493 passed, 2 skipped y 0 failed. Build de los 12 packages y web
  build PASS.
- CLAIM-053 continúa `partial`: este ticket cierra autoridad/takeover, pero no
  anticipa recovery/scheduling, journal de integración ni stores/traces de
  tickets 23–25.
