# SUBSISTEMA 02 — ALMACENAMIENTO ATÓMICO, DURABILIDAD Y RECUPERACIÓN

> **Paquetes**: `packages/run-store`, `packages/trace-store`

---

## 1. MOTOR DE EVENTOS ($O(1)$ APPEND) Y COMPACTACIÓN

- **Event Store**: Append de líneas JSONL continuas sin reescritura de historial.
- **Escritura Atómica (`MH-REM-015`)**: Escribe en `.tmp`, invoca `fsync` y ejecuta `rename` atómico. Reintentos exponenciales con jitter en Windows.
- **Compactación (`compactor.ts`)**: Genera `generation-G.snapshot.json` y rota el log de eventos mediante actualización atómica del manifest.

---

## 2. RECUPERACIÓN ANTE FAILLOS (`recovery.ts`) Y SQLITE WAL

- **Recovery Engine**: Trunca bytes incompletos al final del archivo tras apagones, valida firmas de checksum y recupera la última generación válida.
- **Estrategia SQLite WAL**: Base de datos SQLite embebida en modo `journal_mode=WAL` para proyecciones de UI ultrarrápidas y replay de eventos SSE sin lecturas pesadas de disco.
