# Guion completo — presentación oral de ManyHands

**Duración objetivo:** 25 minutos  
**Formato:** exposición presencial con diapositivas 16:9  
**Criterio de uso:** este texto funciona como guía de ensayo. Conviene conservar las ideas, las pausas y las transiciones, pero no memorizar cada oración literalmente.

## Distribución del tiempo

| Diapositiva | Tiempo | Acumulado |
|---|---:|---:|
| 1 | 1:00 | 1:00 |
| 2 | 1:15 | 2:15 |
| 3 | 1:25 | 3:40 |
| 4 | 1:35 | 5:15 |
| 5 | 1:15 | 6:30 |
| 6 | 1:30 | 8:00 |
| 7 | 1:45 | 9:45 |
| 8 | 2:15 | 12:00 |
| 9 | 1:35 | 13:35 |
| 10 | 1:40 | 15:15 |
| 11 | 1:50 | 17:05 |
| 12 | 2:00 | 19:05 |
| 13 | 1:45 | 20:50 |
| 14 | 2:55 | 23:45 |
| 15 | 1:15 | 25:00 |

---

## 1. ManyHands: cómo organizar un equipo de agentes de IA

**Tiempo:** 1:00  
**En pantalla:** portada quieta. Dejar dos segundos antes de comenzar.

Bueno, para empezar, hoy seguramente todos vimos alguna vez a una inteligencia artificial responder preguntas, generar una imagen o incluso escribir código. Pero mi proyecto no empezó preguntando cuánto código podía producir una inteligencia artificial.

La pregunta que me interesó fue otra: ¿qué pasa cuando queremos que la inteligencia artificial trabaje sobre un proyecto grande, durante bastante tiempo y tomando muchas decisiones relacionadas entre sí?

Porque escribir una parte de código es una cosa. Organizar todo el trabajo necesario para construir un sistema, comprobar que las partes sean compatibles y llegar a un resultado confiable es un problema bastante distinto.

Mi proyecto final se llama ManyHands. La idea fue diseñar una forma de organizar varios agentes de inteligencia artificial como un equipo de desarrollo de software.

**Transición:** Para entender por qué hace falta esa organización, primero tenemos que ver qué puede hacer hoy un agente.

---

## 2. La IA ya puede escribir código

**Tiempo:** 1:15  
**En pantalla:** señalar, en orden, «leer», «modificar» y «probar».

Cuando hablamos de un agente de código no hablamos solamente de un chat que nos devuelve un fragmento de texto.

Un agente puede recibir acceso a un proyecto, recorrer sus carpetas, leer archivos y tratar de entender cómo está construido. También puede modificar esos archivos, crear otros nuevos y ejecutar comandos.

Y hay una tercera capacidad que es fundamental: puede correr pruebas, observar un error y volver a intentar una solución. Es decir, puede trabajar en un ciclo parecido al de una persona que programa: mira el estado del proyecto, toma una decisión, hace un cambio y comprueba qué pasó.

Esto permite automatizar tareas que hace unos años requerían mucha intervención manual. El problema es que esta capacidad funciona mejor cuando el objetivo está bien acotado. A medida que el trabajo crece, aparecen limitaciones que no se resuelven simplemente utilizando un modelo más potente.

**Transición:** Ahí es donde empieza realmente el problema que trabajé en la tesis.

---

## 3. El problema aparece cuando el trabajo crece

**Tiempo:** 1:25  
**En pantalla:** recorrer los archivos, requisitos, pruebas y decisiones que rodean al agente.

Imaginemos que le pedimos a un agente que cambie el color de un botón. Probablemente pueda ubicar el archivo, hacer el cambio y comprobarlo sin demasiados problemas.

Ahora imaginemos que le pedimos una aplicación completa. Tiene que pensar en los datos, en la interfaz, en cómo se guarda la información, en las pruebas y en cómo se conectan todas esas partes.

