# Experimento final: Viaje en Familia

Estado: `frozen`, pendiente de preflight y ejecución.

Fecha de congelación: 2026-08-20.

Este documento reemplaza la propuesta de dominio anterior para el experimento
de jerarquía profunda. El único target del experimento final es **Viaje en
Familia**.

## Pregunta experimental

¿Puede ManyHands planificar, ejecutar, integrar, verificar y entregar una
aplicación web local comprensible para público no técnico mediante una jerarquía
útil de tres niveles, con trabajo paralelo real e integraciones intermedias?

El tamaño del grafo no es una métrica de corrección. La topología se acepta sólo
cuando cada corte representa una responsabilidad de producto cohesiva y
verificable por separado.

## Configuración congelada

| Campo | Valor |
|---|---|
| Aplicación | `Viaje en Familia` |
| Planning | `claude-code-cli/sonnet` |
| Execution y repair | `codex-cli/gpt-5.4-mini`, effort `medium` |
| Granularidad | `automatica` |
| Autonomía | `autonomous` |
| Runtime del target | Node.js 22+, HTML, CSS y JavaScript ESM sin dependencias externas |
| Test del target | `npm test` -> `node --test` |
| Servicios externos | Ninguno |

Claude Sonnet se reserva para la única operación de planificación, donde un
plan inválido desperdiciaría todos los intentos posteriores. GPT-5.4 Mini se usa
en las múltiples ejecuciones e integraciones para limitar el costo total.

## Aislamiento de intentos

Cada intento usa identidades físicas nuevas:

- raíz temporal: `C:\mh-exp\viaje-familia`;
- repositorio: `C:\mh-exp\viaje-familia\attempt-NNN\repo`;
- workspace UI: `Viaje Familia ANNN`;
- state root del daemon: `C:\mh-exp\viaje-familia\attempt-NNN\daemon-state`;
- evidencia diagnóstica compacta:
  `C:\mh-exp\viaje-familia-evidence\attempt-NNN`.

Las rutas se resuelven y verifican antes de crearlas o eliminarlas. No se usa
`%TEMP%`. Un intento nunca reutiliza el repositorio, workspace, state root o
identidad Git física de otro intento.

## Scaffold funcionalmente vacío

Antes de crear el workspace, el repositorio contiene únicamente infraestructura
neutral:

- `README.md` que identifica el experimento y no implementa producto;
- `.gitignore`;
- `package.json` privado, ESM, con `test: node --test` y `start: node server.mjs`;
- `server.mjs`, servidor estático Node sin estado ni lógica de viaje;
- un baseline test que sólo prueba que el scaffold es ejecutable.

La carpeta todavía no es un repositorio. Al crear el workspace desde la UI,
ManyHands inicializa Git y confirma todo el scaffold en un commit inicial
limpio. No contiene pantallas, modelos de viaje ni criterios ya resueltos.

## Prompt exacto del run

```text
Construí una aplicación web local llamada "Viaje en Familia" para que una
familia pueda organizar y recordar un viaje sin registrarse ni depender de
Internet. La aplicación debe ser visual, clara para una persona no técnica,
responsive y utilizable con teclado.

Usá sólo Node.js, HTML, CSS y JavaScript ESM disponibles en este repositorio. No
agregues dependencias, backend remoto, autenticación, pagos, mapas o APIs
externas. `npm start` debe iniciar la aplicación y `npm test` debe ejecutar todas
las pruebas con `node --test`.

El producto tiene tres áreas cohesivas. Cada área debe poder construirse y
probarse por partes, y luego demostrar con una prueba de integración propia que
sus partes funcionan juntas:

1. Ruta e itinerario
   - Destinos y paradas: crear, editar, eliminar y reordenar paradas con nombre,
     fechas y una breve descripción.
   - Agenda diaria: asociar actividades a un día y una parada, con horario y
     estado pendiente/completada.
   - Exploración: buscar y filtrar paradas o actividades sin perder el orden del
     itinerario.

2. Organización
   - Presupuesto: definir presupuesto total, cargar gastos por categoría y
     mostrar gastado y disponible con estados visuales comprensibles.
   - Checklist de equipaje: agregar, completar, filtrar y ver el progreso total.

3. Recuerdos
   - Notas: guardar notas breves asociadas a un día o una parada.
   - Favoritos: marcar lugares o actividades favoritas y verlos juntos.

La aplicación completa debe integrar las tres áreas en un dashboard con el
nombre y las fechas del viaje, próximos eventos, resumen de presupuesto,
progreso del equipaje y recuerdos destacados. Todos los datos deben persistir
en localStorage y sobrevivir una recarga. Incluí estados vacíos, validaciones
comprensibles, foco visible, contraste suficiente y una presentación cuidada en
desktop y mobile.

Organizá el código por responsabilidades de forma que las partes independientes
no necesiten escribir los mismos archivos. Cada parte debe incluir pruebas de su
comportamiento observable; cada área debe incluir su integración; el producto
completo debe incluir un test end-to-end de lógica que recorra un viaje con
paradas, agenda, presupuesto, equipaje y recuerdos. No debilites ni elimines el
test baseline del scaffold.
```

