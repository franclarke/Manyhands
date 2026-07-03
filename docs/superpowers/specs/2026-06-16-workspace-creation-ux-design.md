# Diseño — UX de creación de workspace: picker nativo + auto-init de repo + form mínimo

- **Fecha:** 2026-06-16
- **Estado:** Aprobado (diseño)
- **Alcance:** `apps/web` (creación/edición de workspace y filesystem local)

---

## 1. Problema

Crear un workspace hoy tiene tres fricciones:

1. **Selección de carpeta:** "Elegir carpeta" abre un modal custom que navega el
   filesystem dentro de la app. Se ve pobre y es ajeno a cómo el usuario elige
   carpetas en su sistema operativo.
2. **Init manual del repo:** el folder picker solo permite elegir carpetas que ya
   son repos git, y la ejecución hace `git worktree add` sobre `HEAD`, así que el
   repo necesita además un commit inicial. Esto obliga a bajar a la terminal a
   hacer `mkdir` + `git init` + commit antes de poder usar la app.
3. **Opciones avanzadas:** el form expone descripción, color, package manager,
   branch por defecto, rutas permitidas y comandos de test/build. Son tediosas de
   completar y **todas son opcionales y autodetectables**, así que solo agregan
   ruido.

## 2. Objetivos

- "Elegir carpeta" abre el **diálogo nativo del sistema operativo** y devuelve una
  ruta absoluta.
- Al crear el workspace, el repo queda **listo para ejecutar** automáticamente: si
  no es repo git se inicializa; si lo es pero no tiene commits, se le crea uno; si
  ya tiene commits, no se toca.
- El form de workspace se reduce a lo esencial: **Nombre + Carpeta del repo**.

## 3. No objetivos

- No se cambia el flujo de runs, planning ni ejecución.
- No se agrega soporte para repos remotos (clonar URLs).
- No se persisten overrides manuales de package manager / comandos: se confía en
  la autodetección existente.

## 4. Asunción clave (confirmada)

ManyHands corre como **herramienta local**: el proceso server (Node) y el usuario
están en la misma máquina. Por eso el diálogo nativo se abre **server-side** y su
ventana aparece en el escritorio del usuario. Un browser no puede abrir un diálogo
nativo que devuelva una ruta absoluta del filesystem (File System Access API e
`<input webkitdirectory>` están aislados por seguridad). Si en el futuro la app se
deployara remota, este picker dejaría de aplicar y habría que volver a un browser
server-side; está fuera de alcance ahora.

## 5. Decisiones de diseño

| Decisión | Elección |
|---|---|
| Mecanismo del picker | Diálogo nativo del SO, invocado server-side |
| Alcance del init | Carpeta nueva **e** init in-place sobre carpeta existente |
| Contenido del commit inicial | `README.md` + `.gitignore` (solo si faltan) |
| Branch por defecto | Forzar `main` (`git init -b main`) |
| Momento del init | Al crear/editar el workspace (no un botón aparte) |
| Opciones avanzadas | Se eliminan por completo |

## 6. Diseño

### 6.1 Picker nativo de carpeta

- **Endpoint:** `POST /api/local-fs/pick-folder` (sin body). Respuesta:
  - `200 { path: string }` con la ruta absoluta elegida.
  - `204` (o `{ path: null }`) si el usuario canceló el diálogo.
  - `4xx/5xx { error: string }` si no hay diálogo disponible o falla.
- **Implementación:** `pickFolderNative(): Promise<string | null>` en
  `apps/web/src/lib/server/local-fs.ts`, ramificada por `process.platform`:
  - **win32:** PowerShell con `System.Windows.Forms.FolderBrowserDialog`,
    corriendo en un thread STA, con la ventana `TopMost` para que no quede detrás
    del browser. Devuelve la ruta seleccionada o vacío si se canceló.
  - **darwin:** `osascript -e 'choose folder'` → POSIX path.
  - **linux:** `zenity --file-selection --directory`.
  - Si no hay herramienta de diálogo disponible → error claro y accionable.
- **UI:** el botón "Elegir carpeta" en `WorkspaceFormDialog` llama a este endpoint.
  Al recibir la ruta, rellena `repoPath`; si el campo Nombre está vacío, lo
  prefilla con el basename de la carpeta elegida.
- **Eliminación:** se borran `FolderPickerModal` y `LocalFolderBrowser` del
  componente. Si el endpoint `GET /api/local-fs/browse` y `browseLocalDirectories`
  quedan sin consumidores, se eliminan también.

### 6.2 Auto-init del repo (ensure-runnable)

- **Función:** `ensureRunnableRepo(inputPath): Promise<LocalGitRepoInfo>` en
  `apps/web/src/lib/server/workspaces/` (módulo nuevo `ensure-runnable-repo.ts`,
  reutilizando helpers de `repo-validation.ts`).
