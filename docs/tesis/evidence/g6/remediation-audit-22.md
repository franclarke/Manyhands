# Auditoría de remediación 22 — G6 condición B

## Fallo observado

El intento de planificación de `g6-03-T1-B-r1` con run `7093c7f6-33fd-47db-a13c-cd8870b237ae` se detuvo en su única tentativa, antes de producir un plan candidato. El evento `planning.attempt_failed` preservado registra que `codex-windows-sandbox-setup.exe` no pudo iniciarse y devolvió `Acceso denegado (os error 5)`. El evento terminal es `planning.failed` con `maxPlanningAttempts: 1`. No hubo ejecución de leaves, consumo de celda atribuible a un candidato ni reintento de planificación.

El diagnóstico se reprodujo fuera del run: el `codex-windows-sandbox-setup.exe` de la instalación AppX ubicada bajo `C:\Program Files\WindowsApps\OpenAI.Codex_26.727.6591.0_x64__2p2nqsd0c76g0` tampoco pudo iniciarse directamente y devolvió `Acceso denegado`, incluso con un directorio de trabajo distinto. En cambio, la instalación standalone de Codex contiene un helper co-localizado en `C:\Users\franc\.codex\packages\standalone\current\codex-resources\codex-windows-sandbox-setup.exe` y el binario correspondiente en `...\current\bin\codex.exe`.

La diferencia explica por qué el fallo no pertenece al repositorio warehouse ni a la descomposición: el servidor dejaba que `codex` se resolviera por PATH y podía seleccionar la instalación AppX con un helper no ejecutable para este contexto.

## Fix profundo aplicado

Se fijó el servidor de ManyHands a la instalación standalone mediante:

```text
MANYHANDS_CODEX_BIN=C:\Users\franc\.codex\packages\standalone\current\bin\codex.exe
```

El servidor fue reiniciado con ese binario explícito. La selección G6 continúa siendo `codex-cli/gpt-5.4-mini`, con esfuerzo `medium`; no se cambió el sandbox solicitado por el producto, el estímulo, el oráculo ni ningún umbral del protocolo.

## Verificación

- El target `warehouse-g6-04-remediation-22` estaba limpio y en la base congelada `5da60192cc788032c59c7e7be27696ca0e0a30d7` antes del intento.
- `pnpm build` había pasado antes de la planificación.
- El run persistió exactamente una tentativa: `planning.attempt_started` seguido por `planning.attempt_failed` y `planning.failed`.
- Se verificó que el helper standalone puede ser lanzado por el sistema; el helper AppX no puede ser lanzado en este contexto.
- El servidor posterior quedó escuchando en `127.0.0.1:3141` con la configuración de Codex standalone.

## Qué no se concluye

Este intento no evalúa la calidad de la planificación de Codex ni la hipótesis G6: terminó antes de que existiera un plan. Tampoco demuestra todavía que fijar el binario standalone resuelva el problema dentro de una planificación real; esa hipótesis sólo puede verificarse reanudando la serie desde un target limpio y registrando el próximo intento, sin reutilizar este run fallido.
