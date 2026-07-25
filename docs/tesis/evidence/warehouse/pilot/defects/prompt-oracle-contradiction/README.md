# Prompt/oracle contradiction in the published probe contract

Clasificación: **defecto del instrumento; reclasifica parcialmente el segundo W1**.

## Observación

Los ocho prompts abrían su sección `## Probe contract` así:

> Campos exactos: `schemaVersion`, `increment`, `scenario`, `stateHash`,
> `capabilities`, `layout` e `inventory`.

Esa lista pone `layout` e `inventory` **al mismo nivel** que los campos de la
envoltura. Dos párrafos más abajo el mismo prompt decía que `capabilities`
contiene `layout: { zones, bins }` e `inventory: { skus, totalUnits }`. El
oráculo verifica `first.capabilities[capability]`, es decir la segunda lectura.

La entrega del segundo W1 (`f49dffa5`) publicó `layout` e `inventory` en el
nivel superior. Se registró como fallo productivo de fidelidad contractual. Con
el prompt a la vista, la entrega siguió la primera frase del contrato que se le
dio: **el estímulo era ambiguo y el agente eligió una de sus dos lecturas.**

El otro hallazgo de ese run —`stateHash` sin el prefijo `sha256:`— no queda
excusado por esta ambigüedad: el formato estaba declarado una sola vez y sin
contradicción. Ese run sigue siendo FAIL legítimo, pero por un motivo y no por
dos.

## Por qué la corrección anterior no alcanzaba

El fix `f5b99f2` hizo que planning preservara verbatim las secciones marcadas
como contrato. Es correcto y se conserva. Pero preservar verbatim un texto que
se contradice a sí mismo propaga la contradicción intacta hasta el executor: el
defecto no estaba en el canal, estaba en el mensaje.

## Causa y corrección TDD

La causa de fondo es que el estímulo publicado y las reglas verificadas eran dos
artefactos escritos a mano por separado, sin ningún vínculo mecánico. Nada podía
detectar que discreparan; el test de assets sólo comprobaba que el prompt
*mencionara* los nombres de las capacidades.

- Rojo: `tests/warehouse-prompt-contract.test.ts` exigió que cada prompt
  publicara un specimen JSON literal, que el oráculo lo aceptara, que ninguna
  capacidad apareciera en el nivel superior y que ningún prompt volviera a
  describir la forma en prosa.
- Verde: `oracles/probe-specimen.mjs` es ahora la única definición de forma,
  mínimos e invariantes. `pin-warehouse-assets.mjs` **renderiza** la sección
  `## Probe contract` de los ocho prompts desde ese módulo antes de calcular los
  hashes, y `oracle-core.mjs` deriva de él sus reglas. El estímulo publicado y
  la regla verificada ya no pueden discrepar porque son la misma fuente.
- `tests/warehouse-oracle-conformance.test.ts` prueba las reglas por mutación:
  85 casos que incluyen exactamente la deformación que produjo este fallo.

## Defectos adyacentes corregidos en el mismo bloque

- **Superficie de comandos no verificada.** Los stubs del seed
  (`node -e "console.log('...ok')"`) salen con código 0, así que el oráculo
  registraba `test:pass` sobre una entrega que no validaba nada — como en el
  primer W1. `checkCommandSurface` lo decide desde `package.json` en
  milisegundos, antes de cualquier install o build.
- **Diagnóstico de a un defecto por run.** El oráculo abortaba en la primera
  violación. Ahora `checkProbeOutput` es total y reporta todas juntas: un run
  quemado entrega la lista completa en vez de revelarlas de a una.
- **Pins no reproducibles.** Con `core.autocrlf=true` un clon limpio reescribía
  los finales de línea de todos los assets direccionados por hash y los nueve
  pins quedaban obsoletos: el instrumento congelado no corría en ninguna máquina
  salvo la que lo produjo. Verificado clonando `HEAD` a un directorio scratch,
  9/9 obsoletos antes y 0 después de `.gitattributes`.
- **Pins editados a mano.** Se movieron a mano tres veces durante el piloto.
  `pin-warehouse-assets.mjs` los regenera desde los bytes que nombran y
  `--check` sirve de gate del freeze.

## Estado

Ninguna entrega previa cambia de veredicto: el segundo W1 sigue sin adoptarse y
el acumulado del piloto sigue en **0/8 incrementos verificados**. Lo que cambia
es la atribución de una de sus dos causas, y que el instrumento ya no puede
volver a producirla.
