# 25 — Completar recovery, trazas, grounding y frontera de seguridad

**What to build:** snapshots/recovery/compaction y trazas durables están en la ruta productiva; grounding y scope rechazan imports pobres, secretos y escapes de symlink.

**Blocked by:** 24.

**Status:** ready-for-agent

- [ ] Host carga/reconstruye desde snapshot+journal y compacta con lock renovable.
- [ ] Trazas JSONL sobreviven restart con checksum y redacción.
- [ ] Grounding grande degrada explícitamente y no inventa cobertura.
- [ ] Forbidden paths, secretos y symlinks tienen regresiones productivas.
- [ ] CLAIM-053 se reevalúa conservadoramente con evidencia de los tickets 21, 23, 24 y 25.
- [ ] Gates y reviews Standards/Spec pasan.
