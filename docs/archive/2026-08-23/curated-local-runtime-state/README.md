# Estado runtime local curado

Esta carpeta conserva una selección por **allowlist** de estado local que puede
ayudar a estudiar persistencia, recuperación y diagnóstico:

- inputs y receipts de efectos;
- eventos, fences y traces de runs seleccionados;
- operaciones de integración y resultados transicionales;
- metadatos históricos de procesos y locks sin capacidad operativa.

No es una copia íntegra de `.manyhands/` ni un respaldo de configuración. Se
excluyeron credenciales, tokens, autenticación, Codex homes,
`credential-broker/`, `installation/ipc-capability`, `request.bin` y otros
artefactos que pudieran otorgar acceso o reconstituir una sesión privilegiada.

Este material no es necesariamente final, completo ni atribuible al candidato
del experimento Viaje en Familia. Algunos registros provienen de ejecuciones
anteriores o fallidas y pueden contener rutas locales ya inexistentes. Úsese
como evidencia forense contextual; para afirmaciones sobre el experimento final
deben consultarse su identidad exacta y su evidencia bajo
[`../../../tesis/evidence/viaje-en-familia/`](../../../tesis/evidence/viaje-en-familia/).