- **Lógica:**
  1. ¿`inputPath` está dentro de un repo git? (`git rev-parse --show-toplevel`).
     - **No:** `git init -b main` en `inputPath` (fallback
       `git symbolic-ref HEAD refs/heads/main` si la versión de git no soporta
       `-b`). Marcar `needsInitialCommit = true`. `repoRoot = inputPath`.
     - **Sí:** `repoRoot = toplevel`. Verificar `HEAD`
       (`git rev-parse --verify --quiet HEAD`). Si existe → repo ya runnable,
       **no-op**, devolver `inspectLocalGitRepo(repoRoot)`. Si no existe (HEAD
       unborn) → `needsInitialCommit = true`.
  2. Si `needsInitialCommit`:
     - Crear `README.md` (título = nombre del directorio) y `.gitignore`
       (defaults de Node: `node_modules`, `dist`, `.env*`, etc.) **solo si no
       existen** — así un init in-place no pisa archivos del usuario.
     - `git add -A` → `git commit -m "chore: initial commit"`.
     - Identidad: si `git config user.email` está vacío, pasar fallback
       solo-para-este-commit con `-c user.name="ManyHands"
       -c user.email="manyhands@local"`; si hay identidad global, respetarla.
  3. Devolver `inspectLocalGitRepo(repoRoot)` (toplevel + branch + head + dirty).
- **Integración:** en `apps/web/src/app/api/workspaces/route.ts`, la normalización
  del payload llama a `ensureRunnableRepo` (en vez de `normalizeRepoPath`) cuando
  hay `repoPath`, guarda el `repoRoot` resuelto y setea `defaultBranch` desde la
  branch detectada si no vino. Igual en `PATCH` (`[id]/route.ts`) cuando el
  `repoPath` cambia.

### 6.3 Form mínimo

- `WorkspaceFormDialog` queda con dos campos: **Nombre** (input) y **Carpeta del
  repo** (readonly + botón "Elegir carpeta" → picker nativo).
- Se elimina el bloque "Opciones avanzadas" y todo su estado: descripción, color,
  package manager, branch por defecto, rutas permitidas, comando de test, comando
  de build.
- `WorkspaceFormValue` se reduce a `{ name, repoPath }`.
- El handler de submit en `command-center-shell.client.tsx` deja de armar
  `collectOptionalFields`; envía solo `{ name, repoPath }`.

## 7. Manejo de errores

- **Picker:** cancelar el diálogo no es error (no rellena nada). Sin herramienta
  de diálogo o fallo del proceso → callout de error en el form.
- **ensure-runnable:** fallo de `git init`/`commit` (p. ej. permisos, path
  inexistente) → `WorkspaceValidationError` con stderr de git → `400 { error }`,
  el form muestra el mensaje sin cerrarse.
- Path inexistente o no-directorio → error de validación claro (se mantiene la
  verificación de `stat` previa).

## 8. Testing

- `tests/` (Vitest, con tempdirs) para `ensureRunnableRepo`:
  - Carpeta vacía no-git → crea repo, branch `main`, un commit, `README.md` +
    `.gitignore` presentes.
  - Repo git sin commits → crea commit inicial.
  - Repo git con commits → no-op (no agrega commits, no pisa archivos).
  - Init in-place sobre carpeta con archivos existentes → los trackea, **no**
    sobreescribe un `README.md`/`.gitignore` ya presentes.
  - Nombre de carpeta usado para el título del README.
- El picker nativo (`pickFolderNative`) **no** se testea en CI porque depende de
  GUI; se aísla detrás de la función para no acoplarlo al resto. Verificación
  manual en Windows.

## 9. Archivos afectados

- `apps/web/src/lib/server/local-fs.ts` — `pickFolderNative`; posible baja de
  `browseLocalDirectories` si queda sin uso.
- `apps/web/src/app/api/local-fs/pick-folder/route.ts` — **nuevo**.
- `apps/web/src/app/api/local-fs/browse/route.ts` — baja si queda sin uso.
- `apps/web/src/lib/server/workspaces/ensure-runnable-repo.ts` — **nuevo**.
- `apps/web/src/lib/server/workspaces/repo-validation.ts` — helpers reutilizados.
- `apps/web/src/app/api/workspaces/route.ts` y `[id]/route.ts` — usar
  `ensureRunnableRepo` en la normalización.
- `apps/web/src/app/(command-center)/_components/workspace-form-dialog.client.tsx`
  — simplificación fuerte (picker nativo, sin avanzadas).
- `apps/web/src/app/(command-center)/_components/command-center-shell.client.tsx`
  — `WorkspaceFormValue` y submit reducidos.
- `tests/` — tests de `ensureRunnableRepo`.

## 10. Verificación

```bash
pnpm test
pnpm web:typecheck
```

Verificación manual en Windows: crear un workspace eligiendo (a) una carpeta vacía
nueva y (b) una carpeta existente no-git, confirmando que el repo queda con commit
y branch `main`, y que un run puede arrancar sin pasos de terminal.
