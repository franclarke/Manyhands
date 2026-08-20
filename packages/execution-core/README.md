# @manyhands/execution-core

Motor operativo de ejecución física, aislamiento de entornos, sandboxing de procesos, materialización de artefactos Git, validación por matriz de evidencia, integración jerárquica y publicación transaccional para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/execution-core` es el paquete operativo central del sistema. Mientras que `@manyhands/run-coordinator` y `@manyhands/run-engine` gestionan la lógica de dominio pura, eventos y máquinas de estado, `@manyhands/execution-core` ejecuta todas las interacciones físicas con el sistema operativo:

1. **Materialización de Bases de Ejecución Inmutables**: Reconstruye árboles de trabajo Git exactos a partir de manifiestos de artefactos direccionados por contenido (`ArtifactManifest`), sin arrastrar historiales de commits innecesarios ni invocar hooks o filtros no controlados.
2. **Aislamiento y Sandboxing de Procesos**: Modela dimensiones ortogonales de seguridad: worktrees efímeros, sandboxes de procesos (Windows Job Objects / isolation trees), políticas de red y broker de credenciales efímeras (`CredentialBroker`).
3. **Supervisión Confiable de Procesos**: Supervisa subprocesos de agentes (Claude Code, Codex, Mock), administra buffers de salida acotados (`BoundedOutputBuffer`), previene fugas de procesos en memoria (`LiveProcessRegistry`) y garantiza la terminación del árbol completo ante señales de cancelación.
4. **Validación contra Matrices de Evidencia**: Evalúa obligaciones de validación (`ValidationObligation`) sobre candidatos exactos, ejecutando controles negativos (`negativeControl`) para verificar sensibilidad y análisis estático de AST para prevenir la manipulación o debilitamiento de tests (`TestIntegrityValidator`).
5. **Integración Compuesta como Intento de Primer Nivel**: Fusiona resultados de nodos hijos en compositos mediante manifiestos de integración (`IntegrationManifestExecutor`), bitácoras transaccionales (`IntegrationOperationJournal`) y reparación asistida por LLM acotada a un único pase.
6. **Entrega Transaccional por Compare-and-Swap (CAS)**: Publica candidatos finales verificados garantizando que el branch destino no haya mutado concurrentemente (`TransactionalDeliveryPublisher`).

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` comprende 18 submódulos especializados:

```
packages/execution-core/src/
├── base/           # ExecutionBaseBuilder, ExecutionBaseManifest, ArtifactMaterializer
├── git/            # GitRunner, GitArtifactBuilder, ExactGitManifestMaterializer, artifact-retention
├── sandbox/        # SandboxProvider, CredentialBroker, WorkspaceProvider, tipos de SandboxProfile
├── supervisor/     # ProcessSupervisor, recibos de procesos duraderos (started/final)
├── executor/       # CliExecutor, MockExecutor, perfiles (claude-code, codex), BoundedOutputBuffer
├── validation/     # CandidateValidator, EvidenceMatrix, RecipeCompiler, ExactEvidenceBinding, TestIntegrity
├── integration/    # IntegrationManifestExecutor, OperationJournal, PreMergeValidator, SyntaxChecker
├── delivery/       # TransactionalDeliveryPublisher, CandidatePreparer, TargetCleanlinessValidator
├── scope/          # Glob matcher, ScopeChecker, ScopeErrors, ArtifactScopes
├── routing/        # ComplexityRouter, AvailabilityChecker, RoutingPolicy
├── v2/             # V2NodeExecutor, V2ExactCandidateValidator (orquestación operativa de nodo)
├── run/            # WorldReconciler, AmendmentsEngine, SkeletonScaffolder, GroundingAgent
├── worktree/       # WorktreeManager, ExecutionWorkspaceProvider
├── context/        # ContextPacker
├── granularity/    # GranularityVector y métricas de experimentación
├── result/         # ResultRecorder (inspección de diffs y HEAD)
├── logging/        # Loggers internos estructurados
├── types.ts        # Tipos centrales y Zod Schemas de resultados, worktrees y configuración
├── errors.ts       # Jerarquía tipada de errores de ejecución
├── pricing.ts      # Estimación y cómputo de costos de tokens por modelo
└── index.ts        # Barrel export unificado
```

### Desglose Detallado por Submódulo

- **`base/`**:
  - `execution-base-builder.ts`: Orquesta la adquisición de un workspace limpio y materializa secuencialmente los artefactos requeridos para construir la base de ejecución del intento.
  - `execution-base-manifest.ts`: Schema Zod y tipos del manifiesto inmutable `ExecutionBaseManifest` (con `inputFingerprint`, `baseCommit` y `materializedArtifacts`).
  - `artifact-materializer.ts`: Aplica artefactos en el disco utilizando `ExactGitManifestMaterializer`.
