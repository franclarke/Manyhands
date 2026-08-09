# Informe final del experimento de tesis V2

Fecha de cierre: 2026-08-09
Freeze: [`freeze.json`](freeze.json)
Estado: **PASS** bajo el protocolo congelado.

## Alcance que se evalúa

V2 es la única serie que se usa como evidencia positiva central para la
entrega experimental. Evalúa dos proposiciones acotadas sobre un target Node
ESM pequeño (domain → application → API), con condición C, dos repeticiones por
tarea y un oráculo externo ejecutado sobre el commit candidato exacto:

- **H-F1:** cada celda llega a `completed` y `delivered`, publica un SHA no vacío
  y ese SHA pasa el oráculo.
- **H-F2:** la tarea multi-capa produce una raíz composite con tres hojas; la
  tarea cohesiva produce una envoltura de raíz con una sola hoja ejecutable.

No hay control A/B. Por lo tanto, V2 no estima superioridad, causalidad,
optimalidad, escalabilidad ni generalización estadística.

## Freeze y custodia

| Elemento | Valor |
|---|---|
| Commit de ManyHands | `35be5a92126a10f2bde1777a645f805c68e16960` |
| Modelo | Codex `gpt-5.4-mini`, esfuerzo `medium` |
| Uso del modelo | planning, execution y repair |
| Política | `adaptive-utility/3.1.0-pilot` |
| Intentos de planning | 1 |
| Retry automático | 0 |
| Scope | estricto |
| Oráculo SHA-256 | `deacfeb9204c8c21d53cfd97d59fc50a9cd214e15f523220b06a312c81d576c3` |
| Targets | `C:/mh-final-thesis-v2/<celda>` |

El protocolo original nombraba Claude. El freeze V2 documenta la enmienda
solicitada: todas las celdas usan Codex `gpt-5.4-mini` con la misma configuración.
Se ejecutó `pnpm build` antes de cada run. El rehearsal se ejecutó antes de las
celdas y queda excluido del denominador.

## Resultados por celda

| Celda | Run | Base SHA | Candidate SHA | Lifecycle | Tests target | Oráculo | Forma observada |
|---|---|---|---|---|---:|---|---|
| `M-C-r1` | `21f2aebf-9218-4c2e-9e96-b8b60b86fc59` | `bd288be828f581b96add1bcab3230fa84b2fff25` | `6204eeb8b416bda97c9a97d9a82f667726bf0022` | completed, delivered | PASS | PASS | profundidad 1; 3 hojas; branching 3 |
| `M-C-r2` | `99c0c50f-8e76-49ef-8bd4-bb020b1240b9` | `790690b6ac57194ed0c08e8f17f4c275bab5f84a` | `73c6b35a5849a2514513fd4bf44139dd91f6537f` | completed, delivered | PASS | PASS | profundidad 1; 3 hojas; branching 3 |
| `S-C-r1` | `a74c6959-8981-41b7-9341-899fca9a504e` | `790690b6ac57194ed0c08e8f17f4c275bab5f84a` | `e4caca0b7df98367bb998cb6f40ba95de0b93033` | completed, delivered | PASS | PASS | profundidad 1; 1 hoja; branching 1 |
| `S-C-r2` | `d611c700-b392-41d0-88ae-39ebead48119` | `7e1e626473897aaf46c0909ff899ed924d7aa2f3` | `eb3631af68bc1add42d60aa051cf603ed3be7218` | completed, delivered | PASS | PASS | profundidad 1; 1 hoja; branching 1 |

Los journals, snapshots, métricas, fences y metadatos de cada run están en
[`runs/`](runs/). Los resultados
del oráculo están resumidos en
[`oracle-results.json`](oracle-results.json).
La inspección externa se hizo desde checkouts limpios, sin leer prompts ni
journals de ManyHands.

El rehearsal (`062e496e-572f-48e8-843a-31542082c6a9`) también pasó, pero no
cuenta como celda. El preflight exigió que el template sin cambios fallara, que
las dos referencias pasaran y que un test inyectado hiciera fallar el comando
de baseline: [`preflight-result.json`](preflight-result.json).

## Veredicto

**H-F1: PASS (4/4).** Las cuatro celdas llegaron a `completed` y `delivered`,
cada una produjo un candidato no vacío y las cuatro evaluaciones del oráculo
pasaron sobre esos SHAs exactos.

**H-F2: PASS (4/4).** Las dos celdas M produjeron una raíz composite con tres
hojas; las dos celdas S produjeron la envoltura de raíz registrada con una sola
hoja ejecutable. La envoltura no se cuenta como una segunda unidad semántica.

## Resultado adverso separado

La serie V1 no se combina con V2. Su primera celda (`d6676e86-4778-4120-8479-804f93dfac25`)
generó hojas verdes, pero falló el negative control del root porque
`test/baseline.test.mjs` no importaba tests ubicados en subdirectorios. El
control no podía demostrar sensibilidad y la celda se detuvo. El fixture fue
corregido, el preflight pasó y se abrió un freeze V2 nuevo. El registro completo
está en [`adverse-V1-M-C-r1.json`](adverse-V1-M-C-r1.json).

## Qué permite concluir

En este target, bajo esta versión, modelo, política, límites y protocolo,
ManyHands demostró un recorrido reproducible de planificación semántica,
ejecución aislada, integración, validación externa del commit exacto y entrega.
También mostró las dos formas de topología pre-registradas para las tareas M y S.

Esta conclusión es de viabilidad y trazabilidad end-to-end en un alcance
controlado. No es evidencia de que C sea mejor que no dividir, de que la
política sea óptima, de que el sistema escale, ni de que el resultado se
generalice a Warehouse, otros repositorios, modelos o lenguajes.

## Qué queda fuera del argumento positivo

Warehouse conserva el resultado histórico `1/8`; G5 quedó falsado en su
hipótesis comparativa, G6 inconcluso y G7 sin candidatos. SP2 fue un piloto
previo no combinable. Esos artefactos permanecen disponibles como antecedentes
adversos o formativos, pero no se suman a V2 ni se usan para completar una
cadena que no se completó.

## Reproducibilidad

1. Verificar el commit de ManyHands, el hash del oráculo y los hashes del
   template en `freeze.json`.
2. Consultar el journal y el snapshot de cada celda bajo `runs/<celda>/`.
3. Re-ejecutar el oráculo en un checkout limpio de cada candidate SHA.
4. No abrir otra celda ni modificar el freeze: el servidor ya fue detenido y el
   puerto `3200` quedó sin listener al cerrar `S-C-r2`.
