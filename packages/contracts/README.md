# @manyhands/contracts

Schemas actuales para tareas de agentes, execution scope, interfaces y
resultados de validación.

## Dirección objetivo

El package debe expresar obligaciones versionadas:

- `TaskContract` con goal y acceptance criteria;
- `ScopeContract`;
- `SeamContract` con semántica, producer y consumers;
- `ArtifactContract`;
- `ValidationContract` separado de recipes ejecutables.

Los tipos actuales `AgentTaskContract` e `InterfaceContract` son el punto de
partida, no necesariamente la forma final. Los comandos del LLM no se convierten
en evidencia confiable solo por pasar una whitelist.

La validación de frontera debe rechazar paths inseguros, producers ausentes,
revisions incompatibles y criteria sin forma de evidencia.

Contrato objetivo: [`docs/system/02-contracts.md`](../../docs/system/02-contracts.md).