El agente va acumulando archivos, requisitos y decisiones dentro de un contexto limitado. Puede olvidar una restricción que apareció al comienzo, mezclar responsabilidades o modificar una parte del proyecto sin advertir el efecto que produce en otra.

Esto también nos pasa a las personas. Tener más información disponible no significa necesariamente poder manejarla toda al mismo tiempo. En un proyecto real no alcanza con que alguien sea capaz de hacer cada tarea por separado: también tiene que conservar una visión coherente del conjunto.

Entonces, el primer límite no es que la inteligencia artificial no sepa programar. El límite es cuánto trabajo relacionado puede sostener de forma confiable en un solo intento.

**Pausa:** Más capacidad no significa automáticamente más control.

**Transición:** La solución más natural parece ser dividir el trabajo. Pero dividir también tiene un costo.

---

## 4. Dividir ayuda, pero crea nuevos problemas

**Tiempo:** 1:35  
**En pantalla:** mostrar primero el trabajo demasiado grande, luego la fragmentación extrema y finalmente la pregunta central.

Si una tarea es demasiado grande para un agente, podemos repartirla entre varios. Es la misma idea que usamos en cualquier equipo humano.

Pero aparecen dos extremos.

En uno dejamos todo el objetivo dentro de una única tarea. El agente recibe demasiado contexto, tarda más y tiene mayores posibilidades de perder una decisión importante.

En el otro extremo dividimos todo en fragmentos muy pequeños. Ahora cada agente entiende una parte simple, pero alguien tiene que explicar cada tarea, coordinar dependencias y finalmente unir todos los resultados. Dos agentes pueden editar el mismo archivo, diseñar interfaces incompatibles o aprobar pruebas que funcionan por separado, pero no cuando juntamos el sistema.

En ingeniería de software se suele decir que agregar personas a un problema no garantiza resolverlo más rápido, porque también aumenta la comunicación necesaria. Con agentes ocurre algo parecido.

A esta tensión la llamé la paradoja de la granularidad: encontrar una división lo suficientemente pequeña para que cada tarea sea manejable, pero no tan fragmentada como para que coordinar las partes cueste más que construirlas.

**Pausa ante la pregunta:** Entonces, ¿dónde conviene dividir?

**Transición:** Esa pregunta terminó dando origen al proyecto.

---

## 5. Mi proyecto nació de esta pregunta

**Tiempo:** 1:15  
**En pantalla:** comenzar con la pregunta; después señalar el nombre ManyHands.

La pregunta concreta que guio el trabajo fue: ¿cómo hacer que varios agentes colaboren sin perder el control del proyecto?

Y quiero remarcar algo: la intención no fue crear otro modelo de inteligencia artificial ni enseñarle a programar mejor. Para eso ya existen herramientas muy avanzadas.

Lo que quise construir fue la estructura que rodea a esos agentes: un sistema que pueda decidir cómo organizar el trabajo, indicar qué responsabilidad tiene cada uno, controlar qué puede modificar, integrar los resultados y comprobar si lo producido funciona realmente.

De ahí surge ManyHands. El nombre hace referencia a muchas manos trabajando sobre un mismo objetivo, pero bajo una organización común.

En términos un poco más formales, es una plataforma local de orquestación de agentes de código. En términos más simples, es una forma de convertir agentes aislados en un equipo.

**Transición:** Ahora sí, veamos qué significa concretamente organizar ese equipo.

---

## 6. ManyHands convierte agentes aislados en un equipo

**Tiempo:** 1:30  
**En pantalla:** partir de agentes dispersos y seguir las conexiones hacia las tres funciones: organizar, supervisar e integrar.

Si simplemente lanzamos varios agentes al mismo tiempo sobre un repositorio, no tenemos necesariamente un equipo. Tenemos varios programas intentando ayudar, pero sin acuerdos suficientes.

ManyHands funciona como el plano de control del trabajo. Recibe un objetivo general y construye una estructura alrededor de los agentes.

Primero organiza: divide el objetivo en responsabilidades relacionadas y establece qué tareas dependen de otras.

