# ManyHands — Brief de rediseño del producto y migración del frontend

> Documento para agentes de código. Este archivo define la dirección de producto, UX, sistema de diseño y estrategia de migración para transformar el frontend actual de ManyHands hacia una experiencia moderna de agente conversacional con artifact vivo de DAG. No asume nombres internos concretos de módulos, interfaces, rutas o componentes existentes. Antes de implementar, cada agente debe inspeccionar el código actual y mapear estas instrucciones a la arquitectura real del repositorio.

---

## 1. Objetivo del rediseño

ManyHands debe dejar de sentirse como una aplicación experimental o un dashboard técnico oscuro y pasar a sentirse como un **command center conversacional para desarrollo de software con subagentes**.

La experiencia final debe combinar tres ideas centrales:

1. **Chat como plano de control conversacional**  
   El chat explica qué está haciendo el sistema, resume decisiones de planificación, detecta conflictos, pide intervención humana cuando corresponde y recomienda próximos pasos.

2. **DAG como artifact central del producto**  
   El grafo de tareas no es un complemento visual. Es la representación principal de la hipótesis de ManyHands: dividir una tarea compleja en subtareas atómicas, ejecutar trabajo en paralelo con subagentes e integrar resultados recursivamente.

3. **Run como unidad de trabajo reproducible**  
   Cada pedido del usuario debe convertirse en una ejecución inspeccionable, auditable y, cuando sea posible, reproducible. La UI debe mostrar cómo se planificó, cómo se ejecutó, qué conflictos aparecieron, qué decisiones se tomaron y qué resultado produjo.

El nuevo frontend debe reutilizar la lógica de backend existente: planificación, generación de DAG, ejecución mock o real, trazas, store de runs, eventos, evaluación, granularidad, integración, conflictos y endpoints actuales. El foco del rediseño es **cambiar la forma en que se presenta y se opera el producto**, no reescribir innecesariamente el dominio.

---

## 2. Principio rector del producto

La aplicación debe comunicar esta idea en cada pantalla:

> **ManyHands convierte un pedido de software en un grafo vivo, inspeccionable y consciente de conflictos, ejecutado por agentes de programación coordinados.**

En términos operativos:

1. El usuario describe una tarea de software.
2. ManyHands inspecciona el contexto del workspace.
3. El sistema genera una planificación jerárquica.
4. Esa planificación se materializa como un DAG vivo.
5. La UI muestra qué ramas pueden ejecutarse en paralelo.
6. El sistema detecta conflictos antes o durante la ejecución.
7. El chat explica los conflictos y propone acciones.
8. El usuario puede aprobar, corregir, serializar, dividir, fusionar o regenerar partes del plan.
9. Los subagentes ejecutan tareas hoja en workspaces o worktrees aislados.
10. Los nodos padre integran resultados de sus hijos.
11. El sistema evalúa costo, tiempo, paralelismo, overhead, conflictos y calidad aproximada.

La interfaz no debe vender “chat con IA”. Debe vender **orquestación visual y conversacional de trabajo agentic**.

---

## 3. Restricciones importantes para los agentes de código

### 3.1. No asumir nombres internos

Este documento evita imponer nombres concretos de interfaces, tipos, componentes o módulos porque el repositorio actual probablemente ya tiene conceptos implementados con otros nombres.

Al implementar:

- No crear nombres nuevos si ya existe un concepto equivalente.
- No duplicar modelos de dominio.
- No reemplazar contratos existentes sin necesidad.
- No inventar una arquitectura paralela al backend actual.
- Primero inspeccionar el código, entender cómo están representados runs, nodos, traces, DAG, conflictos, granularidad, scheduler, ejecución y evaluación.
- Luego mapear este brief al sistema real.

### 3.2. Reutilizar backend y dominio existentes

El rediseño debe aprovechar lo que ya funciona:

- generación de runs;
- planificación/descomposición;
- TaskGraph/DAG o equivalente;
- granularidad/agresividad;
- ejecución mock o real;
- trazas/eventos;
- store de runs;
- endpoints existentes;
- evaluación;
- scheduler;
- riesgos de conflicto;
- integración de resultados;
- persistencia/export/import si existe.

La UI nueva debe ser una capa de producto moderna encima de esa lógica.

### 3.3. No implementar componentes desde cero si ya existen en librerías

El frontend debe apoyarse explícitamente en librerías modernas para interfaces conversacionales y agentic. El agente debe investigar y usar estas fuentes antes de implementar componentes propios:

