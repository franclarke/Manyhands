# Ledger de retiro local — 2026-08-23

Este ledger fija la frontera aplicada antes de sustituir el checkout completo de
ManyHands por un checkout documental. La limpieza se limita al repositorio, sus
worktrees y los entornos de experimento, build, runtime y QA asociados; no
autoriza borrar otros proyectos, perfiles de usuario, caches compartidos ni el
home de Codex.

## Inventario previo

| Superficie | Inventario | Tamaño aproximado | Disposición |
|---|---:|---:|---|
| Rutas `C:/mh*` asociadas | 46 | 7.896 GiB | eliminar tras publicación y clean-clone remoto |
| Worktrees Orca de ManyHands | 2 más contenedor | 1.654 GiB | retirar con `git worktree remove` |
| Repositorios QA y targets externos | 6 roots más worktrees | 47.716 MiB | preservar sus histories en bundles y eliminar |
| Sandbox Git de Stage 8 | 1 root | 0.07 MiB | preservar todos sus refs y objetos recuperables |
| Temporales `manyhands-*` / `mh-*` | 83 directorios | 28.536 MiB | eliminar como fixtures o renders regenerables |
| Clones documentales de calificación | 3 | 299.7 MiB | conservar solo el checkout final en la ruta canónica |

El inventario estimó alrededor de 9.9 GiB recuperables fuera del checkout raíz,
sin contar el checkout completo que se reemplaza.

## Información preservada

- El source tree integrado queda direccionable por el tag
  `thesis-source-snapshot-2026-08-23` aunque no se materialice en el checkout
  local documental.
- La rama histórica `franclarke/Experimento`, la rama del candidato final
  `archive/viaje-familia-final` y las refs de recuperación se publican en
  GitHub.
- El experimento Viaje en Familia conserva su candidato, estado durable,
  evidencia curada, source export, capturas y bundles autocontenidos del intento
  final y de los intentos 005, 009 y 011.
- Nueve repositorios target externos quedan en
  [`legacy-targets/`](legacy-targets/) como bundles Git verificables. Los refs
  `archive/unreachable/*` fijan commits, trees y blobs recuperables que de otro
  modo podían perderse con los reflogs.
- La tesis, su PDF compilado, la presentación, su source y sus assets quedan en
  `docs/tesis/`.

## Exclusiones deliberadas

No se publica el raw local indiscriminadamente porque el remoto es público.
Quedan excluidos credentials, capabilities IPC, auth/session state, requests
binarios de workers y cualquier Codex home. También se eliminan `node_modules`,
stores, runtimes descargados, shims, caches, locks, builds y materializaciones
de worktrees cuando el commit o la evidencia canónica ya están preservados.

Los retries raw de Stage 8 incluyen material de credenciales y no son aptos para
GitHub; se conservaron las auditorías, el estado curado y las histories Git. Los
logs/builds raw de Stage 3 que no coinciden byte a byte con `docs/audits/stage-3`
son estados intermedios: el GO normalizado y los NO-GO resumidos sí están
versionados. Dos clones de conversión de lockfiles contenían únicamente ensayos
mecánicos de versiones, no producto ni documentación, y se excluyen por la
misma frontera curatorial.

## Condición de borrado

Ninguna ruta material se elimina hasta que un clone nuevo desde GitHub:

1. resuelva `origin/main` y el tag documental final al mismo commit;
2. verifique los manifests y SHA-256 publicados;
3. apruebe `git bundle verify` para todos los bundles;
4. apruebe `git fsck --full`, la política sparse y un `git status` limpio.

La eliminación posterior es permanente. La recuperación prevista es GitHub y
los bundles versionados, no la Papelera de reciclaje.