Después supervisa: sabe qué agente está trabajando, con qué información empezó, qué archivos puede modificar y qué resultado produjo realmente.

Y finalmente integra: toma las partes verificadas, comprueba que sean compatibles y construye un único resultado.

Podemos compararlo con la coordinación de una obra. Cada especialista conserva la capacidad de decidir cómo realizar su parte, pero no decide unilateralmente dónde puede construir, qué interfaz debe respetar o cuándo la obra completa está terminada.

En ManyHands, la inteligencia artificial conserva libertad para proponer soluciones. El sistema conserva la autoridad sobre la ejecución, los límites y la evidencia.

**Transición:** Todo este recorrido se reúne dentro de una unidad que llamé Run.

---

## 7. Un Run transforma una idea en un resultado verificable

**Tiempo:** 1:45  
**En pantalla:** recorrer de izquierda a derecha: objetivo, plan, ejecución, integración, validación y entrega.

Un Run es el recorrido completo de un objetivo dentro del sistema. No es solamente la ejecución de un agente.

Empieza con una idea expresada en lenguaje natural y con una versión exacta del repositorio sobre la cual se va a trabajar.

Después viene la planificación. El sistema analiza el proyecto y propone una forma de dividir el objetivo.

Ese plan se convierte en un grafo: una representación de las tareas, sus relaciones y el orden en el que pueden avanzar.

Luego comienza la ejecución. Los agentes trabajan sobre unidades acotadas y generan cambios concretos.

Esos cambios no se copian directamente al proyecto final. Primero se integran, se validan sobre versiones exactas y se relacionan con las pruebas correspondientes.

Recién cuando el candidato completo reúne la evidencia requerida, se entrega como un commit final de Git.

Esta línea es importante porque funciona como mapa para todo lo que viene. Aunque ahora entremos en algunas decisiones técnicas, siempre estamos recorriendo estas seis etapas: objetivo, plan, ejecución, integración, validación y entrega.

**Transición:** Y la primera decisión difícil de ese recorrido aparece durante la planificación: decidir cómo dividir.

---

## 8. La primera decisión es cómo dividir el trabajo

**Tiempo:** 2:15  
**En pantalla:** recorrer las tres preguntas y luego comparar el árbol propuesto con el árbol final.

Esta fue una de las partes más interesantes del desarrollo.

Al principio intenté resolver la granularidad mediante una fórmula. La tarea recibía un puntaje de complejidad calculado a partir de distintas variables y, si superaba un umbral, se dividía.

El problema apareció cuando contrasté esa fórmula con 83 decisiones históricas. El número podía decir «3,7», por ejemplo, pero no explicaba qué beneficio concreto aportaba dividir. Además, cambiar algunos pesos producía exactamente las mismas decisiones. Había una apariencia de precisión, pero no una razón realmente defendible.

Entonces reemplacé ese puntaje por tres preguntas más simples y observables.

La primera es: ¿la tarea cabe razonablemente en un solo intento? Si supera la cantidad de contexto, archivos o tiempo que un agente puede manejar, dividir deja de ser opcional.

La segunda es: ¿las partes pueden avanzar en paralelo? Si al separar una tarea dos agentes pueden comenzar al mismo tiempo, la división compra tiempo real. Si todo queda en una cadena estrictamente secuencial, quizás sólo agregamos coordinación.

Y la tercera es: ¿cada parte puede verificarse por separado? Aunque no exista paralelismo, dividir puede ser útil si cada rama tiene pruebas propias y un fallo no obliga a descartar las demás.

Si ninguna de esas razones existe, el sistema vuelve a unir la propuesta en una sola tarea cohesiva. Lo importante es que las responsabilidades y los criterios de aceptación no se pierden durante ese colapso.

Así, cada división puede explicarse en lenguaje natural. No se divide porque un número arbitrario lo indicó, sino porque la tarea no cabe, porque existe paralelismo real o porque separar permite aislar la verificación.

**Transición:** Una vez decidida la división, cada parte necesita instrucciones suficientemente precisas para trabajar sin invadir a las demás.

