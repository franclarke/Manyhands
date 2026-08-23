# Archivo de evidencia: Viaje en Familia

Este directorio preserva la evidencia útil del intento final `attempt-012` y
una selección de intentos anteriores del experimento longitudinal Viaje en
Familia. Su propósito es permitir que la tesis y la presentación sigan siendo
auditables sin conservar los entornos de ejecución locales completos.

## Identidad del resultado final

| Campo | Valor |
|---|---|
| Run | `run:1572bf91950318003847e64a15e39bac091472e5c115c06fcb9f961487eb3ae0` |
| Candidate commit | `62a0d3571f9a03e670eaca7560f11915a6d4c9d7` |
| Candidate tree | `58dd2f7648eb2c0fef7d6950cb71dce741d49022` |
| Evidence Matrix | `matrix-da779f2d70dfd21c` |
| Estado interno del run | `verified` y luego `delivered` |

`verified` y `delivered` son estados registrados por ManyHands para ese run;
no deben reinterpretarse como un veredicto experimental independiente.

La calificación en un clean clone confirmó el mismo `HEAD` y el mismo tree,
un worktree limpio, `32/32` tests aprobados y cero errores de `git fsck --full`.
Se ejecutó con Node.js `v24.16.0` y npm `11.13.0`. El registro estructurado está
en [`clean-clone-manifest.json`](clean-clone-manifest.json).

## Límite de atribución

El intento final demuestra un candidato exacto que el sistema marcó como
verificado y entregado, y cuya suite volvió a pasar en un clean clone. El
experimento congelado, sin embargo, **no alcanza un `PASS` completo**:

- la superficie final visible es un dashboard de solo lectura; la mutación del
  dominio está cubierta por tests unitarios y de integración, no por un flujo
  completo de interacción en navegador;
- las capturas finales del producto se obtuvieron post-hoc y no existe un
  manifest contemporáneo que las vincule de forma inequívoca al candidate SHA.

Por eso las capturas sirven para mostrar el producto entregado y su diseño, pero
no sustituyen el oracle de navegador que exigía el protocolo congelado.

## Contenido preservado

- `final-run/state/`: journal canónico, fence, traces, effect inputs/receipts,
  operaciones de integración, resultados transicionales e índice de repositorio
  del run final.
- `candidate-source/`: copia legible del árbol entregado, sin su `.git` local.
- `git/viaje-en-familia-final.bundle`: historia Git autocontenida del candidato,
  incluidos los refs internos de artefactos de ManyHands.
- `intermediate-runs/`: estado y artefactos seleccionados de `attempt-009` y
  `attempt-011`, útiles para estudiar fallos y recuperación anteriores al cierre.
- `prior-attempts/`: diagnósticos, capturas y estado durable seleccionado de los
  intentos `001` a `010`. No todos representan candidatos completos.
- `browser-post-hoc/`: logs y snapshots de accesibilidad obtenidos después del
  run; se preservan explícitamente como evidencia post-hoc.
- [`manifest.json`](manifest.json): tamaño, SHA-256, procedencia y clasificación
  de los 565 archivos archivados. Se regenera con `node build-manifest.mjs` y se
  comprueba con `node verify-manifest.mjs`.

Las capturas visuales seleccionadas para tesis y presentación se encuentran en
[`../../assets/viaje-en-familia/`](../../assets/viaje-en-familia/).

## Allowlist y exclusiones de seguridad

El archivo se construyó por allowlist: se conservaron artefactos de producto,
provenance Git, eventos, trazas, receipts, diagnósticos y capturas necesarios
para reconstruir o auditar el experimento. No se copió indiscriminadamente el
runtime local.

Quedaron excluidos deliberadamente:

- `credential-broker/` y cualquier estado de credenciales del broker;
- `installation/ipc-capability*`, porque una capability de IPC es material de
  autenticación y no evidencia académica;
- `processes/**/request.bin`, ya que los requests opacos de workers pueden
  contener environment o contexto sensible;
- archivos de autenticación, tokens, sesiones, `.env*` y perfiles de navegador;
- homes de Codex y probes como `codex-sandbox-probe-home`, caches de paquetes,
  `node_modules`, toolchains instaladas y directorios temporales;
- el `.git` anidado del target, reemplazado por el bundle verificable.

Estas exclusiones no reducen la identidad del candidato ni el journal canónico;
evitan publicar secretos, credenciales o caches regenerables en un repositorio
público.

## Bundle Git y restauración

El bundle archivado tiene estas propiedades verificadas localmente:

| Propiedad | Valor |
|---|---|
| Archivo | `git/viaje-en-familia-final.bundle` |
| Tamaño | `124932` bytes |
| SHA-256 | `cd92afd8fdddf66c69b9bafd92052d3974ab2d51e8c882500f90d5ddf8bc4998` |
| Refs | `71` |
| Historia | completa, object format `sha1` |
| `HEAD` restaurado | `62a0d3571f9a03e670eaca7560f11915a6d4c9d7` |
| Tree restaurado | `58dd2f7648eb2c0fef7d6950cb71dce741d49022` |

Verificación y restauración mínima desde este directorio:

```bash
git bundle verify git/viaje-en-familia-final.bundle
git clone git/viaje-en-familia-final.bundle restored-candidate
git -C restored-candidate rev-parse HEAD
git -C restored-candidate rev-parse HEAD^{tree}
git -C restored-candidate fsck --full
```

La rama remota `archive/viaje-familia-final` fue publicada y verificada contra
GitHub el 23 de agosto de 2026. Resuelve exactamente al candidate commit
`62a0d3571f9a03e670eaca7560f11915a6d4c9d7`.