- **assistant-ui** como base principal para la experiencia conversacional.
- **Agent Elements** para tarjetas y patrones agentic: tools, subagentes, planes, aprobaciones, preguntas, streaming states, etc.
- **Vercel AI Elements** como biblioteca auxiliar de componentes AI-native sobre shadcn/ui.
- **shadcn/ui**, Tailwind y Radix como base visual si el proyecto ya los usa o si la integración es razonable.
- **@xyflow/react / React Flow** o la solución de canvas existente para el DAG, si ya está incorporada.

Si una pieza existe en estas librerías, se debe usar, copiar o adaptar antes de escribir una versión propia. La excepción es cuando ManyHands necesita una pieza fuertemente específica del dominio, como un nodo de DAG, un inspector de tarea, una vista de conflictos propios o una evaluación de granularidad.

### 3.4. Investigar documentación antes de tocar código

Antes de implementar, el agente debe revisar la documentación y ejemplos actuales de:

- assistant-ui: https://www.assistant-ui.com/docs
- assistant-ui GitHub: https://github.com/assistant-ui/assistant-ui
- Agent Elements docs: https://agent-elements.21st.dev/docs
- Agent Elements GitHub: https://github.com/21st-dev/agent-elements
- Vercel AI Elements: https://elements.ai-sdk.dev/
- Vercel AI Elements GitHub: https://github.com/vercel/ai-elements
- Vercel AI SDK, solo si el proyecto lo usa o si assistant-ui/AI Elements lo requieren: https://ai-sdk.dev/
- Vercel Chatbot como referencia arquitectónica, no necesariamente como base directa: https://github.com/vercel/chatbot

El objetivo de investigar no es copiar una app completa, sino entender qué componentes ya resuelven chat, composer, streaming, messages, tool calls, reasoning, code blocks, input bars, attachments y agentic cards.

---

## 4. Rol esperado de cada librería

### 4.1. assistant-ui: base conversacional

Usar assistant-ui como fundamento de la experiencia de chat porque ya provee primitives y patrones de UI conversacional productiva.

Debe encargarse, según compatibilidad con el proyecto actual, de:

- superficie de conversación;
- listado de mensajes;
- composer/input;
- streaming;
- auto-scroll;
- accesibilidad básica;
- edición/reintento/copia de mensajes si aplica;
- adjuntos si aplica;
- integración con runtime custom;
- render de tools si conviene;
- separación entre capa visual de chat y lógica real del backend.

El punto clave: **el chat no debe ser la fuente de verdad del sistema**. El chat es una vista narrativa sobre el estado del run. La fuente de verdad debe seguir siendo el backend/event log/store actual.

### 4.2. Agent Elements: UI agentic y tool cards

Usar Agent Elements para evitar construir desde cero la UI típica de agentes:

- tarjetas de comandos;
- tarjetas de edición/diff;
- tarjetas de búsqueda;
- planes;
- listas de tareas;
- subagentes;
- preguntas aclaratorias;
- aprobaciones;
- herramientas genéricas;
- estados de pensamiento/carga;
- input bar y controles agentic si encajan mejor que los de assistant-ui.

Estas piezas deben adaptarse al dominio ManyHands. Por ejemplo, una tarjeta de plan no debe mostrar un plan genérico: debe mostrar cómo ese plan corresponde al DAG, qué nodos generó, qué ramas pueden paralelizarse y qué conflictos se detectaron.

### 4.3. Vercel AI Elements: componentes auxiliares AI-native

Usar Vercel AI Elements como biblioteca complementaria, especialmente para:

- bloques de respuesta;
- mensajes;
- reasoning displays;
- code blocks;
- prompt input;
- conversaciones;
- loaders;
- acciones de mensaje;
- componentes de artifact si encajan;
- piezas visuales shadcn-style que eviten trabajo repetitivo.

No convertir Vercel AI Elements en el framework único si assistant-ui resuelve mejor la capa de chat. Usarlo como fuente de componentes copiables y adaptables.

### 4.4. Vercel Chatbot: referencia, no base obligatoria

Vercel Chatbot puede servir para estudiar:

- estructura general de una app AI moderna;
- persistencia de conversaciones;
- streaming;
- integración con AI SDK;
- layout;
- server actions/API routes;
- manejo de modelos.

