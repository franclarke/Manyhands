# Guía Arquitectónica: @manyhands/shared

> **Ubicación en el Monorepo**: `packages/shared/`  
> **README del Paquete**: [`../../packages/shared/README.md`](../../packages/shared/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

**`@manyhands/shared`** constituye la **Capa Cero (*Layer 0*)** del monorepo ManyHands. Es un paquete sin dependencias internas sobre otros paquetes del proyecto (`@manyhands/*`) y provee las primitivas fundamentales, tipado estricto con [Zod](https://zod.dev), modelos epistémicos formales, el registro canónico de ejecutores LLM y utilidades de bajo nivel para la invocación segura de procesos CLI en múltiples plataformas.

### Problemas Fundamentales que Resuelve

1. **Unificación de Tipos Primitivos y Formatos**: Estandariza identificadores seguros (`EntityIdSchema`), marcas de tiempo ISO 8601 UTC (`IsoTimestampSchema`), referencias de repositorio (`ResourceReferenceSchema`) y manifiestos de entrega final (`FinalArtifactManifestSchema`).
2. **Modelo Epistémico Formal (`EpistemicAssessment`)**: Provee una estructura rigurosa para representar el estado de certeza del sistema (hechos conocidos con evidencia, incertidumbre honesta, información parcial por presupuesto o conflictos), evitando asumir que la falta de error implica éxito.
3. **Fuente Única de Verdad para Ejecutores y Reasoning Effort (`executor-registry.ts`)**: Centraliza los modelos de lenguaje admitidos (Claude Code, OpenAI Codex, etc.), sus capacidades (`planning`, `execution`, `repair`) y los niveles de esfuerzo de razonamiento cognitivo (`"low"`, `"medium"`, `"high"`, `"xhigh"`).
4. **Invocación Segura de Procesos CLI en Windows (Mitigación DEP0190)**: Previene vulnerabilidades de inyección de comandos al invocar scripts batch (`.cmd`/`.bat`) en Windows sin recurrir a `{ shell: true }` inseguro.
5. **Terminación Garantizada de Árboles de Procesos (`killCliProcessTree`)**: Resuelve el problema de subprocesos huérfanos (*orphan processes*) y bloqueos de archivos en Windows mediante `taskkill.exe /t /f` y una barrera de sincronización activa antes de liberar recursos.

---

## 2. Arquitectura Interna y Componentes

El paquete está estructurado en 3 módulos altamente cohesivos en `src/`:

```
packages/shared/
├── src/
│   ├── index.ts                 # Barrel export: primitivas Zod, modelo epistémico y utilidades matemáticas
│   ├── executor-registry.ts     # Registro maestro de ejecutores LLM, modelos y reasoning effort
│   └── node-cli-process.ts      # Invocación segura y terminación de subprocesos (export: ./node-cli-process)
├── package.json
└── tsconfig.json
```

### Desglose de Responsabilidades por Módulo

| Módulo / Export | Responsabilidad Principal |
|---|---|
| `src/index.ts` | Exporta schemas fundamentales (`EntityIdSchema`, `NonEmptyStringSchema`, `EpistemicAssessmentSchema`, `ResourceReferenceSchema`, `FinalArtifactManifestSchema`), re-exporta el registro de ejecutores y provee funciones puras (`nowIso`, `uniqueValues`, `intersectValues`, `clamp01`, `pairKey`). |
| `src/executor-registry.ts` | Define `EFFORT_LEVELS`, el catálogo `EXECUTOR_DESCRIPTORS`, tipos de selección (`ExecutorSelection`, `StageSelection`), utilidades de búsqueda (`getExecutorDescriptor`, `supportsEffortForSelection`, `effortsForSelection`) y auto-validación de integridad en carga (`assertValidExecutorRegistry`). |
| `src/node-cli-process.ts` | Subpath export (`@manyhands/shared/node-cli-process`). Provee resolución de binarios en Windows (`resolveCliBinaryPath`), construcción segura de comandos escapados contra `ComSpec` (`resolveCliProcessInvocation`) y terminación recursiva sincronizada (`killCliProcessTree`). |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el rol transversal de `@manyhands/shared` como base para planificación, ejecución y seguridad de procesos:

```
                        @manyhands/shared
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌──────────────┐       ┌──────────────┐       ┌─────────────────┐
│ Tipos Zod    │       │ Registro de  │       │ node-cli-       │
│ & Epistémico │       │  Ejecutores  │       │ process         │
└──────┬───────┘       └──────┬───────┘       └────────┬────────┘
       │                      │                        │
       ▼                      ▼                        ▼
• @manyhands/contracts • @manyhands/decomposer  • @manyhands/execution-core
• @manyhands/task-graph• apps/web (Command      • apps/daemon (Workers
• @manyhands/run-store   Center UI & Effort)      & Supervisores CLI)
```

### Flujo de Invocación y Terminación Segura de Procesos CLI

```
                 Petición de Invocación CLI (args, binaryPath)
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │  resolveCliProcessInvocation  │
                     └───────────────┬───────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        [Requiere Shell: .cmd/.bat]             [Binario Nativo: .exe]
                 │                                       │
                 ▼                                       ▼
       Invoca %ComSpec% con                    Ejecuta con shell: false
    /d /v:off /s /c + Escapado                y flags directos de SO
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     ▼
                            child_process.spawn
                                     │
                         (Ejecución del Agente LLM)
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        [Terminación Normal]                  [Cancelación / Timeout]
                 │                                       │
                 ▼                                       ▼
           Emite exit code                     killCliProcessTree
                                                         │
                                                         ▼
                                            taskkill /pid <PID> /t /f (Win)
                                            o process.kill(-PID, "SIGKILL") (POSIX)
                                                         │
                                                         ▼
                                            Barrera de Sincronización:
                                            Espera activa evento 'close'
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Primitivas de Dominio y Validación (`src/index.ts`)

| Schema / Función | Tipo / Retorno | Propósito |
|---|---|---|
| `ReasoningEffortSchema` | `EffortLevel` | Validador Zod para niveles de esfuerzo (`"low" \| "medium" \| "high" \| "xhigh"`). |
| `EntityIdSchema` | `string` | Identificador alfanumérico seguro (`/^[A-Za-z0-9._:-]+$/`). |
| `ResourceReferenceSchema` | `string` | Localizador de recursos en el repositorio (permite barras y prohíbe `..`). |
| `EpistemicAssessmentSchema` | `EpistemicAssessment` | Unión discriminada por `state` (`"unknown" \| "known" \| "partial" \| "conflicting"`). |
| `FinalArtifactManifestSchema` | `FinalArtifactManifest` | Manifiesto de entrega final con hashes de commit, árbol y matriz de evidencia. |
| `nowIso()` | `string` | Retorna timestamp UTC actual en formato ISO 8601. |
| `clamp01(value)` | `number` | Restringe un valor numérico al intervalo cerrado $[0.0, 1.0]$. |
| `pairKey(a, b)` | `string` | Genera una clave canónica ordenada lexicográficamente (`"left::right"`). |

### Registro Maestro de Ejecutores (`src/executor-registry.ts`)

| Símbolo | Tipo / Firma | Propósito |
|---|---|---|
| `CLAUDE_CODE_EXECUTOR_ID` | `"claude-code-cli"` | Identificador constante del ejecutor Claude Code CLI. |
| `CODEX_EXECUTOR_ID` | `"codex-cli"` | Identificador constante del ejecutor OpenAI Codex CLI. |
| `OPENCODE_EXECUTOR_ID` | `"opencode-cli"` | Identificador del ejecutor OpenCode (deshabilitado, para runs históricos). |
| `EXECUTOR_DESCRIPTORS` | `readonly ExecutorDescriptor[]` | Catálogo maestro de ejecutores, proveedores, binarios y modelos. |
| `getExecutorDescriptor(id)` | `(id: ExecutorId) => ExecutorDescriptor` | Obtiene el descriptor del ejecutor o lanza error si no existe. |
| `findExecutorModel(sel)` | `(sel: ExecutorSelection) => ExecutorModelDescriptor \| undefined` | Localiza el descriptor de un modelo específico dentro de un ejecutor. |
| `supportsEffortForSelection(sel)` | `(sel: ExecutorSelection) => boolean` | Indica si el modelo seleccionado admite control de reasoning effort. |
| `effortsForSelection(sel)` | `(sel: ExecutorSelection) => readonly EffortLevel[] \| null` | Lista los niveles de esfuerzo admitidos por el modelo. |

### Aislamiento de Procesos CLI (`src/node-cli-process.ts`)

```typescript
import {
  resolveCliBinaryPath,
  cliPathRequiresShell,
  resolveCliProcessInvocation,
  killCliProcessTree
} from "@manyhands/shared/node-cli-process";

export interface CliProcessInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly shell: boolean;
    readonly windowsVerbatimArguments?: boolean;
  };
}

