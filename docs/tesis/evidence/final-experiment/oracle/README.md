# Oráculo externo del experimento final

`evaluator.mjs` vive fuera del target y no se copia al repositorio de la celda.
Recibe `--task M` o `--task S`, importa únicamente las superficies públicas del
target y falla si la implementación no satisface el contrato completo.

Antes del freeze se ejecuta sobre el template intacto y sobre dos soluciones de
referencia desechables. El primer caso debe fallar; los segundos deben pasar.
