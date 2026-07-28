# 13 — La cadena longitudinal queda acotada honestamente a 1/8

**What to build:** cerrar la línea longitudinal con la evidencia ya producida:
W1 es la única entrega externamente verificada y los intentos W2 preservados no
habilitan avanzar la base. No se ejecuta otro W2.

**Blocked by:** 06.

**Status:** closed

- [x] W1 queda registrada como 1/8, con entrega verificada
  `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- [x] Los intentos W2 existentes conservan journals, resultados, candidatos y
  oráculo cuando existió una entrega.
- [x] La cadena no avanza a W3 y la tesis debe declarar el límite 1/8 sin
  extrapolar.
- [x] Las causas materiales están documentadas con “Qué no se concluye”.

## Closure evidence

- `series-15` produjo el candidato
  `38b511817b0ab0a8df1855d28f0e9455f5dac0fd`, pero el oráculo externo falló por
  `ERR_PNPM_OUTDATED_LOCKFILE`; no se adoptó como base.
- `series-16`, run `86f88e35-b3c3-455e-8973-2f92e073e387`, terminó al hard
  timeout sin candidato, receipt ni oráculo.
- Un intento anterior quedó detenido por el slot huérfano y fue clasificado
  como infraestructura compartida; esa observación tampoco es una entrega W2.
- Fuentes:
  - `docs/tesis/evidence/warehouse/pilot/defects/w2-frozen-lockfile/README.md`
  - `docs/tesis/evidence/warehouse/pilot/defects/w2-execution-timeout/README.md`
  - `docs/tesis/evidence/warehouse/pilot/defects/worktree-pool-orphan-recovery/README.md`
- Cada fuente conserva su sección “Qué no se concluye”. Ninguna atribuye los
  fallos a la política C ni afirma que otra granularidad hubiera entregado W2.

## Scope disposition

Francisco autorizó el 2026-07-28 retirar un nuevo W2 del mínimo científico. La
evidencia discriminante restante se concentra en la sucesora Codex N=4/N=8/N=16,
que ejecuta ManyHands real sobre la base Warehouse W1 y alimenta tanto H2 como
el veredicto de H1. No se borró ni reinterpretó ningún intento longitudinal.
