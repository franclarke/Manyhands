# 10 — Primera medición del instrumento nuevo

**What to build:** la celda más barata del barrido rediseñado produce el primer
resultado terminal atribuible antes de gastar las celdas grandes. Si ManyHands
entrega, valida también el oráculo; si falla antes de candidate, preserva esa
limitación sin reintentar ni fabricar una entrega.

**Blocked by:** 03, 04, 05, 08 — el run necesita un oráculo atribuible y una serie que declare el executor como variable controlada.

**Status:** ready-for-agent

- [x] La celda corre sobre la base W1 verificada con el executor declarado.
- [x] Si existe candidate SHA, el oráculo externo emite su veredicto; si el run
  falla antes, una disposición atribuible registra que el oráculo no puede
  ejecutarse sin inventar una entrega.
- [x] Journal, resultado y receipt cuando existe quedan preservados con sus
  límites de interpretación.

## Run evidence

- Frozen ManyHands commit:
  `c38a976712f5145002667f0b0f6686136b13b190`.
- Run: `9bd2e8fc-0e7c-4342-b908-d6a25818382f`.
- Base: `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- Selection: `codex-cli/gpt-5.5/high`, condition `C`,
  `adaptive-utility/3.1.0-pilot`.
- Outcome: `failed` during compiled plan review; no candidate, receipt or
  delivered SHA.
- Root cause: duplicate planned outputs between the composite and leaves, plus
  artifact cycles around registry/study output.
- External oracle: `not_run`; its v2 contract requires a delivered SHA.
- No retry: the instrument remained valid and the planning failure is the
  observed product result.
- Evidence:
  `docs/tesis/evidence/warehouse/wide-graph/retry-8/runs/warehouse-wide-n04/`.
- Freeze gate: P0, package/web typechecks, package/web builds, policy marker,
  target baselines, hashes, clean tree and authenticated mutation all PASS.
- TDD prerequisite: generator condition attribution RED with 1 failure/13 pass,
  then the affected five-file gate GREEN with 46/46.