export function resolveCliProcessInvocation(
  binaryPath: string,
  args: readonly string[],
  options?: ResolveCliProcessInvocationOptions
): CliProcessInvocation;

export function killCliProcessTree(
  child: KillableCliProcess,
  spawnFn: CliSpawnFn,
  platform?: NodeJS.Platform,
  options?: KillCliProcessTreeOptions
): Promise<boolean>;
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Núcleo Zero-Dependency y Funciones Puras
`@manyhands/shared` solo depende de `zod` y de los módulos nativos de Node.js (`node:child_process`, `node:fs`, `node:path`, `node:crypto`). Esto previene dependencias circulares y asegura que cualquier componente del monorepo pueda importarlo sin sobrecarga.

### 2. Fuente Única de Verdad para Reasoning Effort
Para evitar discrepancias entre la interfaz web, el planificador y el ejecutor:
- `EFFORT_LEVELS`: Definido como `["low", "medium", "high", "xhigh"] as const`. Todos los esquemas Zod y tipos del sistema derivan de esta tupla.
- En `ExecutorModelDescriptor`, la propiedad `efforts` es `readonly EffortLevel[] | null`. `null` indica que el modelo no admite configuración de esfuerzo (ej. Claude Code CLI), mientras que un array define los niveles válidos (ej. OpenAI Codex CLI).
- `assertValidExecutorRegistry`: Al importarse el módulo, se ejecuta una verificación exhaustiva de integridad que valida que ningún modelo esté duplicado, que las capacidades sean válidas y que los `defaultEffort` pertenezcan a la lista de esfuerzos declarados.