---

## 9. Cada agente recibe responsabilidades y límites claros

**Tiempo:** 1:35  
**En pantalla:** recorrer las cuatro partes del «sobre de trabajo»: objetivo, alcance, acuerdos y prueba.

En ManyHands, una tarea no es solamente una frase que dice «hacé el presupuesto» o «construí la agenda».

Cada agente recibe algo parecido a un sobre de trabajo.

Dentro está el objetivo específico: qué resultado tiene que producir.

También está el alcance: qué archivos puede modificar y qué zonas del proyecto no le pertenecen.

Después aparecen los acuerdos de interfaz. Por ejemplo, si una parte va a guardar información y otra necesita leerla, ambas conocen de antemano el formato que van a compartir.

Y finalmente están los criterios de aceptación: qué pruebas o comportamientos tienen que cumplirse para considerar la tarea terminada.

A este conjunto lo representé mediante contratos versionados. Un contrato no garantiza por sí solo que el agente vaya a escribir código correcto. Lo que hace es volver observables sus límites. Si modifica un archivo ajeno o produce un artefacto distinto del esperado, el sistema puede detectarlo de manera objetiva.

**Transición:** Estos contratos también permiten decidir qué tareas pueden ejecutarse al mismo tiempo.

---

## 10. Trabajar en paralelo requiere acuerdos previos

**Tiempo:** 1:40  
**En pantalla:** señalar las dos ramas que avanzan juntas y la tercera que espera un artefacto.

El plan se representa mediante un grafo. Cada nodo es una responsabilidad y las conexiones indican relaciones distintas.

Algunas conexiones significan que una tarea necesita un resultado físico producido por otra. En ese caso tiene que esperar.

Pero no toda relación implica espera. Dos tareas pueden estar vinculadas por una interfaz acordada y trabajar al mismo tiempo. Por ejemplo, un agente puede implementar el almacenamiento y otro preparar una pantalla consumidora, siempre que ambos respeten el mismo contrato.

El sistema también registra recursos compartidos. Si dos agentes necesitan escribir el mismo archivo, no los ejecuta libremente en paralelo: asigna una autoridad, serializa el trabajo o traslada ese cambio a la integración del nodo padre.

Esto es importante porque el paralelismo útil no consiste simplemente en encender seis agentes a la vez. Consiste en ejecutar juntas únicamente las tareas cuyas entradas, responsabilidades y recursos son compatibles.

Después de cada resultado, el sistema vuelve a calcular qué nodos están listos. Por eso el trabajo avanza en olas: algunas ramas se ejecutan juntas, otras esperan y las integraciones aparecen cuando sus insumos están disponibles.

**Transición:** Hasta acá hablamos de organizar el trabajo. Pero todavía falta responder una pregunta más importante: ¿cómo sabemos que el resultado es verdadero?

---

## 11. El sistema comprueba lo que ocurrió realmente

**Tiempo:** 1:50  
**En pantalla:** comenzar por «Terminé la tarea» y luego recorrer diff, candidato, pruebas y evidencia.

Un agente puede terminar su ejecución diciendo: «Listo, la tarea quedó resuelta». Pero esa frase no es evidencia.

ManyHands no decide a partir del relato del modelo. Cada intento trabaja en un worktree de Git, que podemos pensar como una copia aislada y controlada del proyecto. Así, dos agentes no escriben directamente sobre la misma carpeta.

Cuando el agente termina, el sistema inspecciona el diff físico: qué archivos creó, modificó o eliminó realmente. Comprueba que esos cambios estén dentro del alcance permitido y recién entonces construye un commit candidato.

Sobre ese candidato se ejecutan las validaciones. Además, el sistema controla que no se haya conseguido un resultado verde debilitando las pruebas, salteándolas o eliminando aserciones.

Cada criterio queda asociado a una prueba, a su resultado y al commit exacto sobre el cual se ejecutó. Esa relación forma la Matriz de Evidencias.

