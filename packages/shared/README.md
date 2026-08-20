# @manyhands/shared

Capa base zero-dependency de ManyHands: primitivas validadas con Zod, modelo epistémico, registro canónico de ejecutores LLM y utilidades de bajo nivel para invocación y terminación de procesos CLI.

---

## Propósito y Responsabilidad en ManyHands

**`@manyhands/shared`** es la capa cero (*Layer 0*) del monorepo ManyHands. No depende de ningún otro paquete interno (`@manyhands/*`) y provee las bases tipadas y deterministas utilizadas transversalmente en todo el sistema.

### ¿Por qué existe este paquete?
1. **Garantizar la Coherencia de Tipos Primitivos**: Estandariza identificadores (`EntityIdSchema`), marcas de tiempo ISO 8601 (`IsoTimestampSchema`), referencias a recursos de repositorio (`ResourceReferenceSchema`) y contratos de evidencia.
2. **Modelo Epistémico Formal (`EpistemicAssessment`)**: Provee una estructura rigurosa para representar el estado de conocimiento del sistema (hechos conocidos con evidencia, incertidumbre honesta, información parcial o evidencias en conflicto).
3. **Registro Centralizado de Ejecutores y Reasoning Effort (`executor-registry.ts`)**: Es la **única fuente de verdad** para los modelos de lenguaje soportados (Claude Code, Codex, etc.), sus capacidades (`planning`, `execution`, `repair`) y los niveles de esfuerzo de razonamiento cognitivo admitidos.
4. **Ejecución Segura y Aislamiento de Procesos CLI (`node-cli-process.ts`)**: Provee wrappers seguros multiplataforma para ejecutar binarios CLI, evitando vulnerabilidades de inyección de argumentos en Windows (mitigación DEP0190) y garantizando la terminación completa de árboles de procesos (*process-tree termination*).

---

## Arquitectura Modular Interna

El paquete está estructurado en 3 módulos altamente cohesivos en `src/`:

```
packages/shared/src/
├── index.ts                 # Schemas primitivos, modelo epistémico y utilidades matemáticas puras
├── executor-registry.ts     # Registro canónico de ejecutores LLM, modelos y niveles de razonamiento
└── node-cli-process.ts      # Invocación segura de binarios y terminación en árbol (export: ./node-cli-process)
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `index.ts` | Exporta schemas fundamentales (`EntityIdSchema`, `NonEmptyStringSchema`, `EpistemicAssessmentSchema`, `ResourceReferenceSchema`, `FinalArtifactManifestSchema`, etc.), re-exporta el registro de ejecutores y provee utilidades puras (`nowIso`, `uniqueValues`, `intersectValues`, `clamp01`, `pairKey`). |
| `executor-registry.ts` | Define `EFFORT_LEVELS`, el catálogo `EXECUTOR_DESCRIPTORS`, tipos de selección (`ExecutorSelection`, `StageSelection`), funciones de normalización y búsqueda (`getExecutorDescriptor`, `supportsEffortForSelection`), y el validador estático de integridad `assertValidExecutorRegistry`. |
| `node-cli-process.ts` | Subpath export (`./node-cli-process`). Provee resolución de binarios en Windows (`resolveCliBinaryPath`), construcción segura de comandos escapados contra `ComSpec` (`resolveCliProcessInvocation`) y terminación sincronizada de subprocesos y descendientes (`killCliProcessTree`). |

---

## Patrones de Diseño y Estrategias Técnicas

### 1. Núcleo Zero-Dependency y Funciones Puras
`@manyhands/shared` solo depende de `zod` y de las APIs nativas de Node.js (`node:child_process`, `node:fs`, `node:path`). No importa utilidades de logging pesado, frameworks web ni librerías de Git. Esto garantiza que cualquier paquete o script del monorepo pueda importarlo sin riesgo de dependencias circulares o sobrecarga de bundle.

### 2. Single Source of Truth para Capacidades LLM y Reasoning Effort
Para evitar que diferentes paquetes (ej. decomposer, execution-core, web UI) declaren listas disjuntas de modelos o niveles de esfuerzo:
- **`EFFORT_LEVELS`**: Definido como `["low", "medium", "high", "xhigh"] as const`. Todos los schemas Zod y tipos del sistema derivan directamente de esta constante.
- **Diferenciación explícita entre "sin soporte" y "esfuerzo vacío"**: En `ExecutorModelDescriptor`, la propiedad `efforts` es `readonly EffortLevel[] | null`. `null` indica que el modelo no admite configuración de esfuerzo (ej. Claude Code CLI), mientras que un array define los niveles válidos (ej. Codex CLI).
- **Auto-Validación en Tiempo de Carga (`assertValidExecutorRegistry`)**: Al importarse el módulo, se ejecuta una verificación exhaustiva de integridad que valida que ningún modelo esté duplicado, que las capacidades sean válidas y que los `defaultEffort` pertenezcan a la lista de esfuerzos declarados.

### 3. Modelo Epistémico Formal (`EpistemicAssessmentSchema`)
ManyHands no asume que la ausencia de un error implica éxito. El modelo epistémico formaliza cuatro estados de conocimiento:
- `unknown`: No hay información sobre el recurso; se exige un `reason` descriptivo y `evidenceRefs` vacío.
- `known`: Hecho confirmado con respaldo probatorio; exige nivel de confianza (`high | medium | low`) y al menos una referencia en `evidenceRefs`.
- `partial`: Información truncada por límites de presupuesto o visibilidad incompleta.
- `conflicting`: Existen fuentes de datos contradictorias en el repositorio.

```typescript
export const EpistemicAssessmentSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown"), reason: NonEmptyStringSchema, evidenceRefs: z.tuple([]) }).strict(),
  z.object({
    state: z.enum(["known", "partial", "conflicting"]),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceRefs: z.array(NonEmptyStringSchema).min(1)
  }).strict()
]);
```

### 4. Mitigación de Vulnerabilidades CLI en Windows (DEP0190)
En entornos Windows, invocar wrappers batch (`.cmd`, `.bat`) pasando argumentos mediante `{ shell: true }` en `child_process.spawn` está desaconsejado por Node.js (deprecación DEP0190) debido a riesgos de inyección de comandos por concatenación no higiénica.
`resolveCliProcessInvocation` resuelve este problema:
1. Detecta si el archivo requiere shell mediante `cliPathRequiresShell` (inspeccionando si termina en `.cmd` o `.bat`).
2. Si no requiere shell, ejecuta el binario directamente con `shell: false`.
3. Si requiere shell, invoca explícitamente `ComSpec` (típicamente `cmd.exe`) con los flags `/d /v:off /s /c` (donde `/v:off` previene la expansión retardada de variables) y escapa metacaracteres con acento circunflejo `^` y comillas dobles, activando `windowsVerbatimArguments: true`.

```typescript
export function resolveCliProcessInvocation(
  binaryPath: string,
  args: readonly string[],
  options: ResolveCliProcessInvocationOptions = {}
): CliProcessInvocation;
```

### 5. Terminación Garantizada de Árboles de Procesos (`killCliProcessTree`)
Cuando un proceso de agente o compilación sufre un timeout o cancelación:
- En Windows, `child.kill()` estándar sólo termina el proceso padre, dejando vivos procesos hijos (como `git`, compiladores TypeScript, o subprocesos de CLI) que continúan escribiendo en disco y bloqueando archivos.
- `killCliProcessTree` ejecuta `taskkill.exe /pid <PID> /t /f` para destruir de forma recursiva todo el árbol de procesos.
- Implementa una **barrera de sincronización**: espera activamente a que el handle del proceso de Node.js emita el evento `close` y confirme que el proceso ya no existe en el sistema operativo antes de retornar, evitando que el orquestador intente limpiar o mover el worktree mientras un proceso residual sigue activo.
- En sistemas Unix, aplica `process.kill(-pid, "SIGKILL")` sobre el grupo de procesos (*process group*).

---

## Puntos de Entrada, Interfaces y Schemas Clave

### Primitivas de Dominio y Validación (`src/index.ts`)

| Schema / Función | Tipo / Retorno | Propósito |
|---|---|---|
| `ReasoningEffortSchema` | `EffortLevel` | Validador Zod para niveles de esfuerzo (`"low" \| "medium" \| "high" \| "xhigh"`). |
| `EntityIdSchema` | `string` | Identificador alfanumérico seguro para entidades del sistema (`/^[A-Za-z0-9._:-]+$/`). |
| `ResourceReferenceSchema` | `string` | Localizador de recursos en el repositorio (permite barras y prohíbe `..`). |
| `EpistemicAssessmentSchema`| `EpistemicAssessment` | Modelo discriminado de estado de certeza y evidencia. |
| `FinalArtifactManifestSchema`| `FinalArtifactManifest` | Manifiesto de entrega final con hashes de commit, árbol y matriz de evidencia. |
| `nowIso()` | `string` | Retorna timestamp UTC actual en formato ISO 8601. |
| `clamp01(value)` | `number` | Restringe un valor numérico al intervalo cerrado [0.0, 1.0]. |
| `pairKey(a, b)` | `string` | Genera una clave canónica ordenada lexicográficamente (`"left::right"`). |

---

### Registro de Ejecutores (`src/executor-registry.ts`)

| Identificador / Función | Tipo / Firma | Propósito |
|---|---|---|
| `CLAUDE_CODE_EXECUTOR_ID` | `"claude-code-cli"` | Identificador constante del ejecutor Claude Code CLI. |
| `CODEX_EXECUTOR_ID` | `"codex-cli"` | Identificador constante del ejecutor Codex CLI. |
| `OPENCODE_EXECUTOR_ID` | `"opencode-cli"` | Identificador del ejecutor OpenCode (deshabilitado, para runs históricos). |
| `EXECUTOR_DESCRIPTORS` | `ExecutorDescriptor[]` | Catálogo maestro de ejecutores, proveedores, binarios y modelos. |
| `getExecutorDescriptor(id)` | `(id: ExecutorId) => ExecutorDescriptor` | Obtiene el descriptor del ejecutor o lanza error si no existe. |
| `findExecutorModel(sel)` | `(sel: ExecutorSelection) => ExecutorModelDescriptor \| undefined` | Localiza el descriptor de un modelo específico dentro de un ejecutor. |
| `supportsEffortForSelection(sel)` | `(sel: ExecutorSelection) => boolean` | Indica si el modelo seleccionado admite control de reasoning effort. |
| `effortsForSelection(sel)` | `(sel: ExecutorSelection) => readonly EffortLevel[] \| null` | Lista los niveles de esfuerzo admitidos por el modelo. |
| `normalizeExecutorSelection(val)`| `(val: unknown) => ExecutorSelection \| undefined` | Normaliza strings o selecciones parciales al formato canónico. |

---

### Aislamiento de Procesos CLI (`src/node-cli-process.ts`)

```typescript
import {
  resolveCliBinaryPath,
  cliPathRequiresShell,
  resolveCliProcessInvocation,
  killCliProcessTree
} from "@manyhands/shared/node-cli-process";
```

| Función | Parámetros | Propósito |
|---|---|---|
| `resolveCliBinaryPath` | `(binaryPath: string, options?: ResolveCliBinaryPathOptions): string` | Resuelve el path real del binario considerando extensiones ejecutables de Windows. |
| `cliPathRequiresShell` | `(binaryPath: string, platform?: NodeJS.Platform): boolean` | Determina si un ejecutable requiere envoltorio shell (`.cmd` / `.bat`). |
| `resolveCliProcessInvocation` | `(binaryPath: string, args: readonly string[], options?: ResolveCliProcessInvocationOptions): CliProcessInvocation` | Construye argumentos seguros y flags de `ComSpec` para prevenir DEP0190. |
| `killCliProcessTree` | `(child: KillableCliProcess, spawnFn: CliSpawnFn, platform?: NodeJS.Platform, options?: KillCliProcessTreeOptions): Promise<boolean>` | Termina de forma garantizada un proceso y todos sus descendientes con barrera de sincronización. |

---

### Ejemplos de Uso

#### 1. Consulta y Validación en el Registro de Ejecutores

```typescript
import {
  getExecutorDescriptor,
  supportsEffortForSelection,
  effortsForSelection,
  CODEX_EXECUTOR_ID,
  CLAUDE_CODE_EXECUTOR_ID
} from "@manyhands/shared";