### 3. Modelo Epistémico Formal (`EpistemicAssessmentSchema`)
ManyHands no asume que la ausencia de un error implica éxito. El modelo epistémico formaliza cuatro estados de conocimiento:
- `unknown`: No hay información sobre el recurso; se exige un `reason` descriptivo y `evidenceRefs` vacío.
- `known`: Hecho confirmado con respaldo probatorio; exige nivel de confianza (`high | medium | low`) y al menos una referencia en `evidenceRefs`.
- `partial`: Información truncada por límites de presupuesto o visibilidad incompleta.
- `conflicting`: Existen fuentes de datos contradictorias en el repositorio.

```typescript
export const EpistemicAssessmentSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("unknown"),
    reason: NonEmptyStringSchema,
    evidenceRefs: z.tuple([])
  }).strict(),
  z.object({
    state: z.enum(["known", "partial", "conflicting"]),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceRefs: z.array(NonEmptyStringSchema).min(1)
  }).strict()
]);
```

### 4. Mitigación de Vulnerabilidades CLI en Windows (DEP0190)
En entornos Windows, invocar scripts batch (`.cmd`, `.bat`) pasando argumentos mediante `{ shell: true }` en `child_process.spawn` está desaconsejado por Node.js (deprecación DEP0190) debido a riesgos de inyección de comandos por concatenación no higiénica.
`resolveCliProcessInvocation` resuelve este problema:
1. Detecta si el archivo requiere shell mediante `cliPathRequiresShell` (inspeccionando si termina en `.cmd` o `.bat`).
2. Si no requiere shell, ejecuta el binario directamente con `shell: false`.
3. Si requiere shell, invoca explícitamente `ComSpec` (típicamente `cmd.exe`) con los flags `/d /v:off /s /c` (donde `/v:off` previene la expansión retardada de variables) y escapa metacaracteres con acento circunflejo `^` y comillas dobles, activando `windowsVerbatimArguments: true`.

### 5. Terminación Garantizada de Árboles de Procesos (`killCliProcessTree`)
Cuando un proceso de agente o compilación sufre un timeout o cancelación:
- En Windows, `child.kill()` estándar sólo termina el proceso padre, dejando vivos subprocesos hijos (compiladores, linters o subprocesos de CLI) que continúan consumiendo CPU y bloqueando archivos.
- `killCliProcessTree` ejecuta `taskkill.exe /pid <PID> /t /f` para destruir de forma recursiva todo el árbol de procesos.
- Implementa una **barrera de sincronización**: espera activamente a que el handle del proceso emita el evento `close` y confirme que el proceso ya no existe en el sistema operativo antes de retornar, evitando que el orquestador intente limpiar o mover el worktree mientras un proceso residual sigue activo.
- En sistemas Unix, aplica `process.kill(-pid, "SIGKILL")` sobre el grupo de procesos (*process group*).

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 1 / G1)**: Las primitivas, el modelo epistémico y el registro canónico de ejecutores están cerrados e integrados transversalmente.
2. **Ejecutores Históricos**: `opencode-cli` permanece catalogado en `EXECUTOR_DESCRIPTORS` con `status: "disabled"` únicamente para permitir la deserialización y análisis de corridas históricas sin romper invariantes.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/shared/README.md`](../../packages/shared/README.md)
- **Módulos Relacionados**:
  - [`contracts.md`](./contracts.md): Schemas y contratos que extienden las primitivas de `@manyhands/shared`.
  - [`decomposer.md`](./decomposer.md): Uso del registro de ejecutores y modelo epistémico en la planificación.
  - [`execution-core.md`](./execution-core.md): Aislamiento y supervisión física basada en `node-cli-process`.
  - [`daemon.md`](./daemon.md): Control de subprocesos y workers locales.
- **Documentación Central**: [`../README.md`](../README.md)
