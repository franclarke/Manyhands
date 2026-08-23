# Review & Adversarial Challenge Report — Milestone 1: Core Domain, Graph & Contracts READMEs

**Fecha**: 2026-08-18  
**Agente Revisor**: Reviewer M1 (`.agents/reviewer_m1_1`)  
**Archivos Evaluados**:
- `packages/contracts/README.md`
- `packages/task-graph/README.md`
- `packages/shared/README.md`

---

## 1. Quality Review

### Review Summary

**Verdict**: **`REQUEST_CHANGES`**

**Resumen Ejecutivo**:
La documentación generada por Worker M1 posee una calidad pedagógica sobresaliente, una estructura modular impecable (cumpliendo las 7 secciones estandarizadas) y una redacción en español natural y precisa, manteniendo nombres técnicos en inglés.
Sin embargo, una inspección adversarial profunda contra el código fuente real en `packages/*/src/` reveló **inconsistencias técnicas críticas en ejemplos de código TypeScript** y **discrepancias en nombres de símbolos y archivos**, lo cual impediría que un desarrollador o agente ejecute los snippets documentados sin obtener errores de runtime/Zod.

---

### Findings

#### [Critical] Finding 1: Ejemplos de Código Rotos en `packages/contracts/README.md`

- **Qué**: Dos ejemplos de código en la sección de "Ejemplos de Uso" fallarán al ejecutarse contra los schemas reales de Zod.
- **Dónde**: `packages/contracts/README.md`, líneas 188-204 (Ejemplo 2: `ScopeContract`) y líneas 208-222 (Ejemplo 3: `InputFingerprint`).
- **Por qué**:
  1. **Ejemplo 2 (`ScopeContractSchema.parse(scopeData)`)**:
     - `ScopeContractSchema` hereda de `ContractIdentityShape`, por lo que exige obligatoriamente los campos `schemaVersion: 2`, `id: string`, `revision: string`, `provenance: "authored" | "compiled" | "legacy_inferred"`, además de `nodeId: string`. Ninguno de estos campos fue provisto en el objeto `scopeData`.
     - `outputRoots` está definido en `scope-contract.ts` como `z.array(OutputRootSchema)` donde `OutputRootSchema` es un string refinado (`RepoRelativePathSchema`). El ejemplo provee un array de objetos `{ path: "...", purpose: "..." }`, lo cual genera un error de validación `ZodError: Expected string, received object`.
  2. **Ejemplo 3 (`buildInputFingerprint(...)`)**:
     - `InputFingerprintMaterialSchema` (en `input-fingerprint.ts`) exige la estructura `{ executionBase: { repositoryViewDigest, treeSha }, consumedArtifactDigests, nodeContractDigest, resourceClaimDigest, contextDigest, executorProfileDigest, sandboxCapabilityDigest }`. El snippet pasa `{ taskContractDigest, baseTreeSha, environmentDigest, toolsetDigest }` que son rechazados por `.strict()`.
     - `buildInputFingerprint` retorna directamente un `string` (el hash digest), no un objeto `{ digest: string }`. Acceder a `fingerprint.digest` retorna `undefined`.
- **Sugerencia**:
  - Ajustar el Ejemplo 2 para que `scopeData` incluya `{ schemaVersion: 2, id: "scope-jwt-1", revision: "1", provenance: "authored", nodeId: "node-leaf-1", allowedPaths: [...], forbiddenPaths: [...], coordinationPaths: [...], outputRoots: ["packages/auth/src/tokens"] }`.
  - Ajustar el Ejemplo 3 para que invoque `buildInputFingerprint` con la estructura real de `InputFingerprintMaterial` y consuma el valor de retorno como `string`.

---

#### [Major] Finding 2: Símbolo Inexistente y Firma Incorrecta en `packages/task-graph/README.md`

- **Qué**: Se cita una función inexistente `computeGraphRevisionTopologicalLevels` y se documenta una firma incompleta para `readGraphRevision`.
- **Dónde**: `packages/task-graph/README.md`, líneas 29, 44, 93, 131, 132.
- **Por qué**:
  1. El archivo `packages/task-graph/src/topological-level.ts` exporta únicamente `computeLegacyGraphRevisionV2TopologicalLevels(graph: LegacyGraphRevisionV2): Record<string, number>`. En el README se cita `computeGraphRevisionTopologicalLevels` con firma `(graph: GraphRevision): Map<string, number>`, la cual no existe en `src/`.
  2. En la tabla de funciones (línea 132), `readGraphRevision` está documentada con firma `(input: unknown): GraphRevisionRead`. En el código real (`src/compatibility-reader.ts`), la función requiere dos parámetros: `readGraphRevision(input: unknown, hasher: DigestHasher): GraphRevisionRead`.
- **Sugerencia**:
  - Renombrar la referencia a `computeLegacyGraphRevisionV2TopologicalLevels` o aclarar que opera sobre `LegacyGraphRevisionV2` con retorno `Record<string, number>`.
  - Actualizar la firma de `readGraphRevision` en la tabla de funciones a `(input: unknown, hasher: DigestHasher): GraphRevisionRead`.

---

#### [Major] Finding 3: Archivo Inexistente `effect-intent.ts` en `packages/contracts/README.md`