Pero no se debe clonar ni adoptar como arquitectura completa si entra en conflicto con ManyHands. ManyHands tiene un dominio más específico que un chatbot: runs, DAG, subtareas, subagentes, conflictos, integración y evaluación.

---

## 5. Forma final del producto

### 5.1. Estructura general

La aplicación final debe sentirse como una interfaz de tres zonas:

1. **Navegación lateral**  
   Entrada a runs, workspaces, comparaciones, benchmarks, settings y creación de nuevos runs.

2. **Centro conversacional**  
   Donde el usuario habla con ManyHands. El sistema explica, pregunta, recomienda y resume.

3. **Panel de artifacts**  
   Donde vive el DAG y las vistas operativas: plan, conflictos, ejecución, archivos/diffs y evaluación.

En desktop, estas tres zonas pueden convivir. En pantallas medianas o pequeñas, el panel de artifacts puede comportarse como tab, drawer o vista full-screen. La experiencia mobile no es prioridad absoluta para la tesis, pero no debe quedar rota.

### 5.2. Home / nuevo run

La pantalla inicial debe parecerse a los productos conversacionales modernos: centro limpio, input protagonista, pocos controles y mucho aire.

Debe incluir:

- una frase central que invite a construir algo;
- input grande para describir la tarea;
- selector de workspace/proyecto si ya existe;
- selector de granularidad/agresividad;
- selector de modelo/runner si aplica;
- modo de ejecución si aplica: planificar, simular, ejecutar, comparar granularidades;
- acceso claro a runs recientes.

La home debe transmitir que el usuario no está empezando un chat vacío, sino creando una ejecución estructurada de ManyHands.

### 5.3. Vista de run activo

Cuando existe un run activo, la UI debe mostrar siempre:

- qué se está construyendo;
- estado global del run;
- granularidad elegida o inferida;
- cantidad de tareas/nodos;
- tareas corriendo, bloqueadas, completadas o esperando revisión;
- conflictos pendientes;
- costo/tiempo estimado si está disponible;
- progreso general;
- panel derecho con artifact activo.

El header del run debe ser compacto pero informativo. No debe parecer un dashboard pesado.

---

## 6. Chat: comportamiento esperado

### 6.1. El chat no debe mostrar logs crudos

El chat debe traducir eventos técnicos a explicaciones útiles.

Incorrecto:

```text
NODE_CREATED id=abc parent=root status=planned
EDGE_CREATED a -> b
CONFLICT_DETECTED risk=0.73
```

Correcto:

```text
Generé el primer plan de trabajo. La tarea se divide en tres ramas principales: backend, UI y validación. Detecté un posible conflicto en la rama de autenticación porque dos subtareas podrían modificar el mismo modelo de datos.
```

Los logs crudos, comandos, tool calls detallados y traces deben vivir en la vista de ejecución o en inspectores específicos, no como ruido principal del chat.

### 6.2. El chat debe explicar planificación

Durante la planificación, el chat debe responder preguntas como:

- qué entendió del pedido;
- qué partes del workspace parecen afectadas;
- por qué eligió cierta granularidad;
- cómo se dividió la tarea;
- qué ramas pueden paralelizarse;
- cuál es la ruta crítica;
- qué nodos requieren revisión humana;
- qué riesgos aparecen antes de ejecutar.

### 6.3. El chat debe pedir decisiones humanas

Cuando haya ambigüedad o riesgo, el chat debe pedir decisión con opciones claras.

Ejemplos de decisiones:

- dividir más una tarea;
- fusionar tareas demasiado pequeñas;
- serializar tareas con riesgo de conflicto;
- mantener tareas en paralelo a pesar del riesgo;
- regenerar una rama;
- aprobar un plan;
- aprobar un diff;
- reintentar una tarea fallida;
- cancelar una rama;
- marcar una parte como manual.

Cada decisión debe tener:

- explicación breve;
- impacto esperado;
- recomendación del sistema;
- opciones accionables.

### 6.4. El chat debe sincronizarse con el artifact

Cada vez que el chat mencione un nodo, conflicto, diff, subagente o evaluación, debe existir una forma de saltar visualmente al artifact correspondiente.

Ejemplos esperados:

- “Ver en DAG”;
- “Resaltar nodos afectados”;
- “Abrir conflicto”;
- “Ver diff”;
- “Abrir ejecución de esta tarea”;
- “Comparar granularidades”.

