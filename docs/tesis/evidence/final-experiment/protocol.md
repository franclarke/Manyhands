# Experimento final de tesis — protocolo operativo

Este protocolo implementa la pre-registración congelada de `preregistration.md`.
Ningún prompt, target, oráculo, umbral, modelo, orden o límite se modifica
durante la serie.

## Preparación

1. Ejecutar `node preflight.mjs` y exigir `template: FAIL` y `reference: PASS`.
2. Ejecutar `pnpm build`, los typechecks de paquetes y el typecheck web.
3. Crear cuatro copias limpias del target en `C:/mh-final-thesis/`.
4. En cada copia, inicializar Git, registrar el commit base y verificar que el
   árbol esté limpio.
5. Crear `.scratch/final-thesis-experiment/freeze.json` con todos los hashes.

## Rehearsal

Ejecutar una sola celda descartable para verificar que el servidor, el workspace
y el recorrido de aprobación responden. Sus artefactos se conservan, pero el
rehearsal no aparece en el denominador de H-F1 ni H-F2.

## Ejecución de celdas

Para cada celda, en el orden registrado:

1. Ejecutar `pnpm build`.
2. Crear el run en el workspace de esa celda con el prompt exacto, condición C
   y selecciones `gpt-5.4-mini/medium`.
3. Esperar la decisión de plan; aprobarla sólo si no hay seams `logical` para
   `api`, `type` o `command`, y si los critics no reportan findings bloqueantes.
4. Ejecutar sin retry automático. Sólo se permite la reparación ya declarada en
   el scope de la celda.
5. Aprobar delivery sólo para el candidate exacto que pasó la matriz de
   evidencias.
6. Ejecutar el oráculo desde un checkout limpio del candidate SHA.
7. Persistir resultado y apagar el run/server antes de abrir la siguiente
   celda.

Una celda que falla conserva su journal y se registra como adversa. No se
reemplaza por un retry. Si se descubre un defecto de producto o protocolo, se
detiene la serie, se corrige con TDD, se crea un nuevo freeze y se reinicia una
nueva serie identificada; los artefactos de la serie fallida no se borran.

## Veredictos

`PASS` exige 4/4 celdas entregadas y 4/4 oráculos PASS, además de los cuatro
patrones estructurales de H-F2: dos raíces multi-capa con al menos tres hojas y
dos raíces cohesivas con una única hoja bajo la envoltura. Cualquier otro resultado es `FAIL` o
`INCONCLUSIVE` según la regla registrada; nunca se redondea ni se imputan celdas
faltantes.

## Cierre

Después de evaluar `S-C-r2`, detener el servidor y comprobar que no queda ningún
listener de ManyHands. Derivar `FINAL-REPORT.md` únicamente desde los artefactos
de `.scratch/final-thesis-experiment/` y adjuntar el hash del freeze.

### Enmienda posterior a V1

V1 se detuvo en M-C-r1. La causa no fue una hipotesis sobre el cambio: las
tres hojas fueron verificadas, pero el control negativo del root no detecto una
regresion porque el comando `test/baseline.test.mjs` no importaba los tests
autores en subdirectorios. El fixture se corrigio para que el entry point del
baseline importe recursivamente esos tests; `preflight.mjs` ahora comprueba que
un test de la nueva superficie falla contra el baseline. La correccion cambia
la identidad del template, por lo que V1 queda solo como adversa y V2 requiere
un freeze completo independiente.
