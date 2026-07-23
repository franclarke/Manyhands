# 06 — PERSISTENCIA, DURABILIDAD Y RECUPERACIÓN ANTE FALLOS

Este documento especifica el motor de almacenamiento de `packages/run-store` y `packages/trace-store`.

---

## 1. MOTOR DE ALMACENAMIENTO DE EVENTOS ($O(1)$ APPEND)

El `JsonlEventStore` serializa eventos de dominio en un log JSONL continuo sin necesidad de reescribir el historial completo:

```text
{"sequence": 1, "eventId": "evt_01", "type": "run.started", "writtenAt": "..."}
{"sequence": 2, "eventId": "evt_02", "type": "attempt.started", "writtenAt": "..."}
```

---

## 2. ESCRITURAS ATÓMICAS Y COMPACTACIÓN POR GENERACIONES

### Reemplazo Atómico con `fsync` (`MH-REM-015`):
1. Escribe en archivo temporal `.tmp` en el mismo directorio.
2. Invoca `fsync` sobre el descriptor del archivo.
3. Realiza `rename` atómico sobre el destino final.
4. Aplica reintentos exponenciales con jitter para mitigar contención en Windows (`EBUSY`, `EPERM`).

### Protocolo de Compactación por Generaciones (`compactor.ts`):
```text
events.generation-001.jsonl
snapshot.generation-001.json
store-manifest.json  <-- Apuntador atómico a la generación activa
```

---

## 3. CERCADO DE LEASES DE LOCK (`MH-REM-014`)

- `acquireDurableLock` emite un token único de propiedad (`ownershipToken`) e incrementa el token de cercado (`fencingToken`).
- Solicitudes atrasadas o liberaciones tardías por runners antiguos son rechazadas al comparar el token de propiedad actual.

---

## 4. RECUPERADOR DE INTEGRIDAD ANTE CRASHES (`recovery.ts`)

Clasifica y repara el estado durable tras un apague de energía o crash:
- **Recuperable Automáticamente**: Trunca líneas parciales al final del archivo, elimina temporales huérfanos y restaura la última generación válida del manifest.
- **Cuarentena**: Mueve archivos corruptos a `.quarantine/` para su inspección sin destruir datos.