La diferencia puede parecer sutil, pero es central: no se valida «el trabajo de un agente» en abstracto. Se valida una versión física e identificable del código. Si cambia el commit, la evidencia anterior ya no alcanza.

**Transición:** Una vez que tenemos partes verificadas, queda construir el resultado completo.

---

## 12. Las partes se integran de abajo hacia arriba

**Tiempo:** 2:00  
**En pantalla:** comenzar en las hojas, subir a los tres composites y terminar en la raíz.

La integración sigue la misma jerarquía del grafo, desde las hojas hacia la raíz.

Las hojas son las unidades que implementan partes concretas. Cuando sus resultados están verificados, suben hacia un nodo compuesto.

Un nodo compuesto no es solamente una carpeta visual. Tiene una responsabilidad real: combinar los artefactos de sus hijos, comprobar sus interfaces y ejecutar pruebas conjuntas. También puede realizar los cambios compartidos que fueron asignados específicamente a esa frontera.

En el caso que después vamos a ver, por ejemplo, paradas, agenda y búsqueda se integran dentro del área Ruta e itinerario. Presupuesto y equipaje se integran dentro de Organización. Notas y favoritos forman Recuerdos.

Cuando esas tres áreas están listas, la raíz construye un candidato general con el dashboard, el almacenamiento y el recorrido completo de la aplicación.

Esta estructura también permite recuperarse de fallos sin empezar otra vez desde cero. Si falla la integración de una rama, los resultados verificados de las otras ramas se conservan. Se crea un nuevo intento únicamente para la frontera afectada.

Para mí, esta es una de las propiedades más importantes del sistema: autonomía no significa no fallar. Significa poder localizar el fallo, conservar lo que sigue siendo válido y continuar sin perder el historial.

**Transición:** Para probar este recorrido de punta a punta preparé un caso experimental concreto.

---

## 13. Viaje en Familia puso a prueba el sistema completo

**Tiempo:** 1:45  
**En pantalla:** señalar la raíz, los tres composites y las hojas; después recorrer las cifras de ejecución.

El experimento se llamó Viaje en Familia. El repositorio inicial era deliberadamente pequeño: tenía un servidor estático, una prueba basal y prácticamente ninguna funcionalidad.

El objetivo era construir una aplicación para organizar un viaje familiar. Tenía que incluir rutas y paradas, agenda, búsqueda, presupuesto, equipaje, notas y favoritos, además de almacenamiento local y un dashboard que reuniera todo.

El plan generado tuvo 13 nodos distribuidos en tres niveles: una raíz, tres fronteras de integración y nueve hojas.

Durante el Run, el sistema seleccionó 22 olas de trabajo. Hubo olas reales de tres tareas simultáneas y otras de dos. En las demás, el sistema esperó los artefactos necesarios y ejecutó las integraciones en el orden correspondiente.

Las tres áreas —Ruta e itinerario, Organización y Recuerdos— se integraron antes de construir la raíz. Cuando una validación necesitó corrección, la recuperación se concentró en esa frontera: las ramas que ya estaban verificadas conservaron su trabajo.

Eso permite observar el comportamiento que buscaba el proyecto. No fue una ejecución idealizada en la que nada podía fallar: fue un proceso capaz de registrar qué ocurrió, distinguir qué seguía siendo válido y avanzar hasta una entrega identificable.

**Transición:** Pero el objetivo del experimento no era terminar con un grafo atractivo. El resultado tenía que existir fuera del propio orquestador.

---

## 14. El resultado no fue sólo un grafo

**Tiempo:** 2:55  
**En pantalla:** observar primero la captura real del dashboard entregado y luego señalar los cuatro bloques de evidencia.

Esta es una captura de la aplicación contenida en el commit final. Para que se entienda el resultado, cargué un ejemplo de viaje con dos paradas, tres actividades, presupuesto, equipaje, notas y favoritos. El dashboard reúne esas áreas en una sola vista y también responde en un ancho de pantalla móvil.

