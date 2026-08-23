# Handoff Report — Reviewer M1: Core Domain, Graph & Contracts READMEs

**Fecha**: 2026-08-18  
**Agente**: Reviewer M1 (`.agents/reviewer_m1_1`)  
**Destinatario**: Parent / Orchestrator (`f87b7264-86b3-4d7d-8bb5-aa4e9f59803e`)  
**Tipo de Handoff**: Hard (Revisión completada al 100%)  
**Veredicto**: **`REQUEST_CHANGES`**

---

## 1. Observation

Se realizó una auditoría y revisión adversarial exhaustiva de los tres READMEs entregados para el Milestone 1 frente al código fuente real en TypeScript:

1. **`packages/contracts/README.md`**:
   - *Observación 1.1*: El archivo en la línea 43 lista `├── effect-intent.ts`, sumando 26 archivos en el árbol visual, pero la línea 21 declara 25 módulos. En `packages/contracts/src/`, `EffectIntentSchema` está implementado en `effect-protocol.ts` (línea 38) y el archivo `effect-intent.ts` no existe en el sistema de archivos.
   - *Observación 1.2*: En el Ejemplo 2 (líneas 188-204), `ScopeContractSchema.parse(scopeData)` falla porque `scopeData` carece de los campos obligatorios de `ContractIdentityShape` (`schemaVersion: 2`, `id`, `revision`, `provenance`) y `nodeId`, y proporciona `outputRoots` como array de objetos `{ path, purpose }` cuando el schema espera un array de strings `RepoRelativePathSchema`.
   - *Observación 1.3*: En el Ejemplo 3 (líneas 208-222), `buildInputFingerprint(...)` pasa propiedades (`taskContractDigest`, `baseTreeSha`, `environmentDigest`, `toolsetDigest`) incompatibles con `InputFingerprintMaterialSchema` (definido en `input-fingerprint.ts`), y accede a `.digest` sobre el valor de retorno que es un `string`.

2. **`packages/task-graph/README.md`**:
   - *Observación 2.1*: En las líneas 29, 44, 93 y 131 se cita `computeGraphRevisionTopologicalLevels` con firma `(graph: GraphRevision): Map<string, number>`. El archivo `packages/task-graph/src/topological-level.ts` únicamente exporta `computeLegacyGraphRevisionV2TopologicalLevels(graph: LegacyGraphRevisionV2): Record<string, number>`.
   - *Observación 2.2*: En la línea 132, la tabla documenta `readGraphRevision` con firma `(input: unknown): GraphRevisionRead`, omitiendo el segundo parámetro obligatorio `hasher: DigestHasher` requerido en `src/compatibility-reader.ts:11`.

3. **`packages/shared/README.md`**:
   - *Observación 3.1*: 100% de concordancia. Todos los tipos, constantes (`CLAUDE_CODE_EXECUTOR_ID`, `CODEX_EXECUTOR_ID`, `OPENCODE_EXECUTOR_ID`, `EFFORT_LEVELS`), descriptores, esquemas Zod (`ReasoningEffortSchema`, `EpistemicAssessmentSchema`, `ResourceReferenceSchema`) y funciones de `node-cli-process.ts` coinciden fielmente con el código fuente.

4. **Verificación de Compilación y Tests**:
   - `pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared typecheck` -> Exited with code 0.
   - `pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared build` -> Exited with code 0.
   - `pnpm test ...` sobre 17 suites de tests de contratos y grafos -> 131 de 131 tests pasaron con éxito.

---

## 2. Logic Chain

1. **Premisa 1**: La documentación técnica del monorepo debe ser la fuente autoritativa de verdad para desarrolladores y agentes LLM. Los ejemplos de código deben ser sintáctica y semánticamente válidos.
2. **Premisa 2**: Los schemas de Zod en `packages/contracts` y `packages/task-graph` operan en modo estricto (`.strict()`). Cualquier discrepancia en nombres de campos o tipos de datos genera un fallo en runtime.
3. **Inferencia 1**: Los ejemplos de uso de `ScopeContract` e `InputFingerprint` en `packages/contracts/README.md` son inválidos y romperían la ejecución de cualquier consumidor que los adopte.
4. **Inferencia 2**: La función citada `computeGraphRevisionTopologicalLevels` en `packages/task-graph/README.md` no existe con ese nombre ni con esa firma en el paquete.
5. **Conclusión**: Aunque la estructura, la redacción en español y la profundidad conceptual son sobresalientes, la presencia de snippets no ejecutables y símbolos inexistentes requiere corrección inmediata antes de la aprobación final.

---

## 3. Caveats

- No se encontraron violaciones de integridad ni simulaciones fraudulentas (facade implementations / hardcoded cheats). Worker M1 realizó un trabajo auténtico y de alta calidad técnica que solo requiere ajustes puntuales de precisión.
- No se modificó el código de los READMEs directamente, preservando el rol de Reviewer/Critic sin alterar el producto del Worker.

---

## 4. Conclusion

**Veredicto Final**: **`REQUEST_CHANGES`**

Se requiere que el Worker M1 aplique las siguientes correcciones antes del merge / aprobación del Milestone 1:

1. **En `packages/contracts/README.md`**:
   - Eliminar `effect-intent.ts` del árbol de archivos y tabla (unificando bajo `effect-protocol.ts`).
   - Corregir el Ejemplo 2 (`ScopeContract`) con los campos de `ContractIdentityShape`, `nodeId` y `outputRoots` como `string[]`.
   - Corregir el Ejemplo 3 (`InputFingerprint`) con los campos reales de `InputFingerprintMaterialSchema` y consumir el retorno como `string`.

2. **En `packages/task-graph/README.md`**:
   - Corregir el nombre y firma de `computeLegacyGraphRevisionV2TopologicalLevels`.
   - Añadir el parámetro `hasher: DigestHasher` en la firma de `readGraphRevision`.

---

## 5. Verification Method

Para verificar independientemente estos hallazgos:

1. **Comprobar la ausencia de `effect-intent.ts`**:
   - `ls packages/contracts/src/effect-intent.ts` (retorna ENOENT).
2. **Comprobar el esquema de `ScopeContract` y `OutputRootSchema`**:
   - Inspeccionar `packages/contracts/src/scope-contract.ts` y `packages/contracts/src/contract-identity.ts`.
3. **Comprobar el esquema de `InputFingerprintMaterial`**:
   - Inspeccionar `packages/contracts/src/input-fingerprint.ts`.
4. **Comprobar la función de niveles topológicos y reader**:
   - Inspeccionar `packages/task-graph/src/topological-level.ts` y `packages/task-graph/src/compatibility-reader.ts`.
