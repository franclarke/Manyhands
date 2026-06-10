# Product

## Register

product

## Users

Francisco (solo developer/architect) hoy; evaluadores de tesis y desarrolladores técnicos mañana. El usuario está **supervisando trabajo autónomo**: lanza un run, observa cómo el sistema descompone y ejecuta en paralelo, e interviene solo en gates de alto impacto (aprobación de plan, conflictos de merge, enmiendas de seams). Sesiones largas (30 min – horas), frecuentemente de noche, con la app abierta como una sala de control. Idioma de la UI: español rioplatense.

## Product Purpose

ManyHands es un **compilador de trabajo de IA**: toma una feature en lenguaje natural, la descompone en un DAG jerárquico de tareas con contratos de interfaz explícitos, ejecuta las hojas en paralelo en worktrees git aislados (Gemini CLI headless) y reintegra bottom-up con reparación semántica. La web app es la proyección en tiempo real del StateGraph de LangGraph: su éxito se mide en si el usuario **confía** en lo que ve — cada nodo, costura y decisión refleja el estado real del orquestador, sin estado derivado inventado.

## Brand Personality

**Precisa, viva, serena.** Una sala de control nocturna: instrumentación densa pero calma, donde lo único que brilla es lo que está vivo. La marca es la llama del logo — el calor señala actividad. Voz técnica y directa en español; sin marketing, sin exclamaciones. El sistema transmite competencia silenciosa: muestra evidencia, no entusiasmo.

## Anti-references

- **Celestes/cianes SaaS** (el azul-celeste de dashboards genéricos): prohibidos en toda la paleta, incluidos estados.
- **Clonar la identidad de Anthropic**: el terracota/clay sobre papel crema con serif editorial es de ellos. ManyHands comparte la temperatura cálida pero vive en otro registro: ember sobre grafito, no clay sobre papel.
- **Dashboard de métricas heroicas**: nada de big numbers con gradientes ni cards idénticas en grilla.
- **Spinners centrados**: la carga se comunica con skeletons estructurales que anticipan la forma del contenido, nunca con un spinner en el medio del canvas.
- **Ruido decorativo**: glassmorphism, gradient text, glows gratuitos. El glow existe, pero solo como semántica de "vivo".

## Design Principles

1. **El calor es estado, no decoración.** El color de marca (ember) se reserva para lo que está vivo ahora mismo: nodos ejecutando, integración en curso, la acción primaria pendiente. Todo lo demás es neutral cálido. Si todo brilla, nada brilla.
2. **El grafo nunca miente ni salta.** Cada transición del StateGraph se proyecta en pantalla en el momento en que ocurre: los hijos de un nodo aparecen como skeletons apenas se conocen, los títulos llegan en streaming, los estados cambian con animación de 150–250 ms. Nada aparece "de golpe" terminado.
3. **Obsoleto ≠ fallado.** Los nodos invalidados por enmiendas se atenúan (gris/ámbar suave) y conservan historial; el rojo se reserva para fallos reales. La paleta de estados es un vocabulario semántico fijo, no decoración por nodo.
4. **Densidad con jerarquía.** Es una herramienta de operador: tablas densas, mono para datos, etiquetas pequeñas — pero cada pantalla tiene una sola pregunta primaria ("¿qué decido ahora?") proyectada en el DecisionChannel.
5. **Dos temas, un sistema.** Dark (default, sala de control) y light (papel neutro) comparten exactamente los mismos tokens semánticos y de estado; ningún componente conoce el tema.

## Accessibility & Inclusion

- Contraste AA mínimo (4.5:1 texto normal, 3:1 texto grande) verificado en **ambos** temas con `pnpm -F @manyhands/web contrast:check`.
- El estado nunca se comunica solo con color: cada status lleva etiqueta de texto o icono (los 13 estados de `UiStatus`).
- `prefers-reduced-motion`: shimmer, pulsos y dash-march colapsan a estados estáticos.
- Foco visible (outline 2px accent, offset 3px) en todo control interactivo, incluidos nodos del grafo React Flow.
