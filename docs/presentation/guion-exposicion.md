# Guion de exposición — AgendaFácil

## Apertura

“ManyHands recibe un objetivo de software y coordina varios agentes para
convertirlo en un resultado integrado y probado. No reemplaza al desarrollador:
organiza el trabajo, verifica lo que ocurre y pide ayuda cuando hace falta una
decisión.”

## 1. El objetivo

Mostrar el pedido de construir una aplicación de turnos. Explicar que el sistema
primero inspecciona el repositorio para no generar un plan genérico.

## 2. El grafo

“La raíz es el resultado completo. Estas tres ramas se entienden como partes del
producto, pero internamente son fronteras técnicas donde los resultados pueden
integrarse y probarse.”

Abrir un nodo y mostrar objetivo, inputs, output y validación. Evitar explicar
todos los tipos de contrato al principio.

## 3. Paralelismo seguro

“Dos agentes pueden avanzar juntos cuando comparten una frontera acordada. Si
uno necesita el código real del otro, el sistema espera ese artefacto y lo
incluye en su base. No confunde ‘trabajar después’ con ‘tener disponible el
resultado’.”

## 4. Reparación

Avanzar hasta el doble booking. Mostrar que el test falla y el sistema hace una
reparación local. “No me interrumpe porque el error es concreto, reversible y
verificable.”

## 5. Decisión humana

Mostrar la falta de zona horaria. “Este cambio modifica un contrato y puede
invalidar trabajo. Antes de hacerlo, ManyHands me enseña qué se rehace y qué se
conserva.”

Abrir el popup desde la tarjeta. Señalar que otras ramas continúan.

## 6. Integración

“Que cada pieza funcione sola no garantiza que funcionen juntas. Los composites
integran de abajo hacia arriba y vuelven a ejecutar validaciones. El sistema
puede reparar un conflicto estructural, pero me convoca si debe elegir semántica
de negocio.”

## 7. Resultado

Al llegar a `result_ready`, mostrar Evidence Matrix. “El producto no termina
porque todos los nodos se pusieron verdes. Termina cuando cada criterio tiene
evidencia sobre el mismo commit que se va a entregar.”

## Cierre

“El grafo hace visible la coordinación; los contratos permiten independizar
trabajo; los tests y la evidencia construyen confianza; y las decisiones humanas
se reservan para aquello que realmente necesita criterio.”

## Afirmaciones que no deben hacerse sin evidencia real

- que el backend ya soporta todos los eventos del fixture;
- que cualquier aplicación puede paralelizarse sin costo;
- que los agentes siempre reparan conflictos;
- que un fixture demuestra calidad de código real;
- que la arquitectura escala a múltiples hosts o tenants.
