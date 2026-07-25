# Seed lock checkout normalization

Clasificación: **defecto del driver; cero runs consumidos**.

## Observación

El primer preflight sobre el clon piloto abortó con `seed_hash_mismatch`. HEAD y
tree coincidían exactamente con el seed, pero SHA-256 de los bytes del lockfile
en el worktree no: Git había materializado finales de línea propios del checkout.

## Causa

El driver comparaba bytes del archivo materializado, aunque la identidad
reproducible ya estaba versionada por el tree Git. Dos checkouts del mismo blob
podían diferir físicamente por `core.autocrlf`.

## Corrección TDD

- Rojo: una regresión exigió aceptar tree y blob Git idénticos aunque cambien
  los bytes materializados por finales de línea.
- Verde: seed manifest registra `lockfileGitBlob`; preflight compara tree y blob
  de `HEAD`, mientras el verificador del repositorio seed conserva además el
  SHA-256 físico original.
- Verificación: 27 tests y `prepare-warehouse-repos --verify-only` PASS.

No se relajó la identidad del seed: se sustituyó una propiedad dependiente del
checkout por dos objetos Git exactos. No hubo planificación, agente ni journal.