El prompt queda congelado. Una corrección del producto ManyHands no autoriza a
cambiarlo silenciosamente; cualquier revisión del prompt crea una versión nueva
de este documento y queda registrada antes del intento siguiente.

## Oráculo topológico independiente

La topología es apta para demostración cuando la evidencia canónica prueba:

1. Tres niveles de propiedad visibles: root, composites intermedios y leaves.
2. Al menos tres composites intermedios correspondientes a las tres áreas del
   producto, cada uno con hijos que justifican su corte semántico.
3. Al menos una frontier con dos o más leaves realmente seleccionados en
   paralelo y con `ResourceClaim` disjuntos.
4. Una integración completada por cada composite intermedio antes de la
   integración root.
5. Dependencias por artifacts o seams explícitos, sin writers superpuestos sin
   ordenar.
6. Grafo legible en la UI sin recentrado automático causado por eventos.

La implementación puede producir más nodos si aparecen límites reales. No se
aceptan hojas artificiales creadas sólo para alcanzar un conteo.

## Oráculo de producto protegido

El verificador vive fuera del repositorio target y recorre el candidate exacto:

1. Abrir el estado vacío y crear `Bariloche 2026`, del 5 al 12 de septiembre.
2. Agregar dos paradas y actividades en dos días diferentes; reordenar y buscar.
3. Definir un presupuesto, cargar dos gastos y comprobar totales y disponible.
4. Agregar tres elementos de equipaje, completar uno y comprobar el progreso.
5. Guardar una nota y un favorito y comprobar el resumen del dashboard.
6. Recargar la página y comprobar persistencia de todos los datos.
7. Verificar navegación por teclado, foco visible, estados vacíos y validaciones.
8. Repetir el recorrido visual esencial en viewport mobile.

El PASS exige además `npm test`, candidate limpio, clean clone, identidad exacta
de candidate/delivery y ausencia de archivos runtime sin rastrear.

## Loop de ejecución y corrección

1. Crear la carpeta nueva y el scaffold; registrar SHA/tree y limpieza.
2. Crear el workspace desde la UI y seleccionar la configuración congelada.
3. Iniciar y monitorear el run desde la UI y el journal canónico.
4. Ante un fallo inesperado, cancelar o pausar, comprobar quiescencia de
   procesos y retirar credenciales brokered antes de investigar.
5. Conservar fuera del target sólo un diagnóstico compacto: IDs, SHA/tree,
   evento y receipt relevantes, causa raíz, reproducción y referencia al test o
   fix de ManyHands.
6. Agregar una regresión, aplicar la corrección mínima y reconstruir cada
   paquete compilado consumido por daemon o worker.
7. Verificar la corrección con checks estrechos y luego los checks afectados.
8. Detener el stack, confirmar quiescencia y eliminar el `daemon-state` físico
   exclusivo del intento. Esta es la purga que libera el journal, efectos,
   receipts y artifacts del run fallido; la acción `Eliminar run` de la UI sólo
   archiva y no libera ese espacio.
9. Iniciar el stack contra un `daemon-state` nuevo y vacío; entonces eliminar el
   workspace anterior desde la UI, que ya no tiene runs que lo referencien.
10. Borrar únicamente el directorio resuelto del intento fallido y crear la
    carpeta y workspace siguientes desde cero.

Los directorios grandes de intentos fallidos no se conservan. El diagnóstico
compacto evita ocultar la causa y permite atribuir la corrección sin retener el
workspace completo.

## Recuperación durable durante la ejecución

Una falla de ejecución no exige reiniciar la planificación ni los nodos que ya
fueron verificados. El operador puede solicitar **Reintentar** desde la UI para
un run `interrupted` o `failed`. La transición registra `run.restart_requested`,
conserva los eventos y artefactos ya adoptados y cierra como fallidos los
intentos que habían quedado en estado `running` cuando el run falló. El nuevo
efecto de ejecución usa una identidad de recuperación nueva, por lo que el
planificador reabre únicamente los nodos todavía no adoptados.

Esta recuperación no convierte un resultado no verificado en éxito: el
candidate vuelve a pasar por su matriz exacta y los criterios requeridos siguen
siendo bloqueantes. Los criterios advisory sin observación permanecen
inconclusos, no sustituyen una validación requerida ni habilitan entrega por sí
solos.

## Evidencia del intento exitoso

El intento declarado exitoso conserva:

- prompt, configuración, workspace y target identities;
- base, candidate y delivery SHA/tree;
- journal, graph revisions, attempts, repairs, manifests y receipts;
- evidencia de paralelismo e integraciones intermedias;
- resultados completos de tests y clean-clone qualification;
- recorrido browser protegido y capturas desktop/mobile;
- duración y consumo reportado, declarando cualquier medición no disponible;
- commit limpio del repositorio ManyHands que ejecutó el run.

No se declara éxito por tests aislados, por un grafo atractivo o por una app que
funciona fuera del candidate exacto. Los tres oráculos deben pasar juntos.
