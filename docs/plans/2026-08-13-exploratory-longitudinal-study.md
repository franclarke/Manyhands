# Estudio longitudinal exploratorio para la demostración de ManyHands

## Propósito y alcance

Este documento define el estudio que se ejecutará **después de que Stage 11 / GProd
pase**. No es un benchmark amplio ni una prueba causal. Es un estudio de caso
longitudinal, pequeño y visual, pensado para:

- observar cómo ManyHands construye y luego amplía una aplicación comprensible
  para público no técnico;
- conservar evidencia atribuible de cada corrida;
- mostrar en la exposición qué cambió, qué se preservó y qué necesitó reparación;
- describir resultados y limitaciones sin generalizarlos a otros repositorios,
  modelos o clases de tareas.

La exposición está prevista para el **4 de septiembre de 2026**. El estudio se
mantiene deliberadamente acotado para proteger el tiempo de implementación, la
cuota de modelos y el margen de preparación de la presentación.

## Caso de demostración

El target será una aplicación web visual de planificación de viajes. El público
debe poder entenderla sin conocer Git, agentes o arquitectura de software.

Se permite preparar un scaffold técnico fijo y verificado antes de la primera
corrida. Se lo describirá como **funcionalmente vacío**, no como un proyecto
creado desde cero si ya contiene configuración, dependencias o estructura.

Quedan fuera del alcance del target:

- autenticación;
- backend remoto;
- pagos;
- APIs externas;
- colaboración en tiempo real;
- cualquier requisito que haga depender la demostración de credenciales o de
  servicios de terceros.

## Corridas

### Corrida 1 — producto visual inicial

Partiendo del scaffold funcionalmente vacío, construir una experiencia coherente
con, como mínimo:

- dashboard o portada del viaje;
- destinos o paradas;
- itinerario por día;
- tarjetas visuales y jerarquía comprensible;
- comportamiento responsive básico.

### Corrida 2 — incremento sobre una base real

Partiendo exactamente del candidate entregado por la corrida 1:

- agregar presupuesto;
- agregar checklist y progreso;
- agregar persistencia local;
- preservar y volver a verificar el flujo visible de la corrida 1.

### Corrida 3 — opcional y condicionada

Sólo se ejecutará si las dos corridas obligatorias están verdes, queda tiempo
antes del freeze y la reserva de cuota no se compromete. Puede agregar una única
mejora cohesionada, por ejemplo:

- resumen visual;
- filtros;
- importación/exportación local;
- accesibilidad o pulido mobile.

No se usa la tercera corrida para rescatar resultados adversos ni para aumentar
artificialmente el número de casos.

## Protocolo mínimo

Antes de cada corrida se congela:

- prompt exacto;
- base SHA/tree y estado del worktree;
- criterios visibles de aceptación;
- comandos de test y build;
- flujo de browser y capturas requeridas;
- límites de tiempo, costo y reintentos;
- criterio de detención.

Después de cada corrida se conserva:

- candidate SHA/tree y, cuando corresponda, delivery SHA/tree;
- grafo y revisiones relevantes;
- duración, consumo reportado, cantidad de intentos y reparaciones;
- resultados completos de test, typecheck, build y delivery;
- journal, receipts y evidencia de recuperación relevante;
- ejecución Playwright por la ruta productiva y capturas visibles;
- verificación explícita de las capacidades heredadas de la corrida anterior;
- fallos, celdas inconclusas y limitaciones, sin convertirlos en PASS.

La corrida cuenta una sola vez. Un reintento o reparación pertenece a la misma
corrida y debe quedar visible en su historia.

## Lectura de resultados

El análisis será descriptivo. Para cada corrida se responderá:

1. ¿El producto entregado satisface los criterios visibles congelados?
2. ¿El incremento preserva las capacidades anteriores?
3. ¿El grafo y la evidencia permiten explicar el trabajo a una persona no
   técnica?
4. ¿Qué reparaciones, decisiones humanas o limitaciones aparecieron?
5. ¿El candidate mostrado por browser es exactamente el candidate verificado y
   entregado?

Resultados permitidos: `pass`, `fail`, `inconclusive` y `not_run`, siempre con
evidencia. El estudio no pretende demostrar causalidad, superioridad de modelo,
significancia estadística, generalización ni una tasa universal de éxito.

## Relación con la tesis y la evidencia histórica

La serie histórica V2 y sus resultados adversos o inconclusos se preservan como
historia. No se reescriben ni se usan para cerrar gates de la arquitectura actual.
Este estudio es su sucesor post-`GProd` para la demostración y el análisis
exploratorio; no reemplaza retroactivamente sus hipótesis ni sus denominadores.

Las conclusiones de la tesis deberán limitarse a lo observado en estas corridas,
distinguir evidencia del producto de interpretación y declarar las amenazas a la
validez.

## Calendario y presupuesto operativo

Calendario objetivo, sujeto a que cada gate pase sin debilitar sus invariantes:

| Fechas de 2026 | Objetivo |
|---|---|
| 13–16 agosto | Stage 4 / GRepo |
| 16–20 agosto | Stages 5 y 6 |
| 20–24 agosto | Stages 7 y 8 |
| 24–27 agosto | Stages 9 y 10 |
| 27–29 agosto | Stage 11 / GProd y code freeze |
| 29–31 agosto | dos corridas obligatorias; tercera sólo si cumple condiciones |
| 1–3 septiembre | análisis, tesis, diapositivas y ensayo |
| 4 septiembre | exposición |

La cuota se administra por proporciones, no por promesas de tokens absolutos:

| Ventana de cuota | Distribución orientativa |
|---|---|
| 70% disponible antes del 20/8 | Stage 4: 15%; Stage 5: 22%; Stage 6: 10%; inicio de Stage 7: 13%; reserva: 10% |
| 100% posterior al reinicio | Stages 7–8: 20%; Stage 9: 12%; Stage 10: 12%; Stage 11: 12%; estudio: 14%; tesis/presentación: 10%; reserva: 20% |

Son topes de gestión, no objetivos de consumo. Se usa fake/replay hasta el smoke
live explícito de Stage 8; se evita repetir fallos deterministas sin cambiar su
causa; y se reserva la suite completa para gates o cambios de alto riesgo.

## Criterio de salida

El estudio termina cuando existen dos corridas atribuibles con sus oráculos y un
análisis descriptivo honesto. La tercera corrida es prescindible. Si el calendario,
la cuota o un gate se deterioran, se preserva la evidencia disponible y se omite
la celda opcional antes de recortar corrección arquitectónica o tiempo de ensayo.