- **`git/`**:
  - `exact-manifest-materializer.ts`: Aplica entradas `ChangeSetEntry` (add, modify, delete, type_change) directamente sobre el índice temporal de Git con `read-tree` y `write-tree`, verificando preimágenes y postimágenes blob exactas.
  - `artifact-builder.ts`: Convierte diffs de Git entre `baseCommit` y `candidateCommit` en manifiestos inmutables `ChangeSetManifest` o `CandidateTreeManifest`.
  - `runner.ts`: Interfaz y wrapper sobre `simple-git` para operaciones deterministas de bajo nivel.
  - `artifact-retention.ts`: Crea y mantiene referencias de retención Git namespaced (`refs/manyhands/runs/...`) para evitar que el garbage collector de Git elimine objetos citados por evidencias activas.
- **`sandbox/`**:
  - `credential-broker.ts`: Materializa credenciales de proveedores (Anthropic / OpenAI) en un directorio `HOME` efímero y aislado por intento o trabajador supervisado, con purga garantizada tras la salida o crash.
  - `types.ts`: Define las capacidades del sandbox (`SandboxCapabilities`: filesystem, network, process, hostIdentity, tooling, enforcement) y perfiles (`"strong"`, `"workspace"`, `"unsafe_local"`).
  - `workspace-provider.ts`: Interfaz para adquirir y liberar espacios de trabajo de ejecución.
- **`supervisor/`**:
  - `process-supervisor.ts`: Administra la creación de procesos en Windows mediante Job Objects nativos (`windows-job-runner`), emitiendo recibos transaccionales con checksum (`ProcessSupervisorStartedReceipt`, `ProcessSupervisorFinalReceipt`).
- **`executor/`**:
  - `cli-executor.ts`: Implementación de `AgentExecutor` que invoca CLIs externos bajo supervisión.
  - `profiles/claude-code.ts` y `profiles/codex.ts`: Perfiles con configuración de flags CLI, variables de entorno y mapeo de parámetros.
  - `bounded-output.ts`: Buffer circular en memoria para capturar stdout/stderr sin agotar la RAM ante agentes verbosos.
  - `live-process-registry.ts`: Registro global de PIDs vivos para garantizar la terminación ante abort/cancelación.
  - `status-channel.ts`: Protocolo estructurado de reporte de progreso en tiempo real (`MH_STATUS`).
  - `failure.ts`: Clasificador de fallos de ejecución (auth, quota, timeout, binary_missing, etc.).
- **`validation/`**:
  - `candidate-validator.ts`: Función pura `validateExactCandidate` que ejecuta los pasos de la receta de validación en un sandbox efímero, maneja reintentos, baselines y controles negativos.
  - `evidence-matrix.ts`: Función `buildEvidenceMatrix` que computa el resultado final (`"verified"`, `"unverified"`, `"failed"`) a partir de las obligaciones y observaciones.
  - `test-integrity.ts`: `detectTestIntegrityFindings` y `detectRequiredPublicSurfaceFindings` analizan ASTs TypeScript para detectar manipulación de tests (tests borrados, `.skip`, `.only`, assertions reducidas).
  - `recipe-compiler.ts`: Compila contratos de validación en un programa ejecutable de pasos (`ValidationRecipe`).
  - `baseline.ts`: Compara ejecuciones del candidato contra el commit baseline para aislar fallos preexistentes de regresiones reales.
- **`integration/`**:
  - `manifest.ts`: `IntegrationManifestExecutor` realiza la integración de artefactos hijos en un composito.
  - `operation-journal.ts`: Registro duradero de operaciones de integración para garantizar idempotencia.
  - `pre-merge.ts`: Análisis previo para anticipar conflictos textuales y de interfaces antes del cherry-pick.
  - `syntax-check.ts`: Validación sintáctica estática sobre archivos fusionados.
- **`delivery/`**:
  - `publisher.ts`: `TransactionalDeliveryPublisher` efectúa la publicación final atómica (CAS) contra el branch remoto.
  - `candidate-preparer.ts`: `FinalCandidatePreparer` materializa el candidato final y comprueba que esté respaldado por una matriz de evidencia verificada.
  - `target-cleanliness.ts`: `targetWorkingTreeIsClean` y `userWorkingTreeChanges` verifican el estado del working tree, eximiendo el directorio interno `.manyhands/` y directorios de ruido transitorio de compilación (`DEFAULT_TRANSIENT_EXCLUSIONS`: `.turbo`, `.cache`, `node_modules/.cache`, `.tmp`, `coverage`) mientras garantizan que modificaciones de código de usuario bloqueen la entrega.
- **`scope/`**:
  - `checker.ts`: `ScopeChecker` valida los archivos modificados contra las listas permitidas (`allowed.paths`) y prohibidas (`forbidden.paths`).
  - `glob.ts`: Evaluador determinista de expresiones glob.
