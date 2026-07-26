# W2 entregó un candidato no instalable con lockfile congelado

Clasificación: **defecto de entrega reproducible del candidato W2**, observado
por el oráculo externo después de que la validación interna lo declarara
verificado.

## Observación

El run `6bd9c507-3e61-45d9-b3ee-a284632688b8` de `series-15` ejecutó W2 como una
sola hoja, creó el candidato `38b511817b0ab0a8df1855d28f0e9455f5dac0fd`, completó
su matriz de validación interna y publicó la entrega. El journal conservado en
`../../series-15/runs/W2/run.events.v2.jsonl` registra, en ese orden,
`attempt.candidate_created`, `validation.completed`, `final_candidate.verified`
y `delivery.published`.

El oráculo se ejecutó desde un clon independiente de esa entrega. Su resultado
es `fail` en `../../series-15/runs/W2/oracle-result.json`. Esa primera captura
no contiene texto de error: el lanzador prioriza `error.stderr` aun cuando es la
cadena vacía del proceso hijo. Por eso la causa no se infiere de ese campo.

## Corrección de la instrumentación

Rojo primero: `warehouse-oracle-runner.test.ts` reprodujo un fallo de gestor de
paquetes con `stderr` vacío y `stdout` no vacío; el formateador no existía, por
lo que la regresión falló al cargarlo. Verde: el lanzador ahora conserva el
primer diagnóstico no vacío en el orden `stderr`, `stdout`, `message`. Esto no
altera el veredicto del oráculo ni convierte este W2 en PASS; sólo hace que una
repetición preserve `ERR_PNPM_OUTDATED_LOCKFILE` en el artefacto crudo.

La reproducción diagnóstica posterior, sobre el commit entregado y sin cambiar
ningún archivo versionado, ejecutó exactamente la instalación que exige el
oráculo:

```text
pnpm install --frozen-lockfile
ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is not up to date with package.json
```

El parche del candidato modifica `package.json` y no `pnpm-lock.yaml`. Por lo
tanto, la entrega no es reproducible desde un checkout limpio y no puede avanzar
la base verificada de W1 a W3.

## Relación con la política C

La selección de granularidad quedó registrada junto con su árbol candidato en el
journal de W2. El run eligió una única hoja y, pese a eso, produjo el candidato
en aproximadamente doce minutos. El fallo externo observado aquí es posterior
a esa ejecución: la coherencia entre manifiesto y lockfile. No se cambió ningún
umbral, peso ni cota de la política C.

## Qué no se concluye

No se concluye que el contenido funcional de la interfaz W2 o de su sonda sea
correcto para el oráculo externo: éste no llegó a ejecutar sus gates después de
rechazar la instalación congelada. Tampoco se concluye que una descomposición
hubiera sido mejor, ni que la política C haya causado el fallo. Sólo se concluye
que este candidato específico no constituye una entrega reproducible y, por
ello, no es una base admisible para W3.
