# Checklist de evidencia técnica

Este documento se completará durante la auditoría de transición. Una afirmación
solo puede marcarse verificada con links a código, tests y, cuando corresponda,
un run persistido.

| Afirmación objetivo | Evidencia requerida | Estado inicial |
|---|---|---|
| El planner usa repository grounding versionado | código + test de commit freshness | por auditar |
| Planner y Graph Compiler están separados | tipos, límites y tests independientes | por auditar |
| Relaciones tipadas gobiernan readiness | schema + scheduler tests | por auditar |
| Consumers reciben artifacts requeridos | execution base manifest + integración | por auditar |
| Attempts usan InputFingerprint | persistencia + stale regression | por auditar |
| Decisions bloquean solo alcance afectado | scheduler + UI + run event test | por auditar |
| Retry depende de causa | classifier + policy tests | por auditar |
| Validación produce Evidence Matrix | schema + checks sobre commit exacto | por auditar |
| Integración registra todos los child artifacts | manifest + missing child test | por auditar |
| Delivery publica el candidato validado | tree/commit equality test | por auditar |
| Cancelación rechaza resultados tardíos | fencing/process integration test | por auditar |
| Canvas no se recentra por eventos | component regression + browser smoke | por auditar |
| Proto y live comparten reducer | imports/tests de contrato | por auditar |

No se trasladan veredictos de auditorías anteriores. Pueden servir como pistas al
investigar, pero no como evidencia vigente.