- **Qué**: El árbol de archivos y la tabla de módulos listan `effect-intent.ts` como un módulo independiente, indicando que hay 25 módulos cuando el árbol lista 26.
- **Dónde**: `packages/contracts/README.md`, líneas 21, 43, 66.
- **Por qué**: En `packages/contracts/src/`, `EffectIntentSchema`, `EffectIntentMaterialSchema`, `buildEffectIntent` y `validateEffectIntentIdentity` residen dentro de `effect-protocol.ts`. No existe un archivo `src/effect-intent.ts`. El conteo real de archivos en `packages/contracts/src/` es exactamente 25 módulos (sin `effect-intent.ts`).
- **Sugerencia**:
  - Eliminar la línea de `effect-intent.ts` del árbol de directorios de `packages/contracts/README.md`.
  - En la tabla de módulos, atribuir `EffectIntent` y `PhysicalEffectReceipt` a `effect-protocol.ts`.

---

## 2. Adversarial Challenge

### Challenge Summary

**Overall risk assessment**: **MEDIUM**

El riesgo principal es la pérdida de confianza de agentes y desarrolladores que intenten utilizar los READMEs como guías ejecutables ("copy-paste code"), lo que causaría fallos de validación en tiempo de ejecución.

### Challenges

#### Challenge 1: Rigidez de Zod `.strict()` frente a Ejemplos Falsos o Desactualizados
- **Supuesto desafiado**: Los ejemplos ilustrativos pueden simplificar estructuras de datos omitiendo metadatos obligatorios.
- **Escenario de fallo**: Un agente desarrollador que implementa un nuevo componente lee `packages/contracts/README.md`, copia el snippet de `ScopeContractSchema.parse(scopeData)` o `buildInputFingerprint(...)`, y el runtime de ManyHands aborta inmediatamente con un `ZodError` fatal por violación de esquema `.strict()`.
- **Blast Radius**: Bloqueo de nuevos agentes de desarrollo o pruebas de integración automatizadas.
- **Mitigación**: Todo snippet de código en los READMEs debe ser verificado contra los schemas reales de Zod antes de su aprobación.

---

## 3. Verified Claims Matrix

| Afirmación / Símbolo | Paquete / Archivo | Método de Verificación | Resultado |
|---|---|---|---|
| `packages/shared`: Primitivas Zod, `EpistemicAssessment`, `executor-registry`, `node-cli-process` | `packages/shared` | `view_file` en `src/*.ts`, typecheck y tests | **PASS** (100% exacto) |
| `packages/shared`: Mitigación DEP0190 con `ComSpec` y `windowsVerbatimArguments` | `packages/shared/src/node-cli-process.ts` | Inspección de código y tests `execution-core-cli-*.test.ts` | **PASS** |
| `packages/contracts`: 25 módulos TypeScript en `src/` | `packages/contracts/src/` | `list_dir` | **FAIL** (el árbol listaba 26 incluyendo el inexistente `effect-intent.ts`) |
| `packages/contracts`: `computeCanonicalDigest`, `buildGoalContract`, `validateGoalContract` | `packages/contracts/src/` | Inspección de código y tests | **PASS** |
| `packages/contracts`: Snippet `ScopeContract` | `packages/contracts/README.md` | Validación contra `ScopeContractSchema` | **FAIL** (faltan campos de identidad y `outputRoots` tiene tipo incorrecto) |
| `packages/contracts`: Snippet `InputFingerprint` | `packages/contracts/README.md` | Validación contra `InputFingerprintMaterialSchema` | **FAIL** (propiedades incompatibles y tipo de retorno) |
| `packages/task-graph`: `GraphRevisionSchema`, `buildGraphRevision`, `checkResourceAuthority`, `graftSubtree` | `packages/task-graph/src/` | Inspección de código y 17 suites de tests (131 tests) | **PASS** |
| `packages/task-graph`: `computeGraphRevisionTopologicalLevels` | `packages/task-graph/src/topological-level.ts` | `grep_search` en `src/` | **FAIL** (la función real es `computeLegacyGraphRevisionV2TopologicalLevels`) |
| `packages/task-graph`: Firma de `readGraphRevision` | `packages/task-graph/src/compatibility-reader.ts` | Inspección de código | **FAIL** (falta argumento `hasher: DigestHasher`) |
| Typecheck de los 3 paquetes | Monorepo root | `pnpm --filter ... typecheck` | **PASS** (Exit code 0) |
| Build de los 3 paquetes | Monorepo root | `pnpm --filter ... build` | **PASS** (Exit code 0) |
| Tests de contratos y grafos | Monorepo root | `pnpm test ...` (17 suites) | **PASS** (131/131 tests pasan) |

---

## 4. Integrity Violation Check

- **Hardcoded test results embedded in source**: No detectado.
- **Dummy/facade implementations**: No detectado. Los READMEs son documentos reales, completos y exhaustivos.
- **Shortcuts bypassing the task**: No detectado.
- **Fabricated verification outputs**: No detectado.
- **Conclusión de Integridad**: Trabajo honesto y de alto esfuerzo, con defectos de exactitud técnica en snippets y nombres que deben corregirse.

---

## 5. Acciones Requeridas para Aprobación

1. **`packages/contracts/README.md`**:
   - Corregir el árbol de directorios eliminando `effect-intent.ts` (unificar con `effect-protocol.ts`).
   - Corregir el Ejemplo 2 (`ScopeContract`) para que coincida exactamente con `ScopeContractSchema`.
   - Corregir el Ejemplo 3 (`InputFingerprint`) para que coincida con `InputFingerprintMaterialSchema` y `buildInputFingerprint`.
2. **`packages/task-graph/README.md`**:
   - Corregir el nombre de la función en `topological-level.ts` a `computeLegacyGraphRevisionV2TopologicalLevels`.
   - Corregir la firma de `readGraphRevision` en la tabla de funciones incluyendo el parámetro `hasher: DigestHasher`.