La selección en el artifact también debe poder contextualizar el chat. Si el usuario selecciona un nodo y pregunta “¿por qué esto depende de lo otro?”, el chat debe responder usando el contexto del nodo seleccionado.

---

## 7. Artifact principal: DAG vivo

### 7.1. El DAG es el centro del producto

El DAG debe ser la vista visual principal del run. No debe ser decorativo. Debe mostrar cómo ManyHands piensa, divide, paraleliza, bloquea, ejecuta e integra.

Debe soportar:

- aparición progresiva de nodos durante planificación;
- dependencias entre tareas;
- estados por nodo;
- agrupación jerárquica si existe;
- tareas hoja;
- tareas integradoras;
- validaciones;
- gates humanos;
- conflictos;
- selección de nodo;
- zoom/focus;
- actualización live;
- representación de progreso.

Si el proyecto ya usa un canvas con React Flow/@xyflow/react, se debe reutilizar y evolucionar. Si existe otra solución funcional, evaluarla antes de reemplazarla. El objetivo no es cambiar la librería del canvas por moda, sino hacer que el canvas sea una experiencia de producto superior.

### 7.2. Qué debe mostrar cada nodo

Cada nodo debe ser visualmente simple. Evitar meter demasiada información dentro del nodo.

Información sugerida:

- título corto;
- tipo de tarea según el dominio actual;
- estado visual;
- indicador de riesgo si aplica;
- indicador de subagente/modelo si aplica;
- progreso mínimo si aplica;
- señal de bloqueo o revisión humana si corresponde.

Los detalles deben vivir en un inspector o panel contextual, no dentro del nodo.

### 7.3. Inspector de nodo

Al seleccionar un nodo, la UI debe mostrar información contextual:

- descripción completa;
- contrato de entrada/salida si existe;
- dependencias;
- hijos/padre;
- archivos esperados o tocados;
- riesgos;
- eventos recientes;
- subagente asignado;
- comandos o tools relevantes;
- patches/diffs asociados;
- estado de aprobación;
- acciones disponibles.

Acciones posibles, según soporte del backend:

- aprobar;
- regenerar;
- dividir más;
- fusionar;
- serializar;
- ejecutar;
- cancelar;
- marcar como manual;
- abrir diff;
- abrir logs;
- pedir explicación al chat.

### 7.4. Evitar la “telaraña”

El DAG debe ser legible. Para eso:

- usar layout automático;
- colapsar grupos cuando haga falta;
- permitir enfocar la rama activa;
- resaltar ruta crítica;
- filtrar por estado;
- evitar colores excesivos;
- usar badges compactos;
- usar líneas y nodos de bajo ruido visual;
- mostrar pocos detalles por defecto;
- mover la complejidad al inspector.

---

## 8. Artifacts secundarios

El panel de artifacts debe permitir cambiar entre distintas perspectivas del run. No importa el nombre exacto de las pestañas, pero sí las capacidades.

### 8.1. Plan

Debe explicar cómo se diseñó el DAG:

- objetivo del run;
- resumen de la estrategia de descomposición;
- granularidad elegida o inferida;
- justificación de la granularidad;
- ramas principales;
- tareas hoja;
- nodos de integración;
- ruta crítica;
- paralelismo posible;
- dependencias fuertes;
- tareas que requieren revisión.

Esta vista es importante para la tesis porque evidencia la hipótesis de descomposición.

### 8.2. Conflictos

Debe mostrar conflictos detectados de forma accionable.

Cada conflicto debe mostrar:

- severidad;
- tareas afectadas;
- causa probable;
- archivos o módulos involucrados si se conocen;
- impacto esperado;
- recomendación;
- opciones de resolución;
- estado de resolución.

Conflictos posibles:

- mismas zonas del código;
- mismos archivos;
- cambios incompatibles de esquema;
- dependencias cruzadas;
- contratos ambiguos;
- outputs incompatibles;
- tareas demasiado grandes;
- tareas demasiado pequeñas;
- riesgo alto de integración;
- falta de información.

### 8.3. Ejecución

Debe mostrar actividad operacional:

- timeline de eventos;
- subagentes activos;
- tareas en cola;
- tareas corriendo;
- tareas completadas;
- errores;
- retries;
- comandos;
- tools;
- logs resumidos;
- links a outputs;
- duración por tarea;
- costo/tokens si existe.

Esta vista puede usar fuertemente Agent Elements para representar herramientas, subagentes, comandos y estados de ejecución.

