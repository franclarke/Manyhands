# AgentTaskContract e InterfaceContract

**Archivos fuente:** `packages/contracts/src/index.ts`

---

## Qué es

El `AgentTaskContract` es el contrato formal entre el orquestador y un agente LLM. Define con precisión qué debe lograr el agente, qué archivos puede tocar, qué recursos tiene disponibles, y cómo se va a verificar que el trabajo estuvo bien hecho.

---

## Responsabilidad

El contrato existe para que el agente pueda trabajar de forma completamente autónoma sin tener que negociar nada con el sistema durante la ejecución. Toda la información que el agente necesita — objetivo, contexto, scope, criterios de aceptación — está en el contrato. Y toda la información que el orquestador necesita para validar el resultado — qué archivos puede haber cambiado, qué comandos de validación correr — también está en el contrato.

---

## Cómo funciona

### El contrato V1 (planning)

Los campos originales del contrato cubren la parte de planificación:

- **`goal`:** qué debe lograr esta tarea (texto libre, generado por el Decomposer)
- **`title`:** nombre corto de la tarea
- **`prompt`:** instrucciones adicionales de contexto para el agente
- **`acceptanceCriteria`:** lista de criterios verificables. Cada criterio tiene un tipo:
  - `test`: un test que debe pasar
  - `typecheck`: el código debe compilar sin errores de tipos
  - `exports_symbol`: el código debe exportar un símbolo específico
  - `command`: un comando arbitrario que debe retornar exit 0
  - `custom`: criterio de texto libre
- **`expectedOutput`:** los archivos que se esperan cambiar, los símbolos que se esperan producir o consumir
- **`allowedScope`:** paths donde el agente tiene permitido trabajar (globs)
- **`forbiddenPaths`:** paths que el agente jamás debe tocar (globs), independientemente del scope
- **`contextPack`:** snippets de código relevantes, firmas de tipo y convenciones del proyecto que el Decomposer consideró útiles

### La extensión V2 (ejecución)

Cuando el sistema de ejecución real entró en escena, el contrato se extendió con cinco campos opcionales que el orquestador necesita para hacer su trabajo, pero que no existían en el diseño original de planning:

- **`executionScope`:** tres categorías de paths permitidos — `implementationPaths`, `testPaths`, `configPaths` (todos globs). El `ScopeChecker` usa estas categorías para determinar si los archivos que cambió el agente estaban dentro de su scope.
- **`forbiddenPaths` (V2):** la lista de globs siempre prohibidos. Si un archivo matchea este campo, es violación sin importar que también matchee `executionScope`. Deny wins.
- **`leafValidationCommands`:** comandos que el `ValidationRunner` ejecuta inmediatamente después de que el agente termina, antes de que el orquestador haga el commit. Típicamente: `pnpm test --filter <scope>`, `tsc --noEmit`.
- **`parentValidationCommands`:** comandos que el Composer ejecuta después de integrar los hijos de este composite. Típicamente tests de integración que verifican que las costuras entre hojas quedaron correctas.
- **`runValidationCommands`:** comandos que se ejecutan al finalizar el run completo. Para verificar el sistema entero.

Todos estos campos son opcionales para mantener backward compatibility con contratos existentes.

### InterfaceContract: las costuras entre agentes paralelos

El `InterfaceContract` es el tipo nuevo que habilita la colaboración entre hojas que trabajan en paralelo. Cuando el Decomposer descompone un nodo en hijos, produce junto con ellos un `sharedInterface`: las definiciones TypeScript concretas que los hijos deben respetar.

Un `InterfaceContract` tiene:
- **`id`:** nombre estable de la costura (ej. `"TaskStore"`, `"parseExpression"`)
- **`kind`:** si es un `type`, una `function` o un `module`
- **`signature`:** la firma TypeScript real, no solo el nombre — ej. `"type Token = { kind: 'number' | 'op', value: string }"`
- **`description`:** qué hace y qué garantías ofrece
- **`definedAtNodeId`:** qué nodo del DAG definió esta costura (para trazabilidad)

En el contrato de cada hoja se agregan dos campos opcionales:
- **`consumedInterfaces`:** las costuras que *otras hojas* producen y que esta hoja debe respetar. El `FileSystemContextPacker` las inyecta en el prompt.
- **`producedInterfaces`:** las costuras que *esta hoja* debe exponer para sus hermanas.

El mecanismo es simple pero poderoso: dos hojas que trabajan en paralelo no se conocen entre sí, pero ambas reciben la misma definición de la costura que las conecta. Así no pueden diseñar interfaces incompatibles.

---

## Interfaces

**Produce:** el Decomposer genera los contratos y los embebe en las hojas del `TaskGraph`.

**Consumen:** `FileSystemContextPacker` (lee scope y interfaces para armar el prompt), `ScopeChecker` (valida archivos cambiados contra executionScope y forbiddenPaths), `ValidationRunner` (ejecuta leafValidationCommands), `IntegrationAgent` (lee parentValidationCommands y sharedInterfaces para el repair semántico).

---

## Decisiones de diseño

La separación entre campos V1 (planning) y V2 (execution) fue deliberada para mantener backward compatibility cuando la ejecución real entró en escena. Los campos V2 siguen siendo opcionales — un contrato generado solo para revisión humana del plan, sin ejecutar, es válido sin ellos.

El `InterfaceContract` reemplazó los campos decorativos `producedSymbols`/`consumedSymbols` que existían en el diseño original pero nunca se usaban semánticamente. Pasar de listas de nombres a definiciones de firma reales es lo que hace que las costuras sean efectivas: el agente no solo sabe *qué* debe implementar, sino *cómo* debe verse.
