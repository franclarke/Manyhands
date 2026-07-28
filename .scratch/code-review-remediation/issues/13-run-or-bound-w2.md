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

## Closure record

- Fixed point: `eeb2f89b0657c160720e7212bc517075cab3ccaf`.
- Scope decision commit: `0cb3fc33f08c6d91b17f1f64a37236ce201b918f`.
- Review remediation commit: `f8e615eb9b822d5c98f4a58de96f8e08261dd3ab`.
- Evidence preserved:
  - `series-15/runs/W2/run.events.v2.jsonl` registra el candidato interno
    `38b511817b0ab0a8df1855d28f0e9455f5dac0fd`;
  - `series-15/runs/W2/oracle-result.json` registra el rechazo externo, pero su
    campo `error` quedó vacío; la reproducción diagnóstica posterior en
    `defects/w2-frozen-lockfile/README.md` preserva
    `ERR_PNPM_OUTDATED_LOCKFILE`;
  - `series-16/runs/W2/run.events.v2.jsonl` registra el hard timeout del intento
    y la decisión `resolve_conflict`; `result.json` registra el estado terminal
    observado por el driver (`waiting_for_input`, sin candidato ni receipt) del
    run `86f88e35-b3c3-455e-8973-2f92e073e387`.
- Files changed: este ticket, `docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md` y
  `docs/tesis/HANDOFF.md`; no se reescribió ningún journal, resultado u oráculo.
- Verification:
  - los tres defect reports existen y conservan “Qué no se concluye”;
  - el handoff distingue publicación interna de verificación externa;
  - `git diff --check` PASS para el recorte documental.
- Independent review at the scope decision:
  - Spec: PARTIAL porque el handoff decía inicialmente que W2 nunca entregó,
    sin distinguir el candidato publicado internamente; la redacción fue
    corregida sin cambiar el veredicto externo.
  - Standards: FAIL por trazabilidad transversal incompleta; sus hallazgos se
    corrigen antes del cierre final de revisión.
- Next unlocked frontier: tickets 02 y 10; se prioriza 10 porque produce la
  evidencia discriminante y 02 sólo bloquea la síntesis histórica de ticket 14.