### 8.4. Archivos y diffs

Si ManyHands modifica código, debe existir una vista clara de cambios:

- archivos creados/modificados/eliminados;
- diff por tarea;
- diff agregado del run;
- patches pendientes;
- conflictos de merge;
- aceptación/rechazo de cambios;
- revisión por nodo;
- conexión entre archivo modificado y tarea que lo produjo.

La UI no debe ocultar que el producto está modificando código. Debe hacerlo revisable.

### 8.5. Evaluación

La evaluación debe mostrar por qué el run fue bueno o malo para la hipótesis de ManyHands.

Métricas esperadas, según disponibilidad del backend:

- cantidad de nodos;
- profundidad del DAG;
- ancho máximo/paralelismo;
- ruta crítica;
- tiempo estimado y real;
- costo estimado y real;
- cantidad de conflictos;
- conflictos automáticos vs humanos;
- overhead de integración;
- tareas reintentadas;
- fallos;
- calidad aproximada;
- comparación entre granularidades si aplica.

Esta vista debe ser limpia y ejecutiva, no una tabla cruda enorme.

---

## 9. Flujo principal esperado

### 9.1. Inicio

El usuario entra a la app y ve una pantalla limpia con un input central. Selecciona workspace, granularidad y runner/modelo si corresponde. Describe la feature o tarea.

### 9.2. Creación del run

El backend crea el run usando la lógica existente. La UI pasa del estado inicial a una vista de run activo.

El chat explica:

- qué va a hacer;
- qué contexto va a inspeccionar;
- qué espera generar.

El artifact muestra un estado inicial del DAG.

### 9.3. Planificación live

A medida que el backend genera o actualiza el plan, la UI muestra nodos y dependencias. El chat resume la estrategia sin inundar de logs.

El usuario debe poder ver cómo el plan aparece gradualmente, no solo como resultado final.

### 9.4. Revisión de conflictos

Si se detectan conflictos, el sistema debe detenerse o pedir revisión según la severidad. El chat debe explicar y recomendar. La vista de conflictos debe permitir actuar.

### 9.5. Decisión humana

El usuario decide mediante botones o lenguaje natural. La UI actualiza el DAG y el estado del run. Esta decisión debe quedar registrada en el trace/event log si el backend lo soporta.

### 9.6. Ejecución

Las tareas hoja se ejecutan, idealmente en paralelo cuando las dependencias lo permiten. El DAG muestra estados vivos. La vista de ejecución muestra subagentes y tools. El chat resume hitos relevantes.

### 9.7. Integración

Cuando las hojas terminan, los nodos superiores integran resultados. La UI debe representar claramente esta etapa, porque es parte central de la arquitectura de ManyHands.

### 9.8. Revisión final

El sistema muestra:

- resultado final;
- archivos modificados;
- conflictos resueltos;
- decisiones humanas;
- evaluación;
- próximos pasos sugeridos.

---

## 10. Modelo de datos y eventos en frontend

### 10.1. Fuente de verdad

La fuente de verdad debe ser el estado del run proveniente del backend, no el estado local improvisado del chat.

El frontend debe derivar vistas desde:

- snapshot actual del run;
- eventos del run;
- traces;
- endpoints de detalle;
- patches/diffs;
- evaluación;
- datos de workspace;
- estado de ejecución.

### 10.2. Eventos como sincronización

La UI debe tratar los eventos como el mecanismo para sincronizar chat, DAG, timeline, conflictos y evaluación.

No se requiere usar nombres exactos de eventos nuevos. Primero revisar los eventos/traces existentes y extender solo si hace falta.

Categorías de eventos que la UI necesita entender:

- run creado;
- planificación iniciada;
- nodo agregado/actualizado/eliminado;
- edge agregado/actualizado/eliminado;
- conflicto detectado;
- decisión humana solicitada;
- decisión humana aplicada;
- nodo aprobado;
- tarea en cola;
- tarea iniciada;
- tool call iniciada/completada;
- patch/diff creado;
- tarea completada;
- tarea fallida;
- integración iniciada/completada;
- evaluación generada;
- run completado/fallido.

Si el backend actual no expone algunos eventos, el agente debe proponer una adaptación mínima y compatible, no una reescritura total.

### 10.3. Estado derivado

El frontend debe poder derivar:

- progreso global;
- nodos por estado;
- conflictos pendientes;
- acciones disponibles;
- tareas listas para ejecutar;
- tareas bloqueadas;
- rama activa;
- ruta crítica si existe;
- métricas de evaluación.