- **`v2/`**:
  - `node-executor.ts`: `V2NodeExecutor` coordina el flujo completo de ejecución física de un nodo (hoja o compuesto).
  - `exact-candidate-validator.ts`: Adaptador de validación de candidatos para el flujo V2.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Materialización Exacta por Manifiesto Git (No Whole-Commit Cherry-Pick)

A diferencia de los sistemas tradicionales basados en merge o cherry-pick ciego de ramas Git, ManyHands utiliza `ExactGitManifestMaterializer`:
1. Valida criptográficamente el `manifestDigest` y verifica que el `baseTreeSha` coincida con el árbol del commit base.
2. Crea un índice Git temporal aislado en disco.
3. Carga el árbol base con `git read-tree` y aplica **únicamente** los blobs declarados en las entradas `ChangeSetEntry` mediante `git update-index`.
4. Escribe el árbol resultante con `git write-tree` y comprueba que su SHA coincida exactamente con `resultTreeSha`.
5. Crea un commit synthetic sin disparar hooks ni filtros `smudge`.

### 3.2. Aislamiento de Worktree vs. Sandboxing de Procesos

ManyHands desacopla formalmente las capas de aislamiento:
- **Aislamiento de Worktree**: `WorktreeManager` gestiona directorios efímeros e independientes en el sistema de archivos para cada tarea, evitando bloqueos de índice Git.
- **Aislamiento de Procesos**: `ProcessSupervisor` confina los procesos a Windows Job Objects con límites estrictos de CPU, memoria y terminación en cascada de subprocesos.
- **Broker de Credenciales (`CredentialBroker`)**: Las API keys no se inyectan en el entorno global del host. Se copian a un `HOME` efímero bajo demanda y se eliminan al completarse el intento o ante caídas del daemon.

### 3.3. Matriz de Evidencia Jerárquica y Detección de Manipulación de Tests

La validación de software generado por LLMs introduce riesgos de falsos positivos (agentes que "pasan" los tests debilitándolos o eliminando assertions). ManyHands implementa una doble barrera:

```
                            Candidato Exacto
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
     Ejecución de Receta                     TestIntegrityValidator
    (Tests + Negative Control)             (Análisis de AST TypeScript)
                │                                     │
                │                                     ├── test_removed
                │                                     ├── test_skipped (.skip/.todo)
                │                                     ├── test_only (.only)
                │                                     ├── test_script_weakened
                │                                     └── assertion_removed
                ▼                                     ▼
    ValidationEvidenceObservation[]           TestIntegrityFinding[]
                │                                     │
                └──────────────────┬──────────────────┘
                                   ▼
                         buildEvidenceMatrix()
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                           ▼
            outcome: "verified"          outcome: "failed"
```

- **Controles Negativos (`negativeControl`)**: Ejecuta el test contra la implementación previa para demostrar sensibilidad (el test **debe** fallar ante el código antiguo).
- **`TestIntegrityValidator`**: Utiliza el compilador de TypeScript (`typescript`) para inspeccionar el AST de los archivos de prueba. Detecta si el agente redujo llamadas a `assert()` o `expect()`, si agregó `.skip()`, o si alteró los scripts en `package.json`. Los hallazgos de assertions reducidas sólo pueden ser refutados si existe prueba diferencial completa con controles negativos exitosos.

### 3.4. Publicación Atómica Compare-and-Swap (CAS)

`TransactionalDeliveryPublisher` garantiza que ninguna entrega sobrescriba trabajo concurrente en el repositorio destino:
1. Reclama la intención en el journal con una clave de idempotencia (`idempotencyKey`).
2. Inspecciona el estado del destino (`branch`, `head`, `fingerprint`, `clean`).
3. Comprueba que el `targetHead` remoto no haya avanzado desde que se aprobó la entrega.
4. Aplica el cambio y registra el `TransactionalDeliveryReceipt`.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Clases, Funciones y Schemas

