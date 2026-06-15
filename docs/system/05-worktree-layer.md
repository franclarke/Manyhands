# WorktreeManager y SimpleGitRunner

**Archivos fuente:** `packages/execution-core/src/worktree/manager.ts`, `packages/execution-core/src/git/runner.ts`

---

## Qué es

El `WorktreeManager` crea y gestiona los entornos git aislados donde cada hoja ejecuta. El `SimpleGitRunner` es el wrapper tipado que encapsula todas las operaciones git del orquestador.

---

## Responsabilidad

La responsabilidad de esta capa es garantizar que cada agente opere en completo aislamiento del resto: su propio directorio de trabajo, su propia rama, partiendo exactamente del mismo estado base del repositorio. Sin esta capa, un agente podría ver cambios que otro agente hizo en paralelo, o peor, sobreescribir su trabajo.

---

## Cómo funciona

### SimpleGitRunner

El `SimpleGitRunner` envuelve la biblioteca `simple-git` y expone operaciones git tipadas con manejo centralizado de errores. En vez de llamar `git.add()`, `git.commit()`, `git.cherryPick()` directamente desde distintos componentes, todo el acceso a git pasa por este wrapper.

Las operaciones que expone incluyen: `worktreeAdd`, `worktreeRemove`, `diff`, `diffNameOnly`, `add`, `commit`, `cherryPick`, `getHead`. El tipado fuerte significa que errores de git se propagan como excepciones bien-definidas en vez de strings de error arbitrarios.

### WorktreeManager: ciclo de vida de un worktree

Un git worktree es una característica nativa de git que permite tener múltiples branches del mismo repositorio activos simultáneamente en distintos directorios del sistema de archivos. ManyHands usa esto para dar a cada hoja su propio directorio de trabajo, sin necesidad de clonar el repo repetidamente.

**`create(taskId, runId, baseCommit)`:**
1. Calcula el path del worktree: `.manyhands/worktrees/{runId}/{taskId}` dentro del repo
2. Crea una nueva branch `manyhands/{runId}/{taskId}` a partir del `baseCommit`
3. Registra el worktree con `git worktree add <path> <branch> --no-checkout`, luego hace checkout del `baseCommit`
4. Retorna un `WorktreeRecord` con el path, la branch, el baseCommit, y el status `"active"`

El `baseCommit` es el mismo para todas las hojas del mismo run. Esto garantiza que todos los agentes parten del mismo estado — independientemente de si otras hojas ya completaron y commitearon en sus propias ramas.

**`detectUnexpectedCommit(worktreeRecord)`:**
Compara el HEAD actual del worktree con el `baseCommit` conocido. Si difieren, el agente hizo uno o más commits por su cuenta. Retorna `{ committed: true, sha: string }`.

Esta detección es fundamental para la invariante D6 (el orquestador hace commit): si el agente commitió, el orquestador tiene que decidir qué hacer — por defecto descarta el resultado (`reject`), opcionalmente lo acepta (`accept`) pero igualmente valida scope y tests antes de avanzar.

**`clean(worktreeRecord)`:**
Elimina el directorio del worktree del filesystem y elimina la branch temporal. Después de limpiar, el worktree ya no existe ni en el disco ni en el historial de git del repo principal.

### Por qué worktrees y no branches en el mismo directorio

La alternativa obvia sería hacer `git checkout` de una branch diferente para cada hoja. El problema es que el repositorio tiene un único directorio de trabajo — cambiar de branch cambiaría los archivos que otras tareas están leyendo simultáneamente. Los worktrees de git resuelven esto exactamente: el repositorio puede tener N branches activas en N directorios distintos, en paralelo, sin interferencia.

---

## Interfaces

**El `WorktreeManager` recibe:** el path del repositorio base y un `SimpleGitRunner`.

**`create()` produce:** un `WorktreeRecord` con `{ taskId, runId, path, branch, baseCommit, status: "active" }`.

**`detectUnexpectedCommit()` produce:** `{ committed: boolean, sha?: string }`.

**Lo usan:** `RunExecutor` (para crear y limpiar worktrees al inicio y fin de cada hoja) y `ResultRecorder` (que llama a `detectUnexpectedCommit` antes de decidir si commitear el resultado del orquestador).

---

## Decisiones de diseño

Todos los worktrees viven bajo `.manyhands/worktrees/` dentro del repo, no en un directorio externo. Esto los hace fáciles de limpiar si algo sale mal: basta con borrar el directorio. El `WorktreeManager.clean()` los elimina normalmente al final de cada hoja, pero si el proceso muere inesperadamente los directorios quedan y pueden limpiarse manualmente.

La detección de commits inesperados existe porque `--approval-mode yolo` le da a Gemini acceso a herramientas de filesystem y subprocess — incluyendo git. Gemini podría hacer `git commit` como parte de su trabajo. La detección no depende de confiar en que el agente no lo haga; verifica el estado real del worktree después de cada ejecución.
