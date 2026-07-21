# ManyHands Interview Study Book Design

## Context

Francisco tiene 24 horas para preparar una exposición técnica de aproximadamente
15 minutos sobre ManyHands. La presentación tiene 11 diapositivas principales y
3 de respaldo. Ya existen tres documentos de apoyo:

- `docs/presentation/manual-estudio-entrevista-tecnica.md`;
- `docs/presentation/guion-presentacion-entrevista.md`;
- `docs/presentation/guion-demo-fixture.md`.

El PDF actual integra esos documentos, pero comienza por el guion. El nuevo libro
debe invertir la prioridad: primero construir conocimiento técnico integral y
después ofrecer un módulo autosuficiente para practicar la exposición.

## Resultado deseado

Un PDF digital-first de 120 a 150 páginas que pueda leerse como un libro técnico
sobre ManyHands y, en su segunda mitad, utilizarse directamente para ensayar la
presentación, responder preguntas y mostrar opcionalmente la fixture.

El libro no debe suponer conocimiento avanzado de arquitectura distribuida. Sí
puede asumir fundamentos de programación, pero debe explicar arquitectura,
concurrencia, Git, testing y sistemas agentic desde una base suficiente para que
el lector pueda decidir qué temas estudiar en profundidad y cuáles recorrer
rápidamente.

## Principios editoriales

1. Tono de libro técnico claro, más cercano a una clase particular que a un texto
   académico formal.
2. Cada término complejo se define cuando aparece.
3. Cada mecanismo sigue la secuencia:
   `concepto -> problema -> estrategia -> implementación -> evidencia -> trade-off`.
4. La implementación actual, los tests y la documentación vigente gobiernan las
   afirmaciones técnicas.
5. Debe distinguirse visualmente entre:
   - implementación actual;
   - comportamiento histórico;
   - evidencia automatizada;
   - observación mediante smoke;
   - fixture visual;
   - transferencia hipotética;
   - trabajo futuro.
6. Python, Pydantic, AWS y frameworks agentic aparecen como transferencia de
   conocimiento, no como tecnologías implementadas en ManyHands.
7. Los fragmentos de código serán reales, breves y comentados. Cada uno debe
   indicar archivo, responsabilidad, garantía demostrada y test asociado.
8. La sección de práctica será autosuficiente aunque repita conceptos del libro.

## Arquitectura del contenido

### Parte I - Conocimiento técnico integral

Esta parte ocupará aproximadamente 85 a 100 páginas y tendrá 16 capítulos:

1. Mapa mental y vocabulario del sistema.
2. Software agentic: agentes, workflows, tools, executors y no determinismo.
3. Problema de tesis e hipótesis de ingeniería.
4. Descomposición, repository grounding y granularidad.
5. DAG, Graph Compiler y contracts.
6. Readiness, waves y decisiones humanas locales.
7. ExecutionBase, attempts, AgentExecutor, Git worktrees y scope.
8. InputFingerprint, candidate commits, vigencia y adopción.
9. Eventos, journal, snapshots, replay, CAS, leases, fencing e idempotencia.
10. Validación sobre el SHA exacto y EvidenceMatrix.
11. ArtifactRegistry, integración bottom-up, IntegrationManifest y delivery.
12. Recovery por causa y recuperación después de crashes.
13. UI como proyección, reducer, React Flow y fixture.
14. Librerías, adapters y evolución histórica de LangGraph.
15. Evidencia, resultados, metodología y límites actuales.
16. Transferencia conceptual a Python, Pydantic, APIs y AWS.

### Anatomía de cada capítulo

Cada capítulo repetirá una estructura reconocible:

1. orientación, prioridad y relación con la presentación;
2. intuición, ejemplo, definición técnica y contraejemplo;
3. problema de ingeniería;
4. estrategia e invariantes;
5. implementación real en ManyHands;
6. evidencia de código y tests;
7. trade-offs y límites;
8. explicación oral de 30 a 60 segundos;
9. preguntas de comprensión;
10. escenario técnico;
11. ejercicio de explicación oral;
12. respuestas razonadas para autocorrección.

Los recuadros recurrentes serán: `Concepto`, `Evidencia real`, `No confundir`,
`Trade-off`, `Límite actual` y `Transferencia a Python/AWS`.

