# Integración, reparación y entrega

## Integración bottom-up

Un composite se vuelve ready cuando todos sus child artifacts obligatorios están
fresh y elegibles. El integrator recibe base exacta, manifests hijos y contrato
del composite.

## IntegrationManifest

Registra:

- base commit/tree;
- artifacts/commits solicitados;
- artifacts aplicados, deduplicados u omitidos con razón;
- orden justificado por requirements;
- conflictos y clasificación;
- repair attempt y diff, si existió;
- commit candidato del composite;
- Evidence Matrix del composite.

Un hijo exitoso sin artifact alcanzable es error antes de integrar. Omitirlo sin
razón es imposible de representar como success.

## Clasificación de conflictos

- `textual`: git no puede aplicar cambios;
- `structural`: exports, imports, schemas o archivos se solapan;
- `contract`: implementación viola seam/artifact contract;
- `behavioral`: el árbol aplica pero falla semántica o tests;
- `environment`: la validación no pudo ejecutarse;
- `internal`: corrupción o bug del orquestador.

Environment no se presenta como conflicto de código.

## Repair

Se permite una reparación semántica automática para un fallo integrable. Recibe:

- goal y contrato del composite;
- child goals y manifests;
- diffs y conflicto real;
- seam revisions;
- validation findings.

El repair produce un diff nuevo que el orquestador commitea y valida. Si falla,
se crea una decisión humana con opciones; no se apilan repairs idénticos.

## Conflictos conductuales

Cuando la evidencia no determina una semántica correcta, el usuario decide entre
alternativas con impacto. La resolución puede enmendar contratos y volver stale
artefactos. El conflicto se considera resuelto solo después de revalidar.

## Root y delivery

El root integrator produce el candidato final. Delivery sigue:

1. `prepare`: materializar destino sin publicarlo;
2. `validate`: comprobar tree/commit y Evidence Matrix final;
3. `approve_delivery`: decisión humana sobre el candidato mostrado;
4. `publish`: merge/cherry-pick/branch/PR según adapter;
5. `confirm`: receipt con destino y SHA;
6. `completed`.

Si publish falla, el run queda `failed_delivery`/outcome delivery failed, no
execution failed. Reintentar entrega no reejecuta nodos si el candidato sigue
vigente.
