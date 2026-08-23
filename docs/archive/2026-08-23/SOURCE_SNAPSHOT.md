# Snapshot inmutable de código — 2026-08-23

Este archivo fija la fuente contra la que deben resolverse las referencias a
código después de convertir el checkout local en uno exclusivamente documental.

## Identidad canónica

| Campo | Valor |
|---|---|
| Repositorio público | `https://github.com/franclarke/Manyhands.git` |
| Commit de código integrado | `86bee0bb37e780402750169da525d59da5337019` |
| Tree Git | `01a9c8a2641d4cba9a27f9d916ee9902d42eff55` |
| Tag | `thesis-source-snapshot-2026-08-23` |
| Commit del archivo documental inicial | `e9a2c04c72d0ed60d263cc329a33ffe46098ad43` |
| Commit final de la rama experimental | `a3c378b4bf051597d60ce9c99cb9c3f5a0a063eb` |

El commit integrado tiene como padres el archivo documental inicial y el
checkpoint final de la rama experimental. Por lo tanto, ambos historiales son
ancestros de este snapshot.

## Regla para citas de código

Toda ruta citada bajo `apps/`, `packages/`, `native/`, `scripts/` o `tests/`
debe interpretarse contra el tag `thesis-source-snapshot-2026-08-23`, no contra
la selección materializada por un sparse checkout local. Por ejemplo:

```text
https://github.com/franclarke/Manyhands/blob/thesis-source-snapshot-2026-08-23/packages/run-engine/src/durable-run-engine.ts
```

## Experimento Viaje en Familia

| Campo | Valor |
|---|---|
| Run | `run:1572bf91950318003847e64a15e39bac091472e5c115c06fcb9f961487eb3ae0` |
| Candidate commit | `62a0d3571f9a03e670eaca7560f11915a6d4c9d7` |
| Candidate tree | `58dd2f7648eb2c0fef7d6950cb71dce741d49022` |
| Evidence Matrix | `matrix-da779f2d70dfd21c` |
| Rama de archivo | `archive/viaje-familia-final` |
| Bundle SHA-256 | `cd92afd8fdddf66c69b9bafd92052d3974ab2d51e8c882500f90d5ddf8bc4998` |

La rama y el bundle exponen la misma identidad Git del candidato. Su estado
interno `verified`/`delivered` y los `32/32` tests del clean clone son evidencia
técnica reproducida; no elevan el experimento congelado a `PASS` completo. El
límite atribuible está documentado en
[`../../tesis/evidence/viaje-en-familia/README.md`](../../tesis/evidence/viaje-en-familia/README.md).

## Recuperación

```bash
git clone https://github.com/franclarke/Manyhands.git
git -C Manyhands checkout thesis-source-snapshot-2026-08-23
git -C Manyhands rev-parse HEAD
git -C Manyhands rev-parse HEAD^{tree}
```

Los refs locales recuperados de reflogs y objetos no alcanzables están
enumerados con sus SHA completos en [`GIT_REFS.md`](GIT_REFS.md).
