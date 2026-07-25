# Estabilidad C2

Estado: **pendiente de ejecución**.

## Preflight 2026-07-24

- commit verificado localmente: `cf6db65`;
- suite, typechecks, packages build y web build: PASS;
- marker `adaptive-utility/2.0.0-pilot` en `dist`: presente;
- espacio libre: 8,71 GB;
- mínimo del protocolo: 25 GB;
- disposición: `not_started_insufficient_disk`.

No existen journals de estabilidad C2 en esta carpeta. No se presentan tests,
fixtures ni resultados del C1 histórico como sustituto de runs productivos.

## Reanudación

1. liberar o reubicar almacenamiento sin tocar el target del estudio;
2. comprobar al menos 25 GB libres;
3. repetir build y marker sobre un árbol limpio;
4. ejecutar dos veces el mismo objetivo y commit;
5. verificar cada entrega en clon limpio;
6. copiar journals, snapshots, métricas, receipts y resultados de oráculo;
7. actualizar C2-G2 sólo si ambas ejecuciones son válidas.
