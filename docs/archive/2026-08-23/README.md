# Archivo local consolidado — 2026-08-23

Este directorio documenta la consolidación realizada antes de retirar del disco
local los checkouts, worktrees, dependencias, caches y estados de ejecución que
ya no son necesarios para continuar la tesis. El destino remoto es el
repositorio **público** de ManyHands en GitHub; por eso el conjunto publicado se
limitó deliberadamente a material útil y apto para exposición pública.

## Alcance conservado

- La documentación del producto, la arquitectura y los planes canónicos.
- La tesis en LaTeX, su PDF compilado, la presentación oral en PPTX, el código
  fuente de la presentación y los assets necesarios para reconstruirla.
- La evidencia seleccionada del experimento Viaje en Familia: candidato final,
  estado durable, trazas, capturas, intentos previos útiles y material Git de
  recuperación. Véase
  [`../../tesis/evidence/viaje-en-familia/`](../../tesis/evidence/viaje-en-familia/).
- El corpus, baseline y harness de granularidad. Véase
  [`../../tesis/evidence/granularity/`](../../tesis/evidence/granularity/).
- Registros históricos de trabajo que ayudan a reconstruir decisiones, sin
  elevarlos a documentación normativa. Véase
  [`historical-working-records/`](historical-working-records/).
- Una selección explícita de estado runtime local útil para análisis forense.
  Véase [`curated-local-runtime-state/`](curated-local-runtime-state/).
- Referencias Git de recuperación identificadas durante el inventario. Véase
  [`GIT_REFS.md`](GIT_REFS.md).
- Nueve repositorios target históricos externos, preservados como bundles Git
  completos. Véase [`legacy-targets/`](legacy-targets/).
- El inventario, la frontera curatorial y la condición de borrado del retiro
  local. Véase [`LOCAL_CLEANUP_LEDGER.md`](LOCAL_CLEANUP_LEDGER.md).

## Exclusiones deliberadas

No se publicaron artefactos regenerables o innecesarios como `node_modules/`,
`dist/`, caches, outputs temporales ni copias completas de worktrees. El código
útil de esos worktrees queda preservado mediante integración o refs Git.

Tampoco se publicaron hogares de Codex, archivos de autenticación, credenciales
ni material con capacidad de acceso. En particular, quedaron fuera
`credential-broker/`, `installation/ipc-capability`, `request.bin` y cualquier
Codex home o auth state. Se omitieron además cuatro bundles históricos de
Stage 3 y el preflight externo de Stage 8: eran redundantes respecto de código,
scripts y auditorías ya preservados, y no agregaban una fuente canónica.

Estas exclusiones son parte del límite de seguridad y atribuibilidad del
archivo; su ausencia no debe interpretarse como pérdida de evidencia
productiva.

## Autoridad y lectura

El archivo es una captura de recuperación, no una nueva especificación. La
autoridad sigue siendo `PRODUCT.md`, el plan canónico de rediseño y la evidencia
posterior y atribuible. Los registros históricos pueden conservar rutas, links,
estados o terminología del momento en que fueron escritos.

[`SOURCE_SNAPSHOT.md`](SOURCE_SNAPSHOT.md) fija el commit, tree y tag del código
integrado que permiten consultar las rutas retiradas del checkout documental.
El tag canónico del archivo documental es
`thesis-documentation-archive-2026-08-23-v5`; el sufijo conserva los tags
publicados durante la calificación y distingue la revisión que fija los bytes
frente a la conversión de finales de línea de Windows, además de incluir los
logs allowlisted que una regla `*.log` había omitido del índice Git y los
repositorios target históricos descubiertos en el inventario final. La revisión
`v5` agrega las salvaguardas de PowerShell aprendidas durante la publicación,
sin modificar el contenido de evidencia de `v4`.