Mantener esta derivación simple, testeable y cercana a los contratos reales del backend.

---

## 11. Sistema de diseño esperado

### 11.1. Dirección estética

El producto debe moverse desde una estética demasiado oscura y experimental hacia una estética:

- clara;
- minimalista;
- moderna;
- precisa;
- técnica;
- silenciosa;
- profesional;
- cálida pero no decorativa;
- inspirada en productos como ChatGPT, Claude, Linear, Vercel y herramientas modernas de desarrollo.

La nueva UI puede soportar modo oscuro, pero el rediseño debería considerar seriamente un **modo claro como experiencia principal o al menos como primera impresión**. Las apps conversacionales modernas tienden a usar mucho espacio blanco, bordes suaves, sombras casi invisibles, tipografía editorial limpia y controles discretos.

### 11.2. Principios visuales

- Mucho aire visual.
- Fondo claro cálido, no blanco puro agresivo.
- Superficies con contraste sutil.
- Bordes finos y de bajo contraste.
- Sombras suaves o casi inexistentes.
- Radios moderados.
- Tipografía limpia, con buena jerarquía.
- Estados visuales claros pero no estridentes.
- Pocos colores simultáneos.
- Acento de marca usado con intención.
- La información importante debe ser legible sin parecer dashboard empresarial.

### 11.3. Paleta sugerida

No imponer valores exactos si ya existe un sistema de tokens. Pero el sistema debe moverse hacia algo similar:

- fondo principal: blanco cálido / gris muy claro;
- superficies: blanco, marfil o gris cálido;
- bordes: gris cálido suave;
- texto principal: casi negro, no negro absoluto;
- texto secundario: gris medio cálido;
- acento: cobre/naranja suave o el color de marca actual, usado con moderación;
- estados: verde, amarillo, rojo y azul muy contenidos, preferentemente como badges o indicadores pequeños;
- canvas: fondo claro neutro con líneas muy suaves.

El modo oscuro, si se mantiene, debe sentirse premium y técnico, pero no debe obligar a que toda la app viva en una estética pesada.

### 11.4. Tipografía

La tipografía debe sentirse como producto de ingeniería moderno:

- buen tamaño base;
- line-height cómodo;
- títulos con peso moderado;
- labels discretos;
- números/métricas con alineación clara;
- código y paths con monospace;
- no usar demasiadas variantes.

### 11.5. Componentes visuales

Preferir componentes de shadcn/ui, assistant-ui, Agent Elements y Vercel AI Elements antes que implementar componentes genéricos propios.

El sistema debe tener patrones consistentes para:

- botones primarios/secundarios/ghost;
- badges de estado;
- cards;
- tabs;
- drawers/panels;
- tooltips;
- dropdowns;
- command menus;
- inputs;
- skeletons/loaders;
- toasts;
- dialogs de confirmación;
- timeline/event items;
- code blocks;
- diffs;
- empty states.

### 11.6. Diseño del DAG

El canvas debe tener estética de infraestructura moderna:

- nodos simples;
- edges finos;
- colores sobrios;
- indicadores compactos;
- estados claros;
- selección visible;
- hover útil;
- zoom/focus elegante;
- minimap solo si aporta;
- controles discretos;
- layout limpio.

Evitar:

- nodos enormes;
- gradientes innecesarios;
- exceso de color;
- sombras duras;
- labels largos dentro del nodo;
- iconografía decorativa;
- background oscuro por defecto si vuelve ilegible el grafo.

---

## 12. Comportamiento de diseño por estado

### 12.1. Estado vacío

Debe ser aspiracional, simple y directo. El usuario debe entender qué escribir y qué va a pasar.

Debe evitar:

- demasiados botones;
- muchas métricas antes de tener un run;
- jerga interna;
- home tipo dashboard.

### 12.2. Estado planificando

Debe mostrar actividad real sin ansiedad visual:

- indicador de pensamiento;
- nodos apareciendo;
- resumen conversacional;
- posibilidad de cancelar;
- estado de progreso suave.

### 12.3. Estado esperando decisión

Debe ser imposible de ignorar pero no agresivo:

- badge o banner claro;
- chat con pregunta;
- opciones accionables;
- artifact enfocado en el conflicto o nodo relevante.

### 12.4. Estado ejecutando

Debe mostrar que hay trabajo en paralelo:

- nodos activos;
- subagentes activos;
- timeline;
- progreso;
- logs colapsables;
- diffs cuando aparezcan.

### 12.5. Estado completado

Debe cerrar con claridad:

- resultado final;
- archivos cambiados;
- evaluación;
- conflictos resueltos;
- próximos pasos;
- posibilidad de replay/export/compare.

---

## 13. Migración desde el frontend actual

### 13.1. Primer paso: auditoría

Antes de rediseñar, el agente debe inspeccionar:

- rutas actuales;
- layouts actuales;
- componentes de navegación;
- componentes de chat si existen;
- canvas actual;
- componentes de runs;
- estado global/local;
- endpoints consumidos;
- hooks o clients de API;
- estilos globales;
- tokens de diseño;
- tests;
- Storybook o previews si existen;
- deuda visual y duplicación.

Entregar un mapa breve:

- qué se conserva;
- qué se adapta;
- qué se reemplaza;
- qué se elimina;
- qué queda pendiente.

### 13.2. Segundo paso: spike de librerías

Antes de construir una UI propia, instalar o probar en una rama:

- assistant-ui en el contexto del proyecto actual;
- Agent Elements con algunos componentes críticos;
- Vercel AI Elements para piezas auxiliares;
- compatibilidad con Tailwind/shadcn actual;
- compatibilidad con React/Next actuales;
- impacto en bundle/dependencias;
- conflictos de versiones.

El resultado del spike debe ser una recomendación concreta: qué se adopta como base, qué se copia como componente, qué se descarta.

### 13.3. Tercer paso: nuevo shell visual

Construir la nueva estructura visual sin romper el dominio:

- navegación lateral;
- home limpia;
- centro conversacional;
- panel de artifacts;
- header de run;
- adaptación responsive básica.

No integrar toda la lógica de una vez. Primero crear la estructura visual y conectarla al estado mínimo existente.

### 13.4. Cuarto paso: conectar run real

Conectar la nueva UI a los runs existentes:

- crear run desde el input;
- listar runs recientes;
- abrir run;
- mostrar estado global;
- cargar snapshot del DAG;
- mostrar eventos/traces existentes;
- preservar endpoints actuales.

### 13.5. Quinto paso: chat runtime

Adaptar assistant-ui para que el chat represente eventos reales del run.

El chat debe poder:

- enviar pedidos del usuario al backend;
- recibir streaming o eventos;
- mostrar mensajes narrativos;
- renderizar tool cards cuando corresponda;
- disparar acciones humanas;
- mantener contexto del run activo.

### 13.6. Sexto paso: artifact DAG

Evolucionar el canvas:

- mostrar DAG vivo;
- actualizar por eventos;
- seleccionar nodos;
- abrir inspector;
- resaltar conflictos;
- representar ejecución;
- representar integración;
- mantener performance aceptable.

### 13.7. Séptimo paso: conflictos y decisiones

Implementar la experiencia human-in-the-loop:

- conflictos visibles;
- recomendaciones;
- acciones;
- aplicación de decisiones al backend;
- actualización del DAG;
- registro de decisión.

### 13.8. Octavo paso: ejecución, diffs y evaluación

Completar las vistas operativas:

- timeline;
- subagentes;
- tools;
- logs colapsables;
- archivos/diffs;
- evaluación;
- comparación de granularidad si está disponible.

### 13.9. Noveno paso: limpieza del frontend viejo

Cuando la nueva UI cubra las rutas y flujos principales:

- eliminar componentes obsoletos;
- consolidar estilos;
- quitar duplicación;
- actualizar tests;
- actualizar documentación;
- capturar screenshots antes/después;
- asegurar que no quedan rutas rotas.

---

## 14. Criterios de aceptación

Un rediseño aceptable debe cumplir:

### Producto

- El usuario puede crear un run desde una home limpia.
- El usuario puede ver el chat y el artifact al mismo tiempo.
- El DAG es claramente el artifact central.
- El chat explica planificación, conflictos, ejecución e integración.
- Los conflictos son accionables.
- Las decisiones humanas actualizan el estado visual.
- La ejecución muestra progreso de subagentes/tareas.
- La evaluación final es visible.

### Ingeniería

- Se reutiliza backend/dominio existente.
- No se duplica lógica de planificación en frontend.
- No se reemplazan contratos sin necesidad.
- Los componentes genéricos provienen de librerías recomendadas cuando sea posible.
- El frontend deriva estado desde datos/eventos reales.
- Hay tests o validaciones mínimas para los flujos críticos.
- El build, lint y typecheck pasan.