Esta imagen sirve para volver visible el producto, pero no la uso como única prueba. Una captura puede verse bien y, aun así, no corresponder a la misma versión que fue validada.

Por eso el cierre del Run se apoya en evidencia más precisa.

Las tres integraciones intermedias generaron candidatos verificados y la raíz produjo un candidato final identificado por el commit `62a0d357`.

Sobre ese commit se ejecutó una suite de 32 pruebas. Esas pruebas cubrieron el almacenamiento y la lógica de rutas, agenda, búsqueda, presupuesto, equipaje, notas, favoritos, los resúmenes integrados y el recorrido general del dominio. Las 32 aprobaron.

Después se creó un clon limpio del repositorio, sin reutilizar el directorio de trabajo del experimento. Ese clon resolvió el mismo commit y el mismo árbol de archivos, quedó sin cambios adicionales y volvió a aprobar las mismas 32 pruebas.

También quedó registrada una Matriz de Evidencias que relaciona las validaciones con el candidato exacto, y la entrega publicada apunta a ese mismo contenido.

Entonces, la captura muestra que existe un resultado reconocible. Los commits, las pruebas y los recibos demuestran que el resultado entregado es el mismo que fue validado y que puede reproducirse fuera del entorno original.

Eso era precisamente lo que buscaba evaluar: si el sistema podía tomar un objetivo amplio, coordinar partes, recuperarse de fallos, integrarlas y entregar una versión identificable.

**Transición:** Y con eso podemos volver a la pregunta con la que empezó la presentación.

---

## 15. La IA aporta capacidad; la arquitectura aporta confianza

**Tiempo:** 1:15  
**En pantalla:** volver al equipo organizado de la portada y dejar aparecer la frase final.

Al comienzo dije que la inteligencia artificial ya puede leer, modificar y probar código. ManyHands no intenta reemplazar esa capacidad ni hacerla parecer infalible.

Lo que aporta es una estructura para usarla con mayor control: decidir cuándo conviene dividir, establecer responsabilidades, aislar ejecuciones, integrar de forma progresiva y exigir evidencia sobre el resultado exacto.

El experimento no significa que todos los proyectos puedan resolverse automáticamente ni que los modelos dejen de equivocarse. Lo que muestra es que podemos diseñar sistemas en los que una equivocación sea observable, quede localizada y no obligue a perder todo el trabajo anterior.

Si tuviera que resumir el proyecto en una sola idea, sería esta: la inteligencia artificial aporta capacidad; la arquitectura aporta las condiciones para confiar en el proceso.

Mi proyecto no buscó enseñarle a la inteligencia artificial a programar. Buscó crear una forma responsable de organizar, comprobar y entregar su trabajo.

Muchas gracias.

---

## Indicaciones para el ensayo

- No hace falta explicar todas las siglas o nombres de clases. El detalle técnico debe funcionar como prueba de profundidad, no como vocabulario que el público tenga que memorizar.
- En las diapositivas 1 a 7, mirar principalmente al público. En las 8 a 12, usar la pantalla para señalar el orden visual. En las 13 a 15, volver a hablar directamente al público.
- Hacer una pausa breve antes de estas frases:
  - «Más capacidad no significa automáticamente más control».
  - «Entonces, ¿dónde conviene dividir?».
  - «Pero esa frase no es evidencia».
  - «Autonomía no significa no fallar».
  - «La IA aporta capacidad; la arquitectura aporta confianza».
- Las expresiones técnicas que vale la pena pronunciar son «grafo», «contratos», «worktree», «commit candidato» y «Matriz de Evidencias». Cada una se explica una sola vez mediante una analogía.
- Si el tiempo se acorta, no recortar las diapositivas 8, 11, 12 o 14: contienen el aporte central y la evidencia. Reducir primero ejemplos de las diapositivas 2, 3, 9 y 10.
- El ensayo debería apuntar a 23:30 o 24:00 sin preguntas. Las pausas y el tiempo de señalar las figuras suelen completar el margen restante.
