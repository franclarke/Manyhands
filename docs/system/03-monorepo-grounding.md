# SUBSISTEMA 03 — INDEXACIÓN NATIVA Y GROUNDING DE MONOREPOS

> **Paquete**: `packages/repository-index`

---

## 1. RIPGREP INDEXER (`fast-indexer.ts`)

- Invocación del binario nativo `rg` (`rg --files --hidden --glob !.git`) para descubrimiento instantáneo de archivos respetando `.gitignore`.
- Filtrado nativo de alta velocidad compatible con Windows, Linux y macOS.

---

## 2. CACHÉ INCREMENTAL POR GIT HEAD SHA

- Guarda la captura del repositorio en `.manyhands/cache/index-<git-head-sha>.json`.
- Si el commit `HEAD` no cambió, la construcción del snapshot es **inmediata ($O(1)$)**.