| Símbolo | Tipo | Módulo | Descripción |
|---|---|---|---|
| `V2NodeExecutor` | Clase | `v2/node-executor.ts` | Coordinador de ejecución de nodo (hoja o compuesto) en el flujo físico. |
| `ExecutionBaseBuilder` | Clase | `base/execution-base-builder.ts` | Construye el worktree y materializa artefactos de entrada. |
| `ExactGitManifestMaterializer` | Clase | `git/exact-manifest-materializer.ts` | Materializa manifests sobre el índice de Git con verificación estricta. |
| `GitArtifactBuilder` | Clase | `git/artifact-builder.ts` | Extrae diffs de Git y genera `ChangeSetManifest` y `CandidateTreeManifest`. |
| `ProcessSupervisor` | Clase | `supervisor/process-supervisor.ts` | Supervisión de subprocesos y emisión de recibos duraderos. |
| `CredentialBroker` | Clase | `sandbox/credential-broker.ts` | Gestión y aislamiento de credenciales de LLMs en directorios efímeros. |
| `validateExactCandidate` | Función | `validation/candidate-validator.ts` | Ejecuta la receta de validación sobre el candidato exacto en sandbox. |
| `buildEvidenceMatrix` | Función | `validation/evidence-matrix.ts` | Computa la matriz jerárquica de evidencia y su veredicto. |
| `detectTestIntegrityFindings` | Función | `validation/test-integrity.ts` | Analiza el AST de tests para detectar debilitamiento o manipulaciones. |
| `IntegrationManifestExecutor` | Clase | `integration/manifest.ts` | Integra artefactos hijos en un nodo compuesto. |
| `TransactionalDeliveryPublisher` | Clase | `delivery/publisher.ts` | Publica la entrega final bajo protocolo CAS con idempotencia. |
| `AgentExecutionResultSchema` | Zod Schema | `types.ts` | Resultado detallado de la ejecución de un agente. |
| `WorktreeRecordSchema` | Zod Schema | `types.ts` | Registro del estado de un worktree efímero. |
| `ExecutionConfigSchema` | Zod Schema | `types.ts` | Parámetros de configuración de ejecución (timeouts, concurrencia, presupuestos). |

### 4.2. Ejemplo de Uso: Construcción de Base de Ejecución y Validación

```typescript
import {
  ExecutionBaseBuilder,
  validateExactCandidate,
  buildEvidenceMatrix,
  type ExactCandidateValidationResult
} from "@manyhands/execution-core";
import { SimpleGitRunner } from "@manyhands/execution-core";
import type { ValidationObligation } from "@manyhands/contracts";

// 1. Instanciar SimpleGitRunner y el constructor de bases
const git = new SimpleGitRunner();
const baseBuilder = new ExecutionBaseBuilder({
  git,
  now: () => new Date().toISOString()
});

// 2. Definir las obligaciones de validación
const obligations: ValidationObligation[] = [
  {
    id: "ob-unit-tests",
    criterionId: "crit-1",
    severity: "required",
    acceptableEvidence: ["test_result"],
    baselinePolicy: "not_required",
    negativeControl: "required",
    flakyPolicy: "forbid",
    evidence: {
      kind: "exact_command",
      criterionId: "crit-1",
      references: ["tests/auth.test.ts"]
    }
  }
];

// 3. Evaluar la matriz de evidencia
const matrix = buildEvidenceMatrix({
  obligations,
  evidence: [
    {
      evidenceId: "ev-1",
      obligationId: "ob-unit-tests",
      criterionId: "crit-1",
      kind: "test_result",
      passed: true,
      attempt: 1,
      commandDigest: "sha256:cmd123",
      durationMs: 450,
      references: ["tests/auth.test.ts"],
      negativeControl: {
        evidenceId: "ob-unit-tests:negative-control",
        obligationId: "ob-unit-tests",
        detectedFailure: true,
        outputDigest: "sha256:neg123"
      }
    }
  ]
});

console.log("Resultado de la validación:", matrix.outcome); // "verified"
console.log("Criterios satisfechos:", matrix.criteria.map((c) => ({ id: c.criterionId, status: c.status })));
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan maestro normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Stages 7 a 10):

| Componente | Estado de Rediseño | Observaciones de Transición |
|---|---|---|
| **Git Artifact Builder & Execution Base** | Stage 7 (GA) ✅ | `ExactGitManifestMaterializer` y `GitArtifactBuilder` operativos y validados. |
| **Supervised Leaf & Sandboxing** | Stage 8 (GLeaf) ✅ | `ProcessSupervisor`, `CredentialBroker` y sandboxes con Windows Job Objects activos. |
| **Composite Integration** | Stage 9 (GI) ✅ | `IntegrationManifestExecutor` e `IntegrationOperationJournal` plenamente integrados. |
| **Delivery Publisher** | Stage 10 (GDel) ✅ | `TransactionalDeliveryPublisher` implementa el protocolo CAS e idempotencia. |
| **Transporte de Commits Legacy** | Transicional ⚠️ | `V2NodeExecutor` admite el flag `allowCommitArtifactTransport`. En la ruta canónica pura del daemon, este flag está deshabilitado (`false`), forzando el intercambio exclusivo vía `ArtifactManifest`. |

---

## 6. Comandos de Verificación y Testing

Para compilar y verificar los tipos estáticos de este paquete:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/execution-core typecheck

# Compilación de artefactos de distribución (ESM y CJS con declaraciones DTS)
pnpm --filter @manyhands/execution-core build
```
