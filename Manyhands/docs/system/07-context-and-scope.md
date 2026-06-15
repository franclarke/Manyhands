# FileSystemContextPacker y ScopeChecker

**Archivos fuente:** `packages/execution-core/src/context/packer.ts`, `packages/execution-core/src/scope/checker.ts`, `packages/execution-core/src/scope/glob.ts`

> **Actualizacion 2026-06-06.** La politica real de scope ya no es "deny wins"
> para todo lo fuera del allow-list. `forbiddenPaths` sigue siendo hard-fail; los
> paths fuera de `executionScope` pero no prohibidos se registran como
> `outOfScope` advisory para visibilidad. Esto mantiene el aislamiento real en el
> worktree + ScopeChecker sin matar runs por allow-lists estimadas por el LLM.

---

## Qué son

El `FileSystemContextPacker` arma la sección del prompt que le da al agente el contenido actual de los archivos que necesita conocer para hacer su trabajo. El `ScopeChecker` verifica, después de que el agente termina, que solo tocó los archivos que su contrato le permitía.

Son dos caras de la misma moneda: el packer define qué puede ver el agente antes de ejecutar; el checker verifica que respetó los límites después de ejecutar.

---

## FileSystemContextPacker

### Responsabilidad

Construir el contexto de archivos del prompt de la forma más útil posible sin exceder los límites de tokens razonables, y sin filtrar información que el agente necesita para entender cómo construir sus interfaces.

### Cómo funciona

`pack(worktreePath, contract)` lee del worktree los archivos relevantes para la tarea:

1. Toma la lista de `expectedOutput.changedFiles` del contrato — los archivos que se espera que el agente modifique o cree.
2. Lee el contenido actual de cada archivo desde el worktree.
3. Si un archivo no existe todavía (es un archivo que el agente debe crear desde cero), lo marca explícitamente como `"(does not exist yet — create it)"`. Esto guía al agente para que no asuma que hay código preexistente donde no lo hay.
4. Aplica límites de tamaño: 8KB máximo por archivo, 32KB en total para todos los archivos juntos, máximo 10 archivos. Los archivos se recortan con un marcador `"…[truncated]"` cuando exceden el límite por archivo.

La protección contra path traversal (`isWithinWorktree()`) rechaza cualquier path que intente salir del directorio del worktree con `../` o rutas absolutas que apunten fuera.

### Las interfaces consumidas en el prompt

Más allá del contenido de archivos, el `FileSystemContextPacker` también incluye las `consumedInterfaces` del contrato de la hoja — las firmas TypeScript que otras hojas paralelas están produciendo y que esta hoja debe respetar.

En el prompt, aparecen con un encabezado explícito del tipo: *"Otras tareas están produciendo estas interfaces. Construí exactamente contra estas firmas; no inventes una versión propia."* Esto es lo que hace funcionar el aislamiento paralelo: la costura llega al agente como contexto fijo antes de que empiece a escribir código.

Análogamente, las `producedInterfaces` aparecen como: *"Tu trabajo debe exponer estas interfaces con exactamente esta forma, porque otras tareas dependen de ellas."*

### Lo que retorna

`pack()` retorna `{ section: string, includedFiles: string[], totalBytes: number }`. La `section` es el bloque de texto listo para insertar en el prompt. `includedFiles` permite al `ResultRecorder` saber exactamente qué archivos el agente tenía disponibles para su análisis de scope.

---

## ScopeChecker

### Responsabilidad

Verificar que el conjunto de archivos que el agente modificó (según `git diff --name-only`) está completamente dentro del scope permitido por su contrato. Es la última línea de defensa antes de que el orquestador commitee.

### Cómo funciona

`check(changedFiles, contract)` recibe la lista de paths que cambiaron y el contrato de la hoja:

1. **Construye la lista de globs permitidos** combinando las tres categorías del `executionScope`: `implementationPaths`, `testPaths`, y `configPaths`. Un archivo está permitido si matchea alguno de estos globs.

2. **Aplica deny wins:** si un archivo matchea un glob de `forbiddenPaths`, es una violación — sin importar que también matchee un glob permitido. Los paths prohibidos siempre ganan sobre los permitidos. Esto existe porque `forbiddenPaths` suelen incluir cosas como `*.env`, directorios de configuración sensibles, o archivos que definen el contrato global del sistema (un cambio ahí rompería todo).

3. **Retorna** `{ passed: boolean, violations: string[], outOfScope: string[] }`.
   Si `passed` es `false`, `violations` lista archivos prohibidos que bloquean
   el commit. Los archivos fuera del allow-list pero no prohibidos se registran
   en `outOfScope` como señal advisory: quedan visibles para auditoría, pero no
   fallan la hoja por sí solos.

Si el check falla por `forbiddenPaths`, el `ResultRecorder` descarta el resultado
de la hoja sin commitear — el worktree simplemente se limpia. El estado de la
hoja queda en `scope_violation`.

### Por qué tres categorías y no un solo glob

Separar `implementationPaths`, `testPaths` y `configPaths` permite al `ResultRecorder` reportar métricas más granulares (cuántas líneas de código vs. cuántas de tests cambió el agente) y permite al Decomposer expresar con más precisión qué tipo de cambios espera de cada hoja. Un leaf que solo debe agregar tests tiene `testPaths` poblados pero `implementationPaths` vacíos — si toca código fuente, es una violación.

---

## Interfaces

**FileSystemContextPacker:**
- Recibe: `worktreePath` + `AgentTaskContract`
- Produce: `{ section: string, includedFiles: string[], totalBytes: number }`
- Lo invoca: `RunExecutor` antes de llamar a `GeminiCliExecutor`

**ScopeChecker:**
- Recibe: `changedFiles: string[]` + `AgentTaskContract`
- Produce: `ScopeCheckResult = { passed: boolean, violations: string[] }`
- Lo invoca: `ResultRecorder` después de `git diff --name-only`

---

## Decisiones de diseño

El límite de 32KB total del packer no es arbitrario — es un balance entre darle al agente suficiente contexto para hacer su trabajo y no desperdiciar tokens en código irrelevante. Un agente que recibe 200KB de contexto tiene más probabilidad de alucinarse o de ignorar las instrucciones centrales que uno que recibe exactamente lo que necesita.

El deny-wins en el ScopeChecker es la decisión más importante de esta capa. La alternativa (allow-wins, donde un archivo permitido puede overridear uno prohibido) abriría un vector de ataque trivial: un agente malicioso o un LLM alucinado podría tocar archivos de credenciales simplemente porque su path matchea un glob de implementación muy amplio como `src/**/*.ts`.
