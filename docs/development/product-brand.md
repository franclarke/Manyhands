# Contexto de producto y marca

La fuente estratégica es [`PRODUCT.md`](../../PRODUCT.md). El sistema visual
detallado está en [`docs/design/design-system.md`](../design/design-system.md).

## Escena de uso

Una persona desarrolla software durante una sesión larga. Delega un objetivo,
observa cómo se estructura y ejecuta el trabajo y continúa con otras tareas
mientras el sistema avanza. Vuelve cuando aparece una decisión concreta o cuando
existe un resultado verificable.

La interfaz debe comunicar actividad sin exigir vigilancia constante. Por eso el
tema oscuro puede ser el default actual, pero la identidad no depende de “verse
técnica”: depende de mostrar estados verdaderos, evidencia y control.

## Personalidad

- **Serena:** el movimiento y el color no compiten por atención.
- **Profesional:** los controles son familiares y los mensajes accionables.
- **Transparente:** el usuario puede entender por qué algo espera, falló, cambió
  o quedó obsoleto.

## Principios aplicados

- Ember identifica actividad y acción primaria, no decoración.
- El grafo conserva posición y contexto; nunca se recentra por eventos.
- El detalle técnico se revela desde el objeto seleccionado.
- Una decisión aparece en la franja global, selecciona el nodo afectado y se
  resuelve en su inspector accesible.
- Al terminar, la evidencia reemplaza al grafo como contenido principal.
- El producto cumple WCAG 2.2 AA y ofrece reducción de movimiento.

## Anti-referencias

- ciencia ficción, neón y glows constantes;
- dashboards con cards y métricas sin jerarquía;
- chats que esconden la estructura del trabajo;
- terminales y logs crudos como experiencia principal;
- animaciones que mueven el viewport o impiden leer.