### Diseño

- La UI se siente moderna, minimalista y clara.
- El modo claro está bien diseñado o al menos seriamente soportado.
- El modo oscuro, si existe, no domina la dirección visual.
- Hay consistencia de tokens, espaciado, bordes, tipografía y estados.
- El DAG es legible.
- El chat no parece un log técnico.
- El producto no parece un clon literal de ChatGPT o Claude: tiene identidad ManyHands.

---

## 15. Anti-objetivos

No hacer:

- No construir un chatbot genérico.
- No usar el canvas como adorno.
- No mostrar todos los logs en el chat.
- No reimplementar primitives de chat desde cero.
- No crear una arquitectura frontend paralela al backend.
- No hardcodear datos fake si ya existen endpoints reales.
- No tapar conflictos: deben ser parte central del producto.
- No diseñar un dashboard oscuro pesado si el producto pide una experiencia conversacional moderna.
- No meter toda la información dentro de los nodos del DAG.
- No hacer una migración gigante sin PRs verificables.

---

## 16. Entregable esperado del primer agente que tome este brief

Antes de implementar código grande, el agente debe entregar un plan de rediseño basado en el estado real del repositorio.

Ese plan debe incluir:

1. Resumen de la implementación frontend actual.
2. Qué partes del backend/dominio se reutilizan.
3. Qué librerías se investigaron y cómo se integrarán.
4. Qué componentes existentes se conservarán.
5. Qué componentes/vistas se reemplazarán.
6. Riesgos técnicos de migración.
7. Plan por PRs o etapas.
8. Primer PR recomendado.
9. Criterios de aceptación del primer PR.
10. Archivos probablemente afectados.

Luego puede implementar el primer PR, preferentemente uno que cree la base visual sin intentar resolver todos los artifacts de una vez.

---

## 17. Primer PR recomendado

El primer PR debería ser deliberadamente estructural y seguro:

- investigar e instalar/probar librerías necesarias;
- crear nueva dirección visual base;
- introducir shell de aplicación moderno;
- crear home conversacional limpia;
- incorporar input/composer basado en librerías;
- mostrar navegación lateral refinada;
- conectar runs recientes si ya existen;
- preparar panel de artifact vacío o con DAG actual embebido;
- mantener rutas y tests existentes funcionando;
- no romper backend ni endpoints.

Este PR no necesita completar conflictos, ejecución y evaluación. Debe dejar la base correcta para que los siguientes PRs avancen sin rehacer diseño.

---

## 18. Segundo PR recomendado

El segundo PR debería conectar la experiencia con runs reales:

- crear run desde el composer;
- abrir run activo;
- mostrar estado global;
- conectar snapshot del DAG;
- mostrar mensajes narrativos básicos derivados de eventos reales;
- mostrar loading/streaming states;
- mantener compatibilidad con la implementación previa.

---

## 19. Tercer PR recomendado

El tercer PR debería convertir el DAG en artifact vivo:

- updates por eventos;
- selección de nodo;
- inspector contextual;
- estados visuales;
- foco en rama activa;
- conflicto destacado si existe;
- acciones mínimas soportadas por backend.

---

## 20. Cuarto PR recomendado

El cuarto PR debería agregar human-in-the-loop:

- vista de conflictos;
- cards de recomendación;
- acciones de resolución;
- integración con chat;
- registro de decisión;
- actualización visual del DAG.

---

## 21. Quinto PR recomendado

El quinto PR debería cerrar ejecución y evaluación:

- vista de ejecución;
- subagentes y tools con Agent Elements;
- archivos/diffs;
- evaluación final;
- comparación de granularidad si está disponible;
- replay/export si existe soporte.

---

## 22. Instrucción final para los agentes

No rediseñar ManyHands como si fuera una plantilla de chatbot. Rediseñarlo como un producto propio: una aplicación donde la conversación, el DAG, los subagentes, los conflictos y la evaluación forman una sola experiencia.

La implementación vieja del frontend puede servir como referencia funcional, pero no debe limitar la nueva dirección visual. El backend y la lógica de dominio son activos valiosos; el frontend debe convertirse en una interfaz moderna, clara y convincente para demostrar la hipótesis de la tesis y, potencialmente, la base de un producto real.
