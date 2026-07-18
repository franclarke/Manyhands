# Auditorías de transición

Auditoría vigente del camino productivo:

- [`v2-productive-run-audit-2026-07-18.md`](v2-productive-run-audit-2026-07-18.md)

Los audits y ledgers anteriores fueron retirados porque evaluaban una
arquitectura distinta y no deben funcionar como backlog vigente.

La próxima auditoría debe comparar el código contra:

1. [`../DECISIONS.md`](../DECISIONS.md);
2. los contratos de [`../system/`](../system/);
3. la experiencia de [`../design/`](../design/).

## Formato esperado

Cada capacidad se clasificará como:

- `implemented`: comportamiento y tests coinciden;
- `partial`: existe, pero no cumple todo el contrato;
- `missing`: no existe en el camino productivo;
- `incompatible`: la implementación contradice el target;
- `unknown`: falta evidencia y debe investigarse.

Cada finding incluirá evidencia de código/test/persistencia, riesgo de producto,
dependencias y slice de transición sugerido. No se recuperan IDs ni estados de
los ledgers retirados.
