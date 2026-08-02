# Auditoría de remediación 21 — G6 condición B

## Fallo observado

La celda `g6-03-T1-B-r1` se ejecutó en el run `fa5d45fb-ef62-4b1b-a4bd-8b9958eef788`, sobre la base congelada `5da60192cc788032c59c7e7be27696ca0e0a30d7`. La planificación fue válida y requirió aprobación. En ejecución, el primer leaf de dominio produjo y adoptó un candidato con uso reportado de `52359` tokens y costo de `0.2356155` USD. El leaf de API agotó su timeout de 1800 segundos y quedó fallido; el siguiente intento observado correspondía al leaf independiente de aplicación, no a un reintento automático del leaf de API. El presupuesto de reintentos automáticos de esta celda era cero.

El intento fue detenido mientras el run todavía estaba ejecutando el leaf siguiente. Al intentar cancelar, la operación de control no pudo demostrar que los efectos del repositorio hubieran quedado en quiescencia y respondió `409`. El resultado preservado es `lifecycle: running`, sin receipt y con `abandonedRunCancelled: false`. El intento no produjo candidato final ni entrega. Los artefactos primarios están en:

- `docs/tesis/evidence/g6/runs/g6-03-T1-B-r1-remediation-21-planning/`
- `docs/tesis/evidence/g6/runs/g6-03-T1-B-r1-remediation-21-full/`

La causa estructural no era solamente el timeout del modelo. `RunOperationAuthority.claim()` publicaba la nueva autoridad en el almacén canónico de eventos antes de terminar la reconciliación del proceso y del repositorio. Si la reconciliación del repositorio fallaba, el takeover era rechazado pero el dueño anterior ya había quedado fenceado. El runner anterior recibía entonces `StaleFencingTokenError`, dejaba de renovar su lease y podía quedar un lock de ejecución sin una autoridad válida que lo liberase. Esto coincide con el log del servidor: el cancel falló al quiescer los efectos y luego la operación anterior perdió su fencing token.

## Fix profundo aplicado

Se reordenó `RunOperationAuthority.claim()` para que:

1. verifique la frescura del dueño anterior;
2. reconcilie procesos y exija `allDead`;
3. reconcilie los efectos del repositorio y exija quiescencia;
4. sólo después publique la nueva autoridad en el almacén canónico de eventos.

Cuando cualquiera de las dos reconciliaciones falla, la autoridad anterior permanece intacta. Esto evita que un takeover rechazado convierta un run recuperable en un run fenceado y huérfano.

## Verificación TDD

Se agregó una regresión que reproduce exactamente el fallo de rem21: el takeover obtiene `allDead`, falla al reconciliar el repositorio y debe rechazar la operación sin invalidar la autoridad anterior.

- Estado rojo previo al fix: `8 tests`, `1 failed`; la autoridad anterior fue observada como `StaleFencingTokenError`.
- Fix aplicado en `apps/web/src/lib/server/runs/run-operation-lease.ts`.
- Estado verde posterior: `pnpm test -- tests/run-operation-authority-atomic.test.ts`; `8/8` tests pasaron.
- Build obligatorio posterior al cambio: `pnpm build`; pasó correctamente.

## Qué no se concluye

Este arreglo demuestra atomicidad del takeover frente a una reconciliación de repositorio fallida; no demuestra que la celda G6 condición B haya pasado, que el timeout del leaf de API haya sido resuelto, ni que el sistema haya producido una entrega válida. El run rem21 queda preservado como intento fallido y no se reutiliza. La celda debe reintentarse desde una copia limpia, después de reiniciar el servidor con el build que contiene este fix.
