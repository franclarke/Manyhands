# Harness histórico de Stage 3

Estos scripts se conservaron para reproducir y normalizar parte de la evidencia
usada durante la evaluación de Stage 3. Incluyen arranque y reinicio de daemon y
web, interacción browser/cancel y normalización de resultados.

El harness es histórico: contiene supuestos de host, rutas y puertos fijos que
pueden no existir en otra máquina ni coincidir con la arquitectura actual.
Antes de ejecutarlo se deben revisar y adaptar explícitamente esos valores, los
entrypoints y el destino de la evidencia. No debe ejecutarse como un smoke test
genérico sobre un entorno activo.

Los scripts ayudan a reproducir evidencia, pero **no son código de producto** y
su mera presencia no demuestra que Stage 3 esté cerrado. La validez de una
afirmación depende del candidato exacto, los resultados capturados y el gate
definido por el plan canónico. Los cuatro bundles locales asociados se
excluyeron del archivo por ser redundantes y host-specific.
