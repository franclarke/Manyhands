# Guía Arquitectónica: @manyhands/execution-core

> **Ubicación en el Monorepo**: `packages/execution-core/`  
> **README del Paquete**: [`../../packages/execution-core/README.md`](../../packages/execution-core/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

Mientras que los paquetes de coordinación (`@manyhands/run-coordinator`, `@manyhands/run-engine`) gestionan máquinas de estado y eventos puros, **`@manyhands/execution-core`** asume la responsabilidad operativa y física integral del sistema: interactúa directamente con el sistema de archivos, el almacén de objetos Git, los subprocesos del sistema operativo, los sandboxes y las suites de prueba.

### Problemas Fundamentales que Resuelve

1. **Materialización Exacta por Manifiesto Git (`ExactGitManifestMaterializer`)**: Reconstruye árboles de trabajo Git exactos a partir de manifiestos inmutables (`ChangeSetManifest`), aplicando únicamente los blobs declarados y eliminando el transporte ciego de historiales de commits o invocación de hooks descontrolados.
2. **Aislamiento Ortogonal y Sandboxing de Procesos**: Desacopla formalmente las capas de seguridad: worktrees efímeros en disco, confinamiento de procesos mediante Windows Job Objects nativos (`native/windows-job-runner`), políticas de red y broker de credenciales efímeras (`CredentialBroker`).
3. **Supervisión Confiable y Recibos Transaccionales (`ProcessSupervisor`)**: Administra subprocesos de agentes (Claude Code, OpenAI Codex, Mock), buffers de salida circulares acotados (`BoundedOutputBuffer`), prevención de fugas de PIDs (`LiveProcessRegistry`) y emisión de recibos firmados con checksum.
4. **Matriz de Evidencia Jerárquica y Detección de Manipulación de Tests (`TestIntegrityValidator`)**: Evalúa obligaciones de validación sobre candidatos exactos, ejecutando controles negativos (`negativeControl`) para verificar sensibilidad y análisis estático de AST para neutralizar agentes que intentan "pasar" tests debilitándolos o suprimiendo assertions.
5. **Integración Compuesta con Bitácora Transaccional (`IntegrationManifestExecutor`, `IntegrationOperationJournal`)**: Fusiona resultados de nodos hijos en compositos mediante registros duraderos que aseguran idempotencia y reparación acotada.
6. **Publicación Transaccional Compare-and-Swap (CAS) (`TransactionalDeliveryPublisher`)**: Entrega resultados finales verificados asegurando que el branch destino no haya sufrido modificaciones concurrentes.

---

## 2. Arquitectura Interna y Componentes

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
├── types.ts        # Tipos centrales y Zod Schemas de resultados y configuración
├── errors.ts       # Jerarquía tipada de errores de ejecución
├── pricing.ts      # Estimación y cómputo de costos de tokens por modelo
└── index.ts        # Barrel export unificado
```

### Desglose de Responsabilidades por Submódulo

| Submódulo | Responsabilidad Principal |
|---|---|
| `base/` | Orquesta la adquisición de un workspace limpio y materializa secuencialmente los artefactos requeridos para construir la base de ejecución inmutable del intento. |
| `git/` | Aplica blobs de manifiesto directamente sobre el índice temporal de Git con `read-tree` y `write-tree` (`ExactGitManifestMaterializer`), construye manifiestos a partir de diffs y mantiene referencias de retención namespaced (`refs/manyhands/runs/...`). |
| `sandbox/` | Administra perfiles de aislamiento (`SandboxCapabilities`), provee espacios de trabajo efímeros y gestiona el ciclo de vida de credenciales intermediadas (`CredentialBroker`). |
| `supervisor/` | Conduce la ejecución de procesos bajo custodia de Windows Job Objects (`ProcessSupervisor`), emitiendo recibos transaccionales `ProcessSupervisorStartedReceipt` y `ProcessSupervisorFinalReceipt`. |
| `executor/` | Invoca binarios CLI externos bajo perfiles tipados, captura stdout/stderr en memoria mediante `BoundedOutputBuffer` y mantiene el registro global de procesos vivos `LiveProcessRegistry`. |
| `validation/` | Ejecuta recetas de validación sobre candidatos exactos (`CandidateValidator`), construye la `EvidenceMatrix`, compara contra baselines y analiza ASTs con `TestIntegrityValidator`. |
| `integration/` | Ejecuta la integración compuesta de artefactos hijos (`IntegrationManifestExecutor`) con registro de operaciones idempotente (`IntegrationOperationJournal`). |
| `delivery/` | Realiza la publicación final atómica (CAS) del candidato verificado contra el branch de destino en Git. |
| `scope/` | Valida que las mutaciones físicas no violen las listas permitidas y prohibidas de `ScopeContract`. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama ilustra el ciclo de vida operativo de un intento de ejecución:

```
               TaskContractBundle + InputFingerprint
                                │
                                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                 1. ExecutionBaseBuilder                   │
  │  • Adquiere workspace efímero limpio                      │
  │  • Materializa baseTreeSha                                │
  │  • ExactGitManifestMaterializer aplica ChangeSets previos │
  └─────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
  ┌───────────────────────────────────────────────────────────┐
  │              2. Sandboxing & CredentialBroker             │
  │  • Materializa API Keys en HOME efímero temporal          │
  │  • Configura variables de entorno aisladas                │
  └─────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
  ┌───────────────────────────────────────────────────────────┐
  │         3. ProcessSupervisor (windows-job-runner)         │
  │  • Lanza proceso suspendido en Job Object anidado         │
  │  • Emite started.json con start-ticks del kernel          │
  │  • Reanuda hilo y supervisa stdout con BoundedOutputBuffer│
  │  • Al concluir: Reaping de procesos hijos + final.json    │
  └─────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                   4. CandidateValidator                   │
  │  • Inspecciona diff de Git y valida ScopeChecker          │
  │  • Ejecuta ValidationRecipe (Tests + Negative Controls)   │
  │  • TestIntegrityValidator analiza AST de pruebas          │
  │  • buildEvidenceMatrix() consolida veredicto de calidad   │
  └─────────────────────────────┬─────────────────────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
       [Evidencia Verificada]        [Fallo o Manipulación]
                 │                             │
                 ▼                             ▼
     Construye ChangeSetManifest      Emite RecoveryDiagnostic
     y adopta artefacto en Git        para enrutamiento causal
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Interfaces y Clases Principales

| Símbolo | Tipo | Propósito |
|---|---|---|
| `ExecutionBaseBuilder` | Clase | Materializa la base de trabajo Git limpia aplicando la clausura de artefactos requeridos. |
| `ExactGitManifestMaterializer` | Clase | Aplica blobs de `ChangeSetManifest` sobre el índice de Git mediante `read-tree` y `write-tree`. |
| `ProcessSupervisor` | Clase | Administra la custodia de procesos mediante Job Objects nativos y emite recibos de ejecución. |
| `CredentialBroker` | Clase | Provee credenciales efímeras en un directorio seguro con purga garantizada tras la salida. |
| `CandidateValidator` | Función | `validateExactCandidate`: Ejecuta la receta de validación sobre el candidato exacto. |
| `TestIntegrityValidator` | Módulo | `detectTestIntegrityFindings`: Analiza ASTs de TypeScript para detectar tests borrados o assertions reducidas. |
| `buildEvidenceMatrix` | Función | Consolida observaciones de validación en una matriz con veredicto `"verified"` o `"failed"`. |
| `IntegrationManifestExecutor` | Clase | Ejecuta la fusión de artefactos hijos en un nodo compuesto con bitácora transaccional. |
| `TransactionalDeliveryPublisher` | Clase | Publica atómicamente (CAS) el candidato final verificado en el branch Git destino. |
| `targetWorkingTreeIsClean` | Función | Valida la limpieza del working tree ignorando `.manyhands/` y ruido transitorio (`DEFAULT_TRANSIENT_EXCLUSIONS`). |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Materialización Exacta por Manifiesto Git (No Whole-Commit Cherry-Pick)
A diferencia de los sistemas basados en merge o cherry-pick ciego de ramas Git, ManyHands utiliza `ExactGitManifestMaterializer`:
1. Valida criptográficamente el `manifestDigest` y verifica que el `baseTreeSha` coincida con el árbol del commit base.
2. Crea un índice Git temporal aislado en disco.
3. Carga el árbol base con `git read-tree` y aplica **únicamente** los blobs declarados en las entradas `ChangeSetEntry` mediante `git update-index`.
4. Escribe el árbol resultante con `git write-tree` y comprueba que su SHA coincida exactamente con `resultTreeSha`.
5. Crea un commit sintético sin disparar hooks ni filtros `smudge`.

### 2. Aislamiento Ortogonal: Worktrees, Procesos y Credenciales
ManyHands desacopla formalmente las tres capas de aislamiento:
- **Aislamiento de Worktree**: `WorktreeManager` gestiona directorios efímeros e independientes en el sistema de archivos para cada tarea, evitando bloqueos de índice Git.
- **Aislamiento de Procesos**: `ProcessSupervisor` confina los procesos a Windows Job Objects con límites de CPU, memoria y terminación en cascada de subprocesos.
- **Broker de Credenciales (`CredentialBroker`)**: Las API keys no se inyectan en el entorno global del host. Se copian a un `HOME` efímero bajo demanda y se eliminan al completarse el intento o ante caídas del daemon.

### 3. Matriz de Evidencia Jerárquica y Detección de Manipulación de Tests
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
- **`TestIntegrityValidator`**: Utiliza el compilador de TypeScript para inspeccionar el AST de los archivos de prueba. Detecta si el agente redujo llamadas a `assert()` o `expect()`, si agregó `.skip()`, o si alteró los scripts en `package.json`.

### 4. Publicación Atómica Compare-and-Swap (CAS)
`TransactionalDeliveryPublisher` garantiza que ninguna entrega sobrescriba trabajo concurrente en el repositorio destino:
1. Reclama la intención en el journal con una clave de idempotencia (`idempotencyKey`).
2. Verifica que el branch destino no contenga cambios sin trackear o ramas desincronizadas (`TargetCleanlinessValidator`).
3. Realiza la actualización condicional de la referencia Git (`update-ref`) comprobando que el commit previo coincida exactamente con la preimagen observada al inicio de la corrida.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Materialización y Validación (Stage 7 / GA)**: Cerrado y certificado con matriz de 48 tests de artefactos y 78 tests de validación exacta en `docs/audits/stage-7/`.
2. **Ejecución de Nodos Hoja (Stage 8 / GLeaf)**: Implementado con soporte para sandbox y agentes CLI en `docs/audits/stage-8/`.
3. **Integración Compuesta (Stage 9 / GI)** y **Entrega Transaccional (Stage 10 / GDel)**: Implementados con matrices de verificación de no-regresión y transacciones CAS en `docs/audits/stage-9/` y `docs/audits/stage-10/`.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/execution-core/README.md`](../../packages/execution-core/README.md)
- **Módulos Relacionados**:
  - [`contracts.md`](./contracts.md): Definición de `ArtifactManifest`, `ValidationContract` y `ScopeContract`.
  - [`windows-job-runner.md`](./windows-job-runner.md): Custodio nativo Win32 consumido por `ProcessSupervisor`.
  - [`windows-ipc-acl.md`](./windows-ipc-acl.md): Guardián nativo de DACLs y Named Pipes seguros.
  - [`run-engine.md`](./run-engine.md): Despacho de intenciones de efectos físicos hacia adaptadores de ejecución.
  - [`run-coordinator.md`](./run-coordinator.md): Registro de matrices de evidencia y artefactos adoptados.
- **Documentación Central**: [`../README.md`](../README.md)