// Consulta de soporte de reasoning effort para Claude Code
const claudeSelection = { executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" };
console.log("Claude Sonnet admite effort:", supportsEffortForSelection(claudeSelection)); // false

// Consulta de soporte para OpenAI Codex
const codexSelection = { executorId: CODEX_EXECUTOR_ID, model: "gpt-5.5" };
console.log("GPT-5.5 admite effort:", supportsEffortForSelection(codexSelection)); // true
console.log("Niveles admitidos:", effortsForSelection(codexSelection)); // ["low", "medium", "high", "xhigh"]
```

#### 2. Invocación Segura de Procesos CLI y Mitigación DEP0190

```typescript
import { resolveCliBinaryPath, resolveCliProcessInvocation } from "@manyhands/shared/node-cli-process";
import { spawn } from "node:child_process";

// 1. Resuelve el binario ejecutable en el sistema (ej. "claude" -> "C:\\npm\\claude.cmd")
const binaryPath = resolveCliBinaryPath("claude");

// 2. Genera los argumentos de invocación seguros para Windows / Unix
const invocation = resolveCliProcessInvocation(binaryPath, ["--version", "--json"]);

// 3. Ejecuta el proceso sin concatenaciones vulnerables
const child = spawn(invocation.command, invocation.args, {
  shell: invocation.shell,
  windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  stdio: "pipe"
});
```

#### 3. Terminación Segura de un Subproceso con `killCliProcessTree`

```typescript
import { killCliProcessTree } from "@manyhands/shared/node-cli-process";
import { spawn } from "node:child_process";

// Supongamos un proceso de agente que excedió el tiempo límite
const child = spawn("claude", ["--prompt", "Refactor module"], { stdio: "pipe" });

// Terminación garantizada del proceso y sus subprocesos descendientes
const terminated = await killCliProcessTree(child, spawn);
if (terminated) {
  console.log("El árbol de procesos fue terminado y los handles del OS se liberaron.");
}
```

---

## Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan canónico de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Alineación Target**: `@manyhands/shared` está 100% alineado con la arquitectura canónica. No posee brechas de transición ni depende de subsistemas deprecados.
2. **Ejecutores Históricos**: `OPENCODE_EXECUTOR_ID` se mantiene registrado con `enabled: false` exclusivamente para permitir la deserialización y lectura de registros de ejecuciones históricas sin generar excepciones en tiempo de ejecución.
3. **Helpers de Compatibilidad**: La función `resolveLegacyModelSelection` traduce identificadores de modelo planos (utilizados en prototipos iniciales) a tuplas estructuradas `ExecutorSelection`.

---

## Comandos de Verificación y Testing

Para verificar el tipado estricto y compilar el paquete:

```bash
# Verificación de tipos TypeScript
pnpm --filter @manyhands/shared typecheck

# Compilación y generación de bundles (.js, .cjs, .d.ts) con tsup
pnpm --filter @manyhands/shared build

# Ejecución de tests unitarios del paquete
pnpm test packages/shared
```
