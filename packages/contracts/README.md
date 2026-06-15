# @manyhands/contracts

> El contrato entre el orquestador y cada agente, y las interfaces compartidas (las "costuras") entre tareas hermanas.

## Rol en el pipeline

Modelo. Define el "qué tiene que hacer y qué puede tocar" de cada hoja, y el acuerdo que permite que el trabajo paralelo recomponga.

## Conceptos clave

- **`AgentTaskContract`.** Todo lo que una hoja necesita para ejecutarse de forma aislada y verificable: `objective`, `ContextPack`, scope permitido/prohibido, `ExecutionScope` (`implementationPaths` / `testPaths` / `configPaths`), criterios de aceptación, comandos de validación, `expectedOutput` (símbolos producidos/consumidos) y límites de costo/tiempo.
- **`InterfaceContract`.** La costura entre hermanos: un `id` estable, su `kind` (`type` / `function` / `module`) y la **firma real** (no solo el nombre). Las hojas declaran qué interfaces `consumen` y `producen` — esto es lo que vuelve seguro el paralelismo y posible la composición.
- **Seguridad de comandos.** `validationCommandSafetyIssues` aplica una whitelist de charset a los comandos de validación (que vienen del LLM) antes de ejecutarlos (D13).

## API pública

`AgentTaskContractSchema` · `InterfaceContractSchema` · `ExecutionScopeSchema` · `AgentRunResult` · `ValidationResult` · `validateAgentTaskContract` · `validationCommandSafetyIssues`

## Dependencias

`@manyhands/shared`. **Más:** [`docs/system/02-contracts.md`](../../docs/system/02-contracts.md).
