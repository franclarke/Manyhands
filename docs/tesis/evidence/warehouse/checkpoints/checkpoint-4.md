# Checkpoint 4 — assets y drivers Warehouse

Estado: **completed**.

## Assets fijados

- seed técnico externo `0f87e457ae154385cbb81bb6e3541a3533b78761`,
  sin archivos de dominio y estable después de install congelado;
- protocolos longitudinal y A/B/C2 escritos antes de W1 Pilot;
- prompts acumulativos W1–W8 con goal, aceptación, constraints y oracle id;
- ocho oráculos externos con scripts y core hasheados;
- manifest de assets con hashes SHA-256 de los ocho prompts.

## Automatización

- `prepare-warehouse-repos.mjs` verifica commit, tree, lockfile, limpieza y lista
  exacta del seed; sólo clona con `--prepare` explícito y nunca borra destinos.
- `run-warehouse-longitudinal.mjs` aborta antes de ejecutar por disco, dirty
  trees, base, seed, assets, `dist`, commit, toolchain o modelo incompatibles.
- La cadena adopta el commit siguiente únicamente después de delivery y oráculo
  externo PASS sobre un clon limpio.
- `run-warehouse-oracle.mjs` verifica hashes, instala con lock congelado y
  conserva también el resultado de fallo.

## Verificación

- TDD rojo: 17 fallos por assets ausentes y suite del driver sin módulo.
- Verde: 26 tests (18 assets + 8 driver).
- `prepare-warehouse-repos.mjs --verify-only`: PASS.
- dry-run productivo: ocho celdas W1–W8 sobre ManyHands `c0d4be8`, sin mutación.
- ruta negativa de oráculo: el seed sin `study:probe` produce outcome `fail` y
  no puede ser adoptado.

## Commits

- `550f81c` — benchmark assets;
- `c0d4be8` — driver longitudinal.

El checkpoint no afirma que Warehouse esté construido. Sólo fija y prueba el
instrumento que deberá producir esa evidencia en Pilot y Final.