### Parte II - Práctica autosuficiente

La práctica comienza después de completar la formación técnica. Contiene:

- las 14 diapositivas como miniaturas;
- guion completo de las diapositivas 1 a 11;
- objetivo, mensaje, ancla, transición y tiempo por diapositiva;
- versiones abreviadas y contingencia desde el minuto 9:30;
- preguntas probables con respuesta corta;
- respaldos 12 a 14 con condición de uso;
- ensayos de 15, 12 y 8 minutos;
- tarjeta para la segunda pantalla;
- frases que deben evitarse;
- checklist final previo a la call.

### Parte III - Demo opcional

La demo queda fuera de los 15 minutos y conserva las variantes de 2, 4, 6 a 8 y
10 minutos. Debe explicar qué demuestra el replay y qué efectos externos no se
ejecutan. La captura de la diapositiva 6 continúa siendo el recorrido visual
normal y la UI en vivo es un recurso de preguntas.

## Prioridad de lectura

Cada sección llevará una marca visible:

- **Esencial:** debe poder explicarse durante la presentación.
- **Importante:** es probable que aparezca en repreguntas técnicas.
- **Profundización:** permite defender trade-offs o escenarios avanzados.

La ruta sugerida para 24 horas será:

1. relato esencial, 4 a 5 horas;
2. profundidad técnica, 3 a 4 horas;
3. evidencia y código, 2 a 3 horas;
4. práctica, 2 horas;
5. repaso final, 30 a 45 minutos.

## Diagramas

El libro tendrá entre 8 y 12 diagramas pedagógicos. El objetivo aprobado es 12:

1. mapa completo del sistema;
2. agente, workflow y mecanismos deterministas;
3. funcionalidad transversal a subsistemas;
4. DAG jerárquico y relaciones tipadas;
5. planner, Zod y Graph Compiler;
6. readiness, decisiones y waves;
7. ExecutionBase, worktree, executor, diff y candidate;
8. InputFingerprint y adopción;
9. journal, snapshots, CAS, leases y fencing;
10. validación, EvidenceMatrix y ArtifactRegistry;
11. integración bottom-up y delivery;
12. traslado hipotético a Python y AWS.

Cada diagrama responderá una pregunta concreta, tendrá explicación textual y
mostrará cómo reproducirlo a mano durante una entrevista.

## Navegación y presentación visual

- PDF digital-first en A4.
- Índice jerárquico con páginas.
- Marcadores PDF.
- Enlaces internos entre teoría y práctica.
- Índice de conceptos.
- Índice de evidencia por archivo y test.
- Rutas de repositorio legibles aunque el PDF se copie fuera del proyecto.
- Código con tipografía monoespaciada, ruta y explicación.
- Miniaturas de las 14 diapositivas en color.
- Paleta sobria y compatible con escala de grises.
- Azul para esencial, ámbar para importante y gris para profundización.
- Sin grandes superficies vacías destinadas a anotaciones.

## Criterios de aceptación

1. El PDF tiene entre 120 y 150 páginas.
2. La teoría integral aparece antes que el material de práctica.
3. Los 16 capítulos están presentes y completos.
4. Las 14 diapositivas aparecen como miniaturas legibles.
5. Existen al menos 10 diagramas; el objetivo es 12.
6. Todos los términos técnicos complejos se definen al aparecer.
7. Cada capítulo incluye prioridad, evidencia, conexión con la entrevista y
   autoevaluación.
8. Todas las rutas Markdown y referencias de código existen.
9. LangGraph se presenta como histórico, no como orquestador actual.
10. La granularidad adaptativa se presenta como exploratoria.
11. La fixture no se presenta como ejecución real de efectos externos.
12. Tests, smokes, fixture y trabajo futuro permanecen diferenciados.
13. El PDF tiene índice, marcadores, enlaces internos, encabezados, pies y páginas.
14. El render completo no contiene texto cortado, superposiciones, tablas rotas,
    glifos inválidos ni páginas defectuosas.

## No objetivos

- Convertir el libro en documentación de producto para usuarios finales.
- Reescribir la implementación.
- Presentar AWS, Python, RAG o LangChain como capacidades actuales.
- Introducir métricas o resultados no comprobados.
- Sustituir la presentación de 15 minutos por una clase extensa.
